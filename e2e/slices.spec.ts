// Slices: a cue's file cut at a marker placed on its waveform, a slice made a vamp there, and
// the engine holding it there past the end of the file until a devamp set to stop at the end of
// the slice ends it. The inspector's Slices tab reads them back.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { closeApp } from './helpers'
import { audioCue, capturedChannelPeaks, cueBase, openShow, writeSineWav } from './audioIo'

let app: ElectronApplication | undefined
let page: Page
let root: string

/** A marker placed on the waveform at a fraction of it: the cursor there, then M. Its time, ms. */
async function markerAt(fraction: number): Promise<number> {
  const stage = (await page.locator('.waveform-stage').boundingBox())!
  await page.mouse.click(stage.x + stage.width * fraction, stage.y + stage.height * 0.6)
  await expect(page.locator('.waveform-cursor')).toBeVisible()
  await page.keyboard.press('m')
  const grip = page.locator('.slice-marker-grip').first()
  await expect(grip).toBeVisible()
  return Number(await grip.getAttribute('aria-valuenow'))
}

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

test('a slice made a vamp holds the cue past its file until a devamp ends it at the slice', async ({}, testInfo) => {
  test.setTimeout(90_000)
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  const song = path.join(testInfo.outputDir, 'song.wav')
  writeSineWav(song, { seconds: 2, levelDb: -6 })
  let capturePath: string
  ;({ app, page, root, capturePath } = await openShow(testInfo, 'Sliced', {
    cues: [
      audioCue('a1', '1', 'Groove', song, { duration: 2000 }),
      { ...cueBase('d1', '2', 'Out'), type: 'devamp', targetCueId: 'a1' }
    ]
  }))

  const groove = page.locator('.cue-row', { hasText: 'Groove' })
  await groove.click()
  await page.locator('.inspector-tab', { hasText: 'Slices' }).click()
  await expect(page.locator('.slices-summary')).toContainText('No slices')
  await expect(page.locator('.waveform-total')).toHaveText('0:02.0')

  // A marker at 0.5 s, and the second slice a vamp — both made on the waveform.
  expect(Math.abs(await markerAt(0.25) - 500)).toBeLessThanOrEqual(10)
  await expect(page.locator('.slice-region')).toHaveCount(2)
  await page.locator('.slice-region').nth(1).click()
  await page.getByRole('menu', { name: 'Slice 2 plays' }).locator('[data-count="-1"]').click()
  await expect(page.locator('.slice-region .slice-region-count')).toHaveText(['×1', '∞'])
  await expect(page.locator('.slice-region[data-vamp="true"]')).toHaveCount(1)
  await expect(page.locator('.slices-summary')).toContainText('2 slices · 1 vamp — holds until a devamp')
  await expect(page.locator('.slice-marker-row')).toHaveCount(1)

  // The devamp stops its target at the end of the slice.
  await page.locator('.cue-row', { hasText: 'Out' }).click()
  await page.locator('.inspector-tab', { hasText: 'Devamp' }).click()
  await page.locator('select.devamp-mode').selectOption('stop')

  await groove.click()
  await page.keyboard.press('Space')
  await expect(groove).toHaveAttribute('data-running', 'true')
  // Four seconds in, a two-second file is still sounding: the vamp holds it.
  await page.waitForTimeout(4000)
  await expect(groove).toHaveAttribute('data-running', 'true')
  expect(capturedChannelPeaks(capturePath, 200)[0]).toBeGreaterThan(0.3)

  await page.locator('.cue-row', { hasText: 'Out' }).click()
  await page.keyboard.press('Space')
  // The pass it is on finishes (at most 1.5 s), and the cue ends there.
  await expect(groove).toHaveAttribute('data-running', 'false', { timeout: 4000 })
  await expect.poll(() => Math.max(...capturedChannelPeaks(capturePath, 200)), { timeout: 4000 }).toBe(0)
})

test('a slice set to play 0 times is struck out on the waveform and skipped when the cue plays', async ({}, testInfo) => {
  test.setTimeout(90_000)
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  const song = path.join(testInfo.outputDir, 'song.wav')
  writeSineWav(song, { seconds: 3, levelDb: -6 })
  ;({ app, page, root } = await openShow(testInfo, 'Skipped', {
    cues: [audioCue('a1', '1', 'Count-in', song, { duration: 3000 })]
  }))

  const cue = page.locator('.cue-row', { hasText: 'Count-in' })
  await cue.click()
  await page.locator('.inspector-tab', { hasText: 'Slices' }).click()
  await expect(page.locator('.waveform-total')).toHaveText('0:03.0')
  const marker = await markerAt(1 / 3)
  expect(Math.abs(marker - 1000)).toBeLessThanOrEqual(10)
  await expect(page.locator('.slice-region')).toHaveCount(2)
  // The first second is a count-in this run leaves out: 0 on the focused piece skips it.
  await page.locator('.slice-region').first().focus()
  await page.keyboard.press('0')
  await expect(page.locator('.slice-region .slice-region-count')).toHaveText(['skip', '×1'])
  await expect(page.locator('.slice-region[data-skip="true"]')).toHaveCount(1)
  await expect(page.locator('.slice-tint[data-kind="skip"]')).toHaveCount(1)
  await expect(page.locator('.slices-summary')).toContainText('2 slices · 1 skipped — plays for 2.0s')

  await cue.click()
  await page.keyboard.press('Space')
  await expect(cue).toHaveAttribute('data-running', 'true')
  // The engine starts at the slice after the skipped one: nothing before the marker is played.
  const position = () => page.evaluate(async () => {
    const bridge = (window as unknown as {
      cuerunner: { audio: { progress: (id: string) => Promise<{ elapsedMs: number } | null> } }
    }).cuerunner
    return (await bridge.audio.progress('a1'))?.elapsedMs ?? null
  })
  await expect.poll(position, { timeout: 4000 }).not.toBeNull()
  expect(await position()).toBeGreaterThanOrEqual(marker - 1)
  await expect(cue).toHaveAttribute('data-running', 'false', { timeout: 5000 })
})
