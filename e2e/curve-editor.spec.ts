// The curve editor: a Fade cue's shape picked from the presets or drawn by dragging a Bézier's
// handles, kept on the cue; and a fade drawn steep at the start heard steep at the start —
// the engine plays the curve the editor draws.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { closeApp } from './helpers'
import { audioCue, capturedChannelPeaks, cueBase, openShow, writeSineWav } from './audioIo'

let app: ElectronApplication | undefined
let page: Page
let root: string

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

test('a fade\'s shape is drawn by its handles, kept on the cue, and played as drawn', async ({}, testInfo) => {
  test.setTimeout(90_000)
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  const bed = path.join(testInfo.outputDir, 'bed.wav')
  writeSineWav(bed, { seconds: 30, levelDb: -6 })
  let capturePath: string
  ;({ app, page, root, capturePath } = await openShow(testInfo, 'Curves', {
    cues: [
      audioCue('a1', '1', 'Bed', bed),
      {
        ...cueBase('f1', '2', 'Duck'), type: 'fade', duration: 4000, targetCueId: 'a1', fadeProperty: 'volume',
        targetValue: 0, curve: 'linear', stopTargetWhenDone: false
      }
    ]
  }))

  const fade = page.locator('.cue-row', { hasText: 'Duck' })
  await fade.click()
  await page.locator('.inspector-tab', { hasText: /^Fade$/ }).click()
  const editor = page.locator('.curve-editor[data-name="fade"]')
  await expect(editor.locator('.curve-editor-plot')).toHaveCount(0)

  // A preset draws its curve.
  await editor.locator('select.curve-select').selectOption('equalPower')
  await expect(editor.locator('.curve-editor-plot')).toBeVisible()
  await expect(editor.locator('.curve-handle')).toHaveCount(0)

  // Custom puts two handles on the line; dragging the first up and left bows the curve.
  await editor.locator('select.curve-select').selectOption('bezier')
  await expect(editor.locator('.curve-handle')).toHaveCount(2)
  const before = await editor.locator('.curve-editor-path').getAttribute('d')
  const plot = await editor.locator('.curve-editor-plot').boundingBox()
  const handle = await editor.locator('.curve-handle-1').boundingBox()
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(plot!.x + 2, plot!.y + 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => editor.locator('.curve-editor-path').getAttribute('d')).not.toBe(before)
  const cx = Number(await editor.locator('.curve-handle-1').getAttribute('cx'))
  const cy = Number(await editor.locator('.curve-handle-1').getAttribute('cy'))
  expect(cx).toBeLessThan(10)
  expect(cy).toBeLessThan(10)

  // Kept on the cue: away and back, the editor draws it again.
  await page.locator('.cue-row', { hasText: 'Bed' }).click()
  await fade.click()
  await page.locator('.inspector-tab', { hasText: /^Fade$/ }).click()
  await expect(editor.locator('select.curve-select')).toHaveValue('bezier')
  expect(Number(await editor.locator('.curve-handle-1').getAttribute('cx'))).toBeLessThan(10)

  // Played as drawn: a quarter of the way into the fade, a curve pulled up at its start has
  // done most of its change — where a straight line would still be at three quarters.
  await page.locator('.cue-row', { hasText: 'Bed' }).click()
  await page.keyboard.press('Space')
  await expect.poll(() => capturedChannelPeaks(capturePath, 200)[0] ?? 0, { timeout: 8000 }).toBeGreaterThan(0.4)
  // Past the repeat guard, so the second GO is a GO of its own.
  await page.waitForTimeout(400)
  await fade.click()
  await page.keyboard.press('Space')
  await expect(fade).toHaveAttribute('data-running', 'true')
  await page.waitForTimeout(1000)
  // One second into four: a line would leave 0.5 × 0.75 = 0.375; this curve leaves far less.
  expect(capturedChannelPeaks(capturePath, 100)[0]).toBeLessThan(0.2)
})

test('an audio cue\'s fade in and fade out each take a shape', async ({}, testInfo) => {
  test.setTimeout(60_000)
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  const bed = path.join(testInfo.outputDir, 'bed.wav')
  writeSineWav(bed, { seconds: 3 })
  ;({ app, page, root } = await openShow(testInfo, 'Shapes', { cues: [audioCue('a1', '1', 'Bed', bed)] }))
  await page.locator('.cue-row', { hasText: 'Bed' }).click()
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  await page.locator('.curve-editor[data-name="audio-fade-in"] select.curve-select').selectOption('sCurve')
  await page.locator('.curve-editor[data-name="audio-fade-out"] select.curve-select').selectOption('exponential')
  await expect(page.locator('.curve-editor[data-name="audio-fade-in"] .curve-editor-plot')).toBeVisible()
  await expect(page.locator('.curve-editor[data-name="audio-fade-out"] select.curve-select')).toHaveValue('exponential')
  // Default takes it back to what the cue always did.
  await page.locator('.curve-editor[data-name="audio-fade-in"] select.curve-select').selectOption('default')
  await expect(page.locator('.curve-editor[data-name="audio-fade-in"] .curve-editor-plot')).toHaveCount(0)
})
