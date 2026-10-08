// Output patches and the mixer, against the engine's real output: a cue that plays through a
// patch lands on the outputs the patch names; the patch's fader and mute and an output's own
// fader in the mixer take it down where they should; a patch's meter reads what it sends; and
// a patch is added and chosen the way an operator does it.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { closeApp } from './helpers'
import { audioCue, capturedChannelPeaks, openShow, writeSineWav } from './audioIo'

let app: ElectronApplication | undefined
let page: Page
let root: string

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

const PATCHES = [
  { id: 'mains', name: 'Mains', deviceId: '', channels: [0, 1], gainDb: 0, muted: false },
  { id: 'fold', name: 'Foldback', deviceId: '', channels: [2, 3], gainDb: 0, muted: false }
]

test('a cue through a patch plays on its outputs, and the mixer\'s faders and mutes take it down', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const media = path.join(testInfo.outputDir, 'tone.wav')
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  writeSineWav(media, { seconds: 30, levelDb: -6 })
  let capturePath: string
  ;({ app, page, root, capturePath } = await openShow(testInfo, 'Patched', {
    audioSettings: { outputPatches: PATCHES },
    cues: [audioCue('a1', '1', 'Monitor mix', media, { outputPatchId: 'fold' })]
  }, { CUERUNNER_AUDIO_CHANNELS: '4' }))
  const cue = page.locator('.cue-row', { hasText: 'Monitor mix' })
  await cue.click()
  await page.locator('.inspector-tab', { hasText: /^Audio$/ }).click()
  await expect(page.locator('select.patch-select')).toHaveValue('fold')
  await cue.click()
  await page.keyboard.press('Space')

  // Outputs 3 and 4 carry it; the mains hear nothing.
  await expect.poll(() => capturedChannelPeaks(capturePath, 200), { timeout: 10_000 })
    .toEqual([0, 0, expect.any(Number), expect.any(Number)])
  await expect.poll(() => capturedChannelPeaks(capturePath, 200)[2], { timeout: 5000 }).toBeGreaterThan(0.4)

  await page.locator('.mixer-open').click()
  const mixer = page.getByRole('dialog', { name: 'Mixer' })
  await expect(mixer.locator('.mixer-strip[data-kind="patch"]')).toHaveCount(2)
  await expect(mixer.locator('.mixer-strip[data-kind="output"]')).toHaveCount(4)

  // The patch's meter reads what it sends.
  const fold = mixer.locator('.mixer-strip[data-strip="patch-fold"]')
  await expect.poll(async () => fold.locator('.mixer-meter-bar').first()
    .evaluate(node => parseFloat((node as HTMLElement).style.height)), { timeout: 5000 }).toBeGreaterThan(50)

  // Its mute silences it, and lets it back.
  await fold.locator('.mixer-mute').click()
  await expect.poll(() => capturedChannelPeaks(capturePath, 150)[2], { timeout: 5000 }).toBe(0)
  await fold.locator('.mixer-mute').click()
  await expect.poll(() => capturedChannelPeaks(capturePath, 150)[2], { timeout: 5000 }).toBeGreaterThan(0.4)

  // Its fader at −6 dB halves it.
  await fold.locator('.mixer-fader').fill('-6')
  await expect(fold.locator('.mixer-readout')).toHaveText('−6.0 dB')
  await expect.poll(() => capturedChannelPeaks(capturePath, 150)[2], { timeout: 5000 }).toBeLessThan(0.3)
  await fold.locator('.mixer-readout').dblclick()
  await expect(fold.locator('.mixer-readout')).toHaveText('0.0 dB')

  // An output's own fader takes that output down and leaves its neighbour.
  const out3 = mixer.locator('.mixer-strip[data-strip="output-3"]')
  await out3.locator('.mixer-fader').fill('-60')
  await expect(out3.locator('.mixer-readout')).toHaveText('−∞')
  await expect.poll(() => capturedChannelPeaks(capturePath, 150), { timeout: 5000 })
    .toEqual([0, 0, 0, expect.any(Number)])
  expect(capturedChannelPeaks(capturePath, 150)[3]).toBeGreaterThan(0.4)

  // The faders are the show's, held where they were left: closed and opened again, the
  // mixer reads them back.
  await mixer.locator('.mixer-close').click()
  await expect(mixer).toHaveCount(0)
  await page.locator('.mixer-open').click()
  await expect(page.getByRole('dialog', { name: 'Mixer' }).locator('.mixer-strip[data-strip="output-3"] .mixer-readout')).toHaveText('−∞')
})

test('a patch is added in Settings and a cue is pointed at it', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const media = path.join(testInfo.outputDir, 'tone.wav')
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  writeSineWav(media, { seconds: 5 })
  ;({ app, page, root } = await openShow(testInfo, 'Plain', { cues: [audioCue('a1', '1', 'Song', media)] }))

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="settings"]').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.locator('.settings-tab', { hasText: 'Audio' }).click()
  await settings.locator('.patch-add').click()
  const entry = settings.locator('.patch-entry').first()
  await entry.locator('.patch-name').fill('Delays')
  await entry.locator('.patch-name').press('Enter')
  await entry.locator('.patch-channels').fill('5, 6')
  await entry.locator('.patch-channels').press('Enter')
  // Written back the way it reads: two neighbouring outputs are a range.
  await expect(entry.locator('.patch-channels')).toHaveValue('5–6')
  await settings.locator('select.audition-patch').selectOption({ label: 'Delays' })
  await settings.getByRole('button', { name: 'Close' }).click()

  await page.locator('.cue-row', { hasText: 'Song' }).click()
  await page.locator('.inspector-tab', { hasText: /^Audio$/ }).click()
  await page.locator('select.patch-select').selectOption({ label: 'Delays (5–6)' })
  await expect(page.locator('select.patch-select')).toHaveValue('patch-1')
})
