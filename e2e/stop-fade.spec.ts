// The show's STOP fade, heard: with a fade set in Settings → General, Esc fades the output out
// rather than cutting it, and a second Esc during the fade cuts what is left.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { capturedOutputPeak, closeApp, launchApp } from './helpers'

let app: ElectronApplication | undefined
let page: Page
let root: string

function writeWav(filePath: string, seconds = 20): void {
  const sampleRate = 48000
  const frames = sampleRate * seconds
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 20) * 16000), 44 + i * 2)
  fs.writeFileSync(filePath, buffer)
}

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

test('Esc fades the show out over the STOP fade, and a second Esc cuts it', async ({}, testInfo) => {
  test.setTimeout(60_000)
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-parity-sweep-stop-fade-'))
  const media = path.join(root, 'tone.wav')
  writeWav(media)
  const showPath = path.join(root, 'Stop.cuerunner')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1, id: 'w-stop', name: 'Stop', createdAt: '2026-01-01T00:00:00.000Z',
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
  await page.locator('.file-menu-recent', { hasText: 'Stop.cuerunner' }).click()
  const tone = page.locator('.cue-row', { hasText: 'Tone' })
  await expect(tone.locator('.col-dur')).toHaveText('20.0s')

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  await page.locator('#settings-stop-fade').fill('4000')
  await page.locator('#settings-stop-fade').press('Enter')
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()

  await tone.click()
  await page.keyboard.press('Space')
  await expect.poll(() => capturedOutputPeak(capturePath, 200), { timeout: 8000 }).toBeGreaterThan(0.3)
  const full = capturedOutputPeak(capturePath, 200)

  await page.keyboard.press('Escape')
  // The row lets go at once; the sound is on its way down, not gone.
  await expect(tone).toHaveAttribute('data-running', 'false')
  await page.waitForTimeout(600)
  const fading = capturedOutputPeak(capturePath, 150)
  expect(fading).toBeGreaterThan(0.05)
  expect(fading).toBeLessThan(full)

  // The second press is the hard stop.
  await page.keyboard.press('Escape')
  await expect.poll(() => capturedOutputPeak(capturePath, 200), { timeout: 3000 }).toBe(0)
})
