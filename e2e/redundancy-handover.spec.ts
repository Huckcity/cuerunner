// Handing the show over on purpose, with both machines alive.
//
// `redundancy-pair.spec.ts` covers the failure this feature exists for: a machine that dies
// and a backup that picks the show up. This one covers the other direction — an operator
// taking the show from a live machine that is still answering — and the one thing that has
// to happen for it to be safe: the machine that loses the show stops playing it. Two
// machines inside the same cue is the outcome a pair exists to prevent.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, mintLicense, openFromRecent } from './helpers'

const TOKEN = 'handover-token'
const TRACK_SECONDS = 30
const SHOW_ID = 'w-handover'

function writeWav(filePath: string, seconds: number): void {
  const sampleRate = 48000
  const frames = seconds * sampleRate
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let frame = 0; frame < frames; frame++) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 12000), 44 + frame * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

/** What a machine's engine says about a cue: its position, or null when nothing plays it. */
async function position(page: Page): Promise<number | null> {
  const reading = await page.evaluate(async () => {
    const bridge = (window as unknown as {
      winslab: { audio: { progress: (id: string) => Promise<{ elapsedMs: number } | null> } }
    }).winslab
    return bridge.audio.progress('a1')
  })
  return reading === null ? null : Math.round(reading.elapsedMs)
}

let liveApp: ElectronApplication
let live: Page
let backupApp: ElectronApplication
let backup: Page

test.beforeAll(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-handover-'))
  const overture = path.join(root, 'overture.wav')
  writeWav(overture, TRACK_SECONDS)

  const showPath = path.join(root, 'Handover.wlab')
  fs.writeFileSync(showPath, JSON.stringify({
    version: 1,
    id: SHOW_ID,
    name: 'Handover',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [{
      id: 'a1', number: '1', name: 'Overture', type: 'audio', colorLabel: 'none', parentId: null,
      preWait: 0, postWait: 0, timelineOffset: 0, duration: TRACK_SECONDS * 1000, advance: 'none',
      isArmed: true, notes: '', filePath: overture, startTime: 0, endTime: null, fadeInDuration: 0,
      volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
    }]
  }))

  const livePort = await freePort()
  const backupPort = await freePort()
  const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-handover-live-'))
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-handover-backup-'))
  fs.writeFileSync(path.join(liveDir, 'redundancy.json'), JSON.stringify({
    enabled: true, name: 'desk-live', id: 'id-live', role: 'live', port: livePort,
    peerHost: '127.0.0.1', peerPort: backupPort, token: TOKEN, timeoutMs: 1500, takeover: 'manual'
  }))
  fs.writeFileSync(path.join(backupDir, 'redundancy.json'), JSON.stringify({
    enabled: true, name: 'desk-backup', id: 'id-backup', role: 'standby', port: backupPort,
    peerHost: '127.0.0.1', peerPort: livePort, token: TOKEN, timeoutMs: 1500, takeover: 'manual'
  }))

  ;({ app: liveApp, page: live } = await launchApp({ userDataDir: liveDir, license: mintLicense() }))
  await openFromRecent(live, liveDir, showPath)
  ;({ app: backupApp, page: backup } = await launchApp({ userDataDir: backupDir, license: mintLicense() }))
  await openFromRecent(backup, backupDir, showPath)
})

test.afterAll(async () => {
  await closeApp(backupApp)
  await closeApp(liveApp)
})

test('the operator hands the show over, and the machine that lost it goes quiet', async () => {
  test.setTimeout(90_000)

  // The live machine fires the cue and plays it.
  await live.locator('.cue-row').first().click()
  await live.getByRole('button', { name: /GO/ }).click()
  await expect.poll(() => position(live), { timeout: 15_000 }).toBeGreaterThan(1000)

  // The standby has the mirror, and the operator takes the show from the panel.
  await backup.locator('.toolbar-brand').click()
  await backup.locator('.file-menu [data-action="settings"]').click()
  const dialog = backup.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Backup machine', exact: true }).click()
  await expect(dialog.locator('.redundancy-line[data-field="partner"]'))
    .toContainText('desk-live (live)', { timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Take the show over now' }).click()
  await expect(dialog.locator('.redundancy-line[data-field="machine"]')).toContainText('running the show')

  // The standby is playing the cue at the position the live machine had reached…
  await expect.poll(() => position(backup), { timeout: 15_000 }).toBeGreaterThan(1000)

  // …and the live machine — which is still answering on the network — has stopped making a
  // sound and says why. One cue, one machine playing it.
  await expect.poll(() => position(live), { timeout: 15_000 }).toBeNull()

  await live.locator('.toolbar-brand').click()
  await live.locator('.file-menu [data-action="settings"]').click()
  const liveDialog = live.getByRole('dialog', { name: 'Settings' })
  await liveDialog.getByRole('button', { name: 'Backup machine', exact: true }).click()
  await expect(liveDialog.locator('.redundancy-line[data-field="machine"]')).toContainText('standing by')

  // The mirror still runs: the machine that hands a show over keeps following the one that
  // took it, so it can stand by for the show it no longer plays.
  await expect.poll(() => position(backup), { timeout: 15_000 }).toBeGreaterThan(2000)
})
