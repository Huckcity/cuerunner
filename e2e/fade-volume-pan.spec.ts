// A fade of volume and pan together, heard: a sound faded hard left is gone from the right.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication | undefined
let page: Page
let root: string

function writeWav(filePath: string, seconds = 10): void {
  const sampleRate = 48000
  const frames = sampleRate * seconds
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 20) * 8000), 44 + i * 2)
  fs.writeFileSync(filePath, buffer)
}

/** Each output channel's peak over the last `windowMs` of the engine's captured output. */
function channelPeaks(filePath: string, windowMs: number): number[] {
  const buffer = fs.readFileSync(filePath)
  const PCM_OFFSET = 44
  const channels = buffer.readUInt16LE(22) || 2
  const sampleRate = buffer.readUInt32LE(24) || 48000
  const frames = Math.floor((buffer.length - PCM_OFFSET) / (4 * channels))
  const windowFrames = Math.min(frames, Math.ceil((sampleRate * windowMs) / 1000))
  const peaks = new Array<number>(channels).fill(0)
  for (let frame = frames - windowFrames; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.abs(buffer.readFloatLE(PCM_OFFSET + (frame * channels + channel) * 4))
      if (sample > peaks[channel]) peaks[channel] = sample
    }
  }
  return peaks
}

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

test('a fade of volume and pan takes a centred sound out of the right side altogether', async ({}, testInfo) => {
  test.setTimeout(60_000)
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-parity-sweep-fade-pan-'))
  const media = path.join(root, 'tone.wav')
  writeWav(media)
  const showPath = path.join(root, 'Pan.cuerunner')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1, id: 'w-pan', name: 'Pan', createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' }, midiSettings: { outputPortName: '' },
    cues: [{
      id: 'a1', number: '1', name: 'Tone', type: 'audio',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
      duration: 0, advance: 'none', isArmed: true, notes: '',
      filePath: media, startTime: 0, endTime: null, fadeInDuration: 0,
      volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
    }]
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  const capturePath = testInfo.outputPath('engine-output.wav')
  ;({ app, page } = await launchApp({ userDataDir, env: { CUERUNNER_TEST_AUDIO_CAPTURE: capturePath } }))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Pan.cuerunner' }).click()
  const tone = page.locator('.cue-row[data-type="audio"]')
  await expect(tone.locator('.col-dur')).toHaveText('10.0s')

  // A fade made with the tone selected is aimed at it; make it a fade of both.
  await tone.click()
  await toolbarCueBtn(page, 'Fade').click()
  await page.locator('.inspector-tab', { hasText: 'Fade' }).click()
  const property = page.locator('.field-row', { hasText: 'Property' }).locator('select')
  await property.selectOption('both')
  await page.locator('.field-row', { hasText: 'Target volume' }).locator('input').fill('1')
  const pan = page.locator('.field-row', { hasText: 'Target pan' }).locator('input')
  await pan.fill('-1')
  await page.locator('.field-row', { hasText: 'Duration (s)' }).locator('input').fill('0.3')
  await page.locator('.field-row', { hasText: 'Stop target when done' }).locator('input').uncheck()

  // It is still a fade of both when it is selected again.
  await tone.click()
  await page.locator('.cue-row[data-type="fade"]').click()
  await page.locator('.inspector-tab', { hasText: 'Fade' }).click()
  await expect(property).toHaveValue('both')
  await expect(pan).toHaveValue('-1')

  // Play the tone, centred, then the fade.
  await tone.click()
  await page.keyboard.press('Space')
  await expect.poll(() => channelPeaks(capturePath, 200)[1], { timeout: 8000 }).toBeGreaterThan(0.05)
  await page.waitForTimeout(400)
  await page.keyboard.press('Space')

  await expect.poll(() => channelPeaks(capturePath, 200)[1], { timeout: 5000 }).toBeLessThan(0.001)
  expect(channelPeaks(capturePath, 200)[0]).toBeGreaterThan(0.05)
})
