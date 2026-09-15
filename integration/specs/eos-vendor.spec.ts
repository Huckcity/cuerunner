// The vendor lane: the same chain as `eos.spec.ts`, against a real console — ETCnomad on
// this machine, or a console on the network — named by `EOS_TARGET` as `host:port`.
// Without one the whole file skips itself, which is how the peer lane runs the same suite
// unchanged.
//
// This is the lane that keeps the peer honest. The peer is a model written from ETC's OSC
// pages and held to them by `harness-eos.spec.ts`; nothing here is a model, so where the
// two disagree, this one is right.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { startEosPeer, type EosPeer } from '../peers/eos'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel } from '../../e2e/helpers'
import { firedAddress, VERSION_ANSWER, writeEosShow } from './eosFixture'

/** `host:port` of the console's OSC input. The vendor lane sets it; nothing else does. */
const TARGET = process.env.EOS_TARGET
/** The cue the show fires, in cue list 1. Any show with a cue in it will do the chain. */
const CUE = Number(process.env.EOS_CUE ?? 12)
/**
 * Where the app listens for the console, and where the recorder listens when one is in the
 * way. Both are fixed, and not out of laziness: a console's OSC TX destination is a setting
 * somebody types into the desk *once*, so the port at this end has to be the same port on
 * every run — which is also why these are environment variables rather than numbers in a
 * fixture.
 */
const APP_PORT = Number(process.env.EOS_APP_PORT ?? 8001)
const RELAY_PORT = Number(process.env.EOS_RELAY_PORT ?? 8002)
/**
 * Where a recording of what the console answered is written. With it set, the spec puts a
 * peer in front of the console as a recording proxy and points the app at that instead —
 * which is how a nightly run produces the fixture the Linux lane replays, without the app
 * or the console knowing anything about it.
 */
const RECORD = process.env.EOS_RECORD
/**
 * A recording to answer from instead of a console — the nightly lane's fixture, replayed.
 * With it set the spec needs no console at all, which is what makes a recording worth
 * keeping: the assertions below then run on every pull request, against what a real console
 * once said.
 */
const REPLAY = process.env.EOS_REPLAY

test.skip(
  TARGET === undefined && REPLAY === undefined,
  'no console configured — set EOS_TARGET=host:port, or EOS_REPLAY=a recording, to run this lane'
)

let app: ElectronApplication
let page: Page
let userDataDir: string
let appPort: number
let consoleHost: string
let consolePort: number
/** What the app talks to: the console, or the recording proxy in front of it. */
let showHost: string
let showPort: number
let proxy: EosPeer | undefined

/**
 * What has to be true at the desk before any of this can pass — and none of it can be set
 * from here, because a console's OSC input, its output and where its output goes are all
 * settings on the console. The failure message is the checklist, on the assumption that
 * whoever reads it is standing in front of the desk.
 */
function checklist(): string {
  // Where the console's output has to go: the app itself, or the recorder when one is
  // standing in front of it. Both are fixed ports, which is what makes them typable once.
  const txPort = RECORD === undefined ? appPort : RELAY_PORT
  return [
    `Nothing answered at ${TARGET} — every one of these is a console setting:`,
    '  1. ECU > Settings > Network > Interface Protocols → "UDP Strings & OSC" enabled on the active interface.',
    `  2. Setup > System > Show Control > OSC → {OSC RX} and {OSC TX} on, OSC UDP RX Port ${consolePort},`,
    `     OSC UDP TX IP Address this machine, OSC UDP TX Port ${txPort}.`,
    '  3. Setup > System > Show Control > {Network List Receive} on (it is by default).',
    '  4. The firewall allows the console’s UDP traffic in and out.',
    `  5. A show is open with cue ${CUE} in cue list 1 (or set EOS_CUE to a cue that exists).`,
    '  6. ETCnomad is past its shell: it answers OSC as soon as a show is open.',
    ...(RECORD === undefined
      ? []
      : [`  7. This run is *recording*: OSC UDP TX Port ${RELAY_PORT} is the recorder, which relays to the app on ${appPort}.`]),
    '',
    `The ports are the lane's own settings: EOS_APP_PORT (${appPort}) and EOS_RELAY_PORT (${RELAY_PORT}).`,
    'INTEGRATION-HARNESS.md §9 has the walkthrough.'
  ].join('\n')
}

