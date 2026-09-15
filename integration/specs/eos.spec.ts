// WinsLab and an Eos console: the show fires a cue in the console, the console says on the
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
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startEosPeer, type EosPeer } from '../peers/eos'
import { closeApp, launchApp, mintLicense, openFromRecent, sendOsc } from '../../e2e/helpers'

const CUE_FIRED = '/eos/out/event/cue/1/12/fire'
const CUE_FIRED_BY_KEY = '/eos/out/event/cue/1/13/fire'

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

function writeEosShow(consolePort: number, oscInPort: number): string {
  const root = mkdtempSync(join(tmpdir(), 'winslab-eos-'))
  const path = join(root, 'Eos Show.wlab')
  const base = {
    colorLabel: 'none',
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    advance: 'none',
    isArmed: true,
    refire: 'ignore',
    parentId: null,
    notes: ''
  }

  writeFileSync(path, `${JSON.stringify({
    version: 1,
    id: 'w-eos',
    name: 'Eos Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: {
      oscIn: { enabled: true, port: oscInPort }
    },
    cues: [
      {
        ...base,
        id: 'osc-1',
        number: '1',
        name: 'Blackout',
        type: 'osc',
        duration: 0,
        host: '127.0.0.1',
        port: consolePort,
        address: '/eos/cue/1/12/fire',
        args: []
      },
      {
        ...base,
        id: 'w-1',
        number: '2',
        name: 'After the console says so',
        type: 'wait',
        duration: 50,
        // What the console says when a cue runs. Two of them: one for the cue this show
        // fires, one for the cue the console's own GO fires in the second test.
        triggers: [
          { id: 't-1', kind: 'osc', address: CUE_FIRED },
          { id: 't-2', kind: 'osc', address: CUE_FIRED_BY_KEY }
        ]
      }
    ]
  }, null, 2)}\n`)

  return path
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
  const show = writeEosShow(peer.port, appPort)
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  // The show has to be *in* before anything else is fair: the cue rows are the app saying
  // so, and the services are configured from the workspace once it is loaded.
  await expect(page.locator('.cue-row')).toHaveCount(2)

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
