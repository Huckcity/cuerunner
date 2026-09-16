// Redundant playback between two real instances of the app.
//
// `redundancy.spec.ts` is the same protocol seen from a scripted peer, which is how the
// wire and the takeover plan are held. This one is the arrangement itself: two copies of
// the app, one set to run the show and one to stand by for it, on ports of their own. The
// machine running the show is then killed outright — process, socket and sound together,
// the way a machine in a rack goes down — and what the survivor does about it is asserted
// on its own surfaces and on its engine's own position.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, mintLicense, openFromRecent } from './helpers'

const TOKEN = 'pair-token'
const TRACK_SECONDS = 30
const SHOW_ID = 'w-two-machine'

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

let liveApp: ElectronApplication
let live: Page
let backupApp: ElectronApplication
let backup: Page
let liveDir: string

test.beforeAll(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-two-'))
  const overture = path.join(root, 'overture.wav')
  writeWav(overture, TRACK_SECONDS)

  const showPath = path.join(root, 'Two Machine.wlab')
  fs.writeFileSync(showPath, JSON.stringify({
    version: 1,
    id: SHOW_ID,
    name: 'Two Machine',
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
  liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-two-live-'))
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-two-backup-'))
  fs.writeFileSync(path.join(liveDir, 'redundancy.json'), JSON.stringify({
    enabled: true, name: 'desk-live', id: 'id-live', role: 'live', port: livePort,
    peerHost: '127.0.0.1', peerPort: backupPort, token: TOKEN, timeoutMs: 1500, takeover: 'manual'
  }))
  fs.writeFileSync(path.join(backupDir, 'redundancy.json'), JSON.stringify({
    enabled: true, name: 'desk-backup', id: 'id-backup', role: 'standby', port: backupPort,
    peerHost: '127.0.0.1', peerPort: livePort, token: TOKEN, timeoutMs: 1500, takeover: 'auto'
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

test('two apps pair, and the backup picks the show up when the live one dies', async () => {
  test.setTimeout(90_000)

  // They find each other: the live machine's panel says the standby is in sync.
  await live.locator('.toolbar-brand').click()
  await live.locator('.file-menu [data-action="settings"]').click()
  const liveDialog = live.getByRole('dialog', { name: 'Settings' })
  await liveDialog.getByRole('button', { name: 'Backup machine', exact: true }).click()
  await expect(liveDialog.locator('.redundancy-line[data-field="machine"]')).toContainText('running the show')
  await expect(liveDialog.locator('.redundancy-line[data-field="partner"]')).toContainText('desk-backup')
  await expect(liveDialog.locator('.redundancy-line[data-field="show"]')).toContainText('In sync')
  await liveDialog.getByRole('button', { name: 'Close' }).click()

  // Fire the cue from the live machine and let it run for a few seconds. The standby
  // mirrors it as it goes: that mirror is what a takeover starts from.
  await live.locator('.cue-row').first().click()
  await live.getByRole('button', { name: /GO/ }).click()
  await live.waitForTimeout(2000)

  await backup.locator('.toolbar-brand').click()
  await backup.locator('.file-menu [data-action="settings"]').click()
  const backupDialog = backup.getByRole('dialog', { name: 'Settings' })
  await backupDialog.getByRole('button', { name: 'Backup machine', exact: true }).click()
  await expect(backupDialog.locator('.redundancy-line[data-field="machine"]')).toContainText('standing by')
  await expect(backupDialog.locator('.redundancy-line[data-field="partner"]'))
    .toContainText('desk-live (live)', { timeout: 15_000 })
  await expect(backupDialog.locator('.redundancy-line[data-field="partner"]')).toContainText('running 1 cue')
  await backupDialog.getByRole('button', { name: 'Close' }).click()
  await live.waitForTimeout(2000)

  // The live machine dies outright — process and socket together.
  await closeApp(liveApp)

  await backup.locator('.btn-log').click()
  await expect(backup.locator('.log-panel')).toContainText('took the show over', { timeout: 20_000 })
  await expect(backup.locator('.log-panel')).toContainText('1 cue picked up at its position')
  await expect(backup.locator('.cue-row[data-running="true"]')).toHaveCount(1)

  const progress = await backup.evaluate(async () => {
    const bridge = (window as unknown as {
      winslab: { audio: { progress: (id: string) => Promise<{ elapsedMs: number } | null> } }
    }).winslab
    return bridge.audio.progress('a1')
  })
  expect(Math.round(progress?.elapsedMs ?? 0)).toBeGreaterThan(3000)
})