test.beforeAll(async () => {
  if (TARGET === undefined && REPLAY === undefined) return
  const [host, port] = (TARGET ?? '127.0.0.1:0').split(':')
  consoleHost = host
  consolePort = Number(port)
  appPort = APP_PORT

  // Three ways this lane can be pointed, and the app cannot tell them apart:
  //  - at a console (nothing between the two);
  //  - at a recorder, which writes the session down so the Linux lane can replay it;
  //  - at a recording, which is a console that answered once and is answering again.
  showHost = consoleHost
  showPort = consolePort
  const relay = TARGET === undefined && REPLAY !== undefined
    ? { port: RELAY_PORT, replay: REPLAY, tx: { host: '127.0.0.1', port: appPort } }
    : RECORD === undefined
      ? null
      : { port: RELAY_PORT, upstream: { host: consoleHost, port: consolePort }, record: RECORD, tx: { host: '127.0.0.1', port: appPort } }

  if (relay !== null) {
    if (RECORD !== undefined) mkdirSync(dirname(RECORD), { recursive: true })
    proxy = await startEosPeer(relay)
    showHost = '127.0.0.1'
    showPort = proxy.port
  }

  const show = writeEosShow({
    consoleHost: showHost,
    consolePort: showPort,
    oscInPort: appPort,
    cue: CUE
  })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  // The show has to be *in* before anything else is fair: the cue rows are the app saying
  // so, and the services are configured from the workspace once it is loaded.
  await expect(page.locator('.cue-row')).toHaveCount(3)
})

test.afterAll(async () => {
  await closeApp(app)
  await proxy?.close()
})

test('the console answers for itself', { tag: '@vendor' }, async () => {
  // The show asks the console who it is. An answer means the whole path in both directions
  // is right — the app sent, the console heard, and the console's own output arrived where
  // the app listens — so it is worth failing on nothing less. This is the check that runs
  // before the assertions, because everything after it would otherwise fail obscurely.
  await page.locator('.cue-row').nth(2).click()
  await page.locator('.btn-go').click()
  await openLogPanel(page)

  try {
    await expect(page.locator('.log-panel')).toContainText(VERSION_ANSWER, { timeout: 15_000 })
  } catch (error) {
    throw new Error(`${(error as Error).message}\n\n${checklist()}`)
  }
})

test('the show fires a cue in the console, and the console’s answer fires the next cue', { tag: '@vendor' }, async () => {
  await page.locator('.cue-row').first().click()
  await page.locator('.btn-go').click()
  await openLogPanel(page)

  // The cue ran, first of all: this show's own account of it, before the console's.
  await expect(page.locator('.log-panel')).toContainText('Blackout')

  try {
    // What the console said, not what the app said it sent: the event address carries the
    // cue list and the cue number the console actually ran.
    await expect(page.locator('.log-panel')).toContainText(firedAddress(CUE), { timeout: 15_000 })
  } catch (error) {
    // A console with no such cue answers with the empty target packet instead — which is
    // the other half of the checklist, and worth saying separately.
    const missing = await page.locator('.log-panel').textContent()
    const hint = missing?.includes('/eos/out/get/cue/1/')
      ? `\n\nThe console answered that it has no cue ${CUE} in cue list 1 — set EOS_CUE to a cue it has, or record one.`
      : ''
    throw new Error(`${(error as Error).message}${hint}\n\n${checklist()}`)
  }

  // And the show answered it: the cue behind the trigger has run.
  await expect(page.locator('.log-panel')).toContainText(`Triggered by OSC ${firedAddress(CUE)}`)
})

// A GO pressed at the console is not asserted here, and deliberately. Whether a console has
// anything pending depends on its own show and where it has been left, and a test that
// pressed GO and demanded an event would be asserting the operator's cue list rather than
// the app's connection to it. The peer lane presses GO — there the show is ours — and the
// console's front panel is the one thing this lane cannot reach.
