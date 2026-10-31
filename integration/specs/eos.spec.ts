// Cuerunner and an Eos console: the show fires a cue in the console, the console says on the
// wire what it fired, and a second cue answers that. Both halves go through the app's real
// OSC paths — the cue that sends, and the input service the trigger listens on — with a peer
// standing in for the console (`integration/peers/eos.ts`, written from ETC's OSC
// documentation; `harness-eos.spec.ts` is what holds it to those pages).
//
// The console's OSC output has a destination configured in the desk, not in the message
// (Setup > System > Show Control > OSC), so the peer is told where the app listens — the
// same field an operator fills in.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import dgram from 'node:dgram'
import { startEosPeer, type EosPeer } from '../peers/eos'
import { closeApp, launchApp, openFromRecent, sendOsc } from '../../e2e/helpers'
import { firedAddress, writeEosShow } from './eosFixture'

/** The cue the show fires in the console, and the one the console's own GO fires after it. */
const CUE = 12
const CUE_FIRED = firedAddress(CUE)
const CUE_FIRED_BY_KEY = firedAddress(CUE + 1)

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: EosPeer
let appPort: number

/** A port nobody is on, asked of the kernel rather than guessed at. */
async function freeUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4')
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve))
  const { port } = socket.address()
  await new Promise<void>(resolve => socket.close(resolve))
  return port
}

test.beforeAll(async () => {
  appPort = await freeUdpPort()
  peer = await startEosPeer({
    // Where a console's OSC TX is pointed: the app's oscillator input, which is where a
    // trigger can hear it.
    tx: { host: '127.0.0.1', port: appPort },
    cues: [
      { list: 1, number: 1, label: 'Preshow', upTime: 3 },
      { list: 1, number: 12, label: 'Blackout', upTime: 2 },
      { list: 1, number: 13, label: 'Scene change', upTime: 2 }
    ]
  })
  const show = writeEosShow({
    consoleHost: '127.0.0.1',
    consolePort: peer.port,
    oscInPort: appPort,
    cue: CUE
  })
  ;({ app, page, userDataDir } = await launchApp())
  await openFromRecent(page, userDataDir, show)
  // The show has to be *in* before anything else is fair: the cue rows are the app saying
  // so, and the services are configured from the workspace once it is loaded.
  await expect(page.locator('.cue-row')).toHaveCount(3)

  // And the fixture's port is the show's: the panel says which port the service took, which
  // is the only place the operator can see it either.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('button', { name: 'Network', exact: true }).click()
  await expect(settings.locator('.settings-service[data-service="osc-in"]'))
    .toContainText(String(appPort), { timeout: 10_000 })
  await settings.getByRole('button', { name: 'Close' }).click()
})

test.afterAll(async () => {
  await closeApp(app)
  await peer.close()
})

test('the show fires a cue in the console, and the console’s answer fires the next cue', async () => {
  await page.locator('.cue-row').first().click()
  await page.locator('.btn-go').click()

  await expect.poll(() => peer.received.some(message => message.address === '/eos/cue/1/12/fire'))
    .toBe(true)
  // The console's own record of what it did, not the app's report of what it sent.
  await expect.poll(() => peer.state.playback[1]?.active?.cue).toBe(12)

  // And because the console says so on the wire, the cue that answers to it has fired —
  // the chain an operator builds when the lighting desk calls sound.
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText(`Triggered by OSC ${CUE_FIRED}`)
})

test('a GO pressed at the console fires the cue that answers to it', async () => {
  // The console's own front panel, played here by a third party on the network: GO fires
  // whatever is pending, which is cue 13 after the cue the show fired.
  await sendOsc(peer.port, '/eos/key/go_0')

  await expect.poll(() => peer.sent.some(message => message.address === CUE_FIRED_BY_KEY))
    .toBe(true)
  await expect(page.locator('.log-panel')).toContainText(`Triggered by OSC ${CUE_FIRED_BY_KEY}`)
})

test('a cue the console does not have is refused on the documented address, and the show carries on', async () => {
  await sendOsc(peer.port, '/eos/cue/1/999/fire')

  // The empty target packet: the address and no arguments, which is what a console sends
  // for a cue it cannot find.
  await expect.poll(() => peer.sent.some(message => message.address === '/eos/out/get/cue/1/999/0'))
    .toBe(true)
  expect(peer.sent.find(message => message.address === '/eos/out/get/cue/1/999/0')?.args).toEqual([])

  // A refusal is not a fault: the next cue still reaches the console.
  const fired = peer.received.filter(message => message.address === '/eos/cue/1/12/fire').length
  await page.locator('.cue-row').first().click()
  await page.locator('.btn-go').click()
  await expect.poll(() =>
    peer.received.filter(message => message.address === '/eos/cue/1/12/fire').length
  ).toBe(fired + 1)
})
