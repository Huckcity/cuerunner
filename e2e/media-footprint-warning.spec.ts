// A workspace whose media the engine will stream is announced before the show is run,
// and measuring it must not pull any of that media into memory.
//
// The fixture is a WAV whose header declares 80 MB of audio with the data chunk left as
// a hole: `stat` sees a real 80 MB file, the header-only probe reads about 160 MB
// decoded, and the spec itself writes neither. Nothing but the header is ever read.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'
import type { PlaybackDevHarness } from '../src/main/safety/devHarness'

const MB = 1024 * 1024

let tempDirs: string[] = []

test.afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

/** 16-bit stereo 48 kHz, declaring `dataBytes` of audio behind a real header. */
function writeSparseWav(file: string, dataBytes = 80 * MB): void {
  const sampleRate = 48000
  const channels = 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)                        // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataBytes, 40)

  fs.writeFileSync(file, header)
  fs.truncateSync(file, 44 + dataBytes)              // the tail is holes, not bytes
}

function longShow(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-footprint-'))
  tempDirs.push(root)
  const media = path.join(root, 'overture.wav')
  writeSparseWav(media)

  const workspace = {
    version: 1,
    id: 'w-footprint',
    name: 'Long Show',
    createdAt: new Date().toISOString(),
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [{
      id: 'a1', number: '1', name: 'Overture', type: 'audio',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      filePath: media, startTime: 0, endTime: null, fadeInDuration: 0,
      volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
    }]
  }

  const cuerunner = path.join(root, 'Long Show.cuerunner')
  fs.writeFileSync(cuerunner, JSON.stringify(workspace, null, 2))
  return cuerunner
}

async function openShow(page: Page, userDataDir: string, cuerunner: string): Promise<void> {
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([cuerunner]))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: path.basename(cuerunner) }).click()
  await expect(page.locator('.cue-row', { hasText: 'Overture' })).toBeVisible()
}

/** Settings opens on General; the engine readout, and the warnings beside it, are the
    Audio tab's. */
async function openSettingsAudio(page: Page) {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Audio', exact: true }).click()
  return dialog
}

test('a workspace the engine will stream is announced, and measuring it decodes nothing', async () => {
  const cuerunner = longShow()
  const { app, page, userDataDir } = await launchApp()
  try {
    await openShow(page, userDataDir, cuerunner)
    const dialog = await openSettingsAudio(page)

    // The estimate is the engine's, and it says what will happen to the file.
    const warning = dialog.locator('.settings-warning')
    await expect(warning).toBeVisible({ timeout: 15_000 })
    await expect(warning).toContainText('per-file cache bound')
    await expect(warning).toContainText('stream from disk')

    // Measuring the show decoded nothing: the engine's own numbers say so, both in the
    // dialog and from the main process.
    const memory = dialog.locator('.field-row', { hasText: 'Media memory' }).locator('.settings-info')
    await expect(memory).toContainText('0 B resident')

    const info = await app.evaluate(async () => {
      const harness: PlaybackDevHarness | undefined = globalThis.__cuerunnerDevHarness
      return harness ? harness.engineInfo() : null
    })
    expect(info).not.toBeNull()
    expect(info!.cache.bytes).toBe(0)
    expect(info!.media.residentBytes).toBe(0)
  } finally {
    await closeApp(app)
  }
})
