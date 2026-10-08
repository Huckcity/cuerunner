// The Live Input cue against the engine's real output: a test input (the engine's 1 kHz tone at
// −12 dBFS, offered when the machine has no input device the suite can rely on) played through
// as a voice, metered in the inspector with its time through the engine, held by the show-wide
// pause, and closed over its fade by STOP.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import { closeApp } from './helpers'
import { capturedChannelPeaks, cueBase, openShow } from './audioIo'

let app: ElectronApplication | undefined
let page: Page
let root: string

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

const row = () => page.locator('.cue-row', { hasText: 'Lectern' })

test('a live input plays through the engine, meters, pauses with the show and closes over its fade', async ({}, testInfo) => {
  test.setTimeout(90_000)
  let capturePath: string
  ;({ app, page, root, capturePath } = await openShow(testInfo, 'Live', {
    cues: [{
      ...cueBase('in1', '1', 'Lectern'), type: 'input', device: '', inputChannels: [0], volume: 1, pan: 0,
      fadeInDuration: 50, fadeOutDuration: 200, outputs: null
    }]
  }, { CUERUNNER_TEST_INPUTS: '1' }))

  await row().click()
  await expect(row()).toHaveAttribute('data-type', 'input')
  await expect(page.locator('.inspector-tab')).toHaveText(['Basics', 'Live Input', 'Triggers'])
  await page.locator('.inspector-tab', { hasText: 'Live Input' }).click()

  // The test inputs are offered beside whatever the machine has; pick the tone.
  await expect(page.locator('select.input-device option[value="test:tone"]')).toHaveCount(1)
  await page.locator('select.input-device').selectOption('test:tone')
  await page.locator('.input-channel[data-channel="2"]').check()

  // Opened ahead of the cue, the input is metered and its time through the engine is read.
  await page.locator('.input-open').click()
  await expect(page.locator('.input-latency')).toContainText('ms through the engine')
  await expect.poll(async () => page.locator('.input-meter[data-channel="1"] .level-meter-bar')
    .evaluate(node => parseFloat((node as HTMLElement).style.width)), { timeout: 5000 }).toBeGreaterThan(50)

  // GO: the tone is on the outputs, at its level (automatic routing, a mono pair as stereo).
  await page.keyboard.press('Space')
  await expect(row()).toHaveAttribute('data-running', 'true')
  await expect.poll(() => capturedChannelPeaks(capturePath, 200)[0] ?? 0, { timeout: 8000 }).toBeGreaterThan(0.2)
  expect(capturedChannelPeaks(capturePath, 200)[1]).toBeGreaterThan(0.2)

  // The show-wide pause holds it silent, and lets it go on.
  await page.keyboard.press('KeyP')
  await expect.poll(() => Math.max(...capturedChannelPeaks(capturePath, 200)), { timeout: 5000 }).toBe(0)
  await page.locator('.btn-pause').click()
  await expect.poll(() => capturedChannelPeaks(capturePath, 200)[0] ?? 0, { timeout: 5000 }).toBeGreaterThan(0.2)

  // A live change reaches it while it plays.
  await row().click()
  await page.locator('.inspector-tab', { hasText: 'Live Input' }).click()
  await page.locator('.input-volume').fill('0.5')
  await expect.poll(() => capturedChannelPeaks(capturePath, 150)[0] ?? 0, { timeout: 5000 }).toBeLessThan(0.15)

  // STOP closes it over its own fade-out, and it ends.
  await page.keyboard.press('Escape')
  await expect(row()).toHaveAttribute('data-running', 'false')
  await expect.poll(() => Math.max(...capturedChannelPeaks(capturePath, 200)), { timeout: 5000 }).toBe(0)
})

test('a live input is added from the toolbar, and with no channel chosen says so rather than playing', async ({}, testInfo) => {
  test.setTimeout(60_000)
  ;({ app, page, root } = await openShow(testInfo, 'Empty', { cues: [] }, { CUERUNNER_TEST_INPUTS: '1' }))
  await page.locator('.toolbar-more-btn').click()
  await page.locator('.toolbar-more-menu-item', { hasText: /^\s*Live Input\s*$/ }).click()
  const added = page.locator('.cue-row').first()
  await expect(added).toHaveAttribute('data-type', 'input')
  await expect(added.locator('.cue-icon[data-type="input"]')).toBeVisible()
  await page.locator('.inspector-tab', { hasText: 'Live Input' }).click()
  await page.locator('.input-channel[data-channel="1"]').uncheck()
  await expect(page.locator('.inspector')).toContainText('Choose at least one channel')
  await added.click()
  await page.keyboard.press('Space')
  // GO moves the selection on; the cue's own panel says what its run did.
  await added.click()
  await page.locator('.inspector-tab', { hasText: 'Live Input' }).click()
  await expect(page.locator('.inspector')).toContainText('no input channels chosen')
})
