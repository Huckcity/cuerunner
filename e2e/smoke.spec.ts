import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers'
import type { PlaybackDevHarness } from '../src/main/safety/devHarness'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

test('toolbar is visible', async () => {
  await expect(page.locator('.toolbar')).toBeVisible()
})

test('transport bar is visible', async () => {
  await expect(page.locator('.transport-bar')).toBeVisible()
})

test('GO button is visible', async () => {
  await expect(page.getByRole('button', { name: /GO/ })).toBeVisible()
})

test('cue list starts empty', async () => {
  await expect(page.locator('.cue-row')).toHaveCount(0)
})

test('inspector shows empty state when no cue is selected', async () => {
  await expect(page.locator('.inspector-empty')).toBeVisible()
})

test('the app holds the OS off its timers', async () => {
  // Read in main rather than through the page: an app macOS has napped dispatches its
  // cues late, and the window is not the process that has to stay awake.
  const held = await app.evaluate(() => {
    const harness: PlaybackDevHarness | undefined = globalThis.__winslabDevHarness
    return harness ? harness.keepAwakeHeld() : null
  })

  expect(held).toBe(true)
})

test('the audio engine is running', async () => {
  // A machine with no audio device still gets an engine — the silent backend — so this
  // holds everywhere the suite runs. The assertion reports the whole status on failure,
  // which carries the engine's own last words (its stderr, kept by main): on a Windows
  // runner none of that output reaches the log any other way.
  await expect
    .poll(async () => app.evaluate(() => globalThis.__winslabDevHarness?.engineStatus() ?? null), {
      timeout: 10_000,
      message: 'the audio engine should be up and connected'
    })
    .toMatchObject({ started: true, connected: true })
})
