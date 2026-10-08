// An audio cue's own fade-out, heard rather than inferred: the engine's real mixer output is
// captured to a file, and what is asserted is the shape of the cue's tail in it — a ramp down
// to silence where the cue ends, against a hard cut for the same cue without one.
import { test, expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication | undefined
let page: Page
let root: string

/** Three seconds of tone at a steady quarter level, so any fall in it is the cue's doing. */
function writeWav(filePath: string, seconds = 3): void {
  const sampleRate = 48000
  const frames = sampleRate * seconds
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) {
    buffer.writeInt16LE(Math.round(Math.sin(i / 20) * 8000), 44 + i * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

/**
 * The captured output as a list of peaks, one per 50 ms window. The engine writes 32-bit
 * float frames after a 44-byte header (see `capturedOutputPeak` in helpers.ts).
 */
function windowPeaks(filePath: string, windowMs = 50): number[] {
  const buffer = fs.readFileSync(filePath)
  const PCM_OFFSET = 44
  const channels = buffer.readUInt16LE(22) || 2
  const sampleRate = buffer.readUInt32LE(24) || 48000
  const bytesPerFrame = 4 * channels
  const frames = Math.floor((buffer.length - PCM_OFFSET) / bytesPerFrame)
  const perWindow = Math.max(1, Math.round((sampleRate * windowMs) / 1000))
  const peaks: number[] = []
  for (let start = 0; start + perWindow <= frames; start += perWindow) {
    let peak = 0
    for (let frame = start; frame < start + perWindow; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = Math.abs(buffer.readFloatLE(PCM_OFFSET + frame * bytesPerFrame + channel * 4))
        if (sample > peak) peak = sample
      }
    }
    peaks.push(peak)
  }
  return peaks
}

/** The cue's audible stretch, from the first window with sound to the last. */
function audible(peaks: number[]): number[] {
  const first = peaks.findIndex(peak => peak > 0.001)
  let last = peaks.length - 1
  while (last >= 0 && peaks[last] <= 0.001) last--
  return first < 0 ? [] : peaks.slice(first, last + 1)
}

async function openShow(testInfo: TestInfo): Promise<string> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-parity-sweep-fade-out-'))
  const media = path.join(root, 'tone.wav')
  writeWav(media)
  const showPath = path.join(root, 'Fade Out.cuerunner')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1,
    id: 'w-fade-out',
    name: 'Fade Out',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [{
      id: 'a1', number: '1', name: 'Tone', type: 'audio',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
      duration: 0, advance: 'none', isArmed: true, notes: '',
      filePath: media,
      startTime: 0, endTime: null, fadeInDuration: 0,
      volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
    }]
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  const capturePath = testInfo.outputPath('engine-output.wav')
  ;({ app, page } = await launchApp({ userDataDir, env: { CUERUNNER_TEST_AUDIO_CAPTURE: capturePath } }))

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Fade Out.cuerunner' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Tone' })).toBeVisible()
  // The file's length is measured before GO, so the run has an end to land the fade on.
  await expect(page.locator('.cue-row', { hasText: 'Tone' }).locator('.col-dur')).toHaveText('3.0s')
  return capturePath
}

/** Fires the tone and waits for the engine's own record of it to finish. */
async function playThrough(capturePath: string): Promise<number[]> {
  const row = page.locator('.cue-row', { hasText: 'Tone' })
  await row.click()
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(row).toHaveAttribute('data-running', 'true')
  await expect(row).toHaveAttribute('data-running', 'false', { timeout: 10_000 })
  // A little silence after the end, so the tail is in the file.
  await page.waitForTimeout(400)
  return audible(windowPeaks(capturePath))
}

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

test('with a fade-out the cue ramps down to silence where it ends', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const capturePath = await openShow(testInfo)

  await page.locator('.cue-row', { hasText: 'Tone' }).click()
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  const field = page.locator('.field-row', { hasText: 'Fade out' }).locator('input')
  await field.fill('1.5')
  await field.press('Enter')
  await expect(field).toHaveValue('1.5')

  const peaks = await playThrough(capturePath)
  const level = Math.max(...peaks.slice(0, 10))
  expect(level).toBeGreaterThan(0.1)
  // Full level well before the fade, and at most a sliver of it in the last audible window.
  expect(peaks[Math.floor(peaks.length * 0.25)]).toBeGreaterThan(level * 0.8)
  expect(peaks[peaks.length - 1]).toBeLessThan(level * 0.25)
  // Half-way through the fade it is clearly on its way down.
  const midFade = peaks[peaks.length - 1 - Math.round(750 / 50)]
  expect(midFade).toBeLessThan(level * 0.85)
  expect(midFade).toBeGreaterThan(level * 0.1)
})

test('without one the same cue stops at full level', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const capturePath = await openShow(testInfo)

  const peaks = await playThrough(capturePath)
  const level = Math.max(...peaks.slice(0, 10))
  expect(level).toBeGreaterThan(0.1)
  expect(peaks[peaks.length - 1]).toBeGreaterThan(level * 0.8)
})
