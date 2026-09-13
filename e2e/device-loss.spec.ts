// The device going away mid-show. On a real backend this is the USB interface being
// unplugged, the Dante subscription dropping, another application taking exclusive
// access — and what the operator needs from it is definite: the sound stops rather than
// pouring into a device that is no longer there, the reason is on screen in the engine's
// own words, and the show can go on when the rig comes back.
//
// The engine runs its real classification (the same function its backend callback uses)
// and only accepts the test hook on the silent backend, so this cannot mask or imitate
// a genuine event. The engine is the real one either way.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'
import type { PlaybackDevHarness } from '../src/main/safety/devHarness'
import type { AudioEngineEvent, AudioErrorEvent } from '../src/shared/audio'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

async function engineVoices(): Promise<number | null> {
  return app.evaluate(async () => {
    const harness: PlaybackDevHarness | undefined = globalThis.__winslabDevHarness
    if (!harness) return null
    return (await harness.engineInfo()).activeVoices
  })
}

async function engineEvents(): Promise<AudioEngineEvent[]> {
  return app.evaluate(() => globalThis.__winslabDevHarness?.engineEvents() ?? [])
}

async function openDemo(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
}

/** The demo's walk-in, looped until something stops it. */
async function playWalkInForever(): Promise<void> {
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  await page.locator('.field-row').filter({ hasText: 'Loop count' }).locator('input').fill('-1')
  await page.getByRole('button', { name: /GO/ }).click()
}

test('a device that goes away mid-show silences the show, says why, and the show goes on', async () => {
  test.setTimeout(120_000)
  await openDemo()
  await playWalkInForever()
  await expect.poll(engineVoices, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

  // The device is gone.
  await app.evaluate(async () => {
    await globalThis.__winslabDevHarness?.simulateDeviceLoss()
  })

  // The engine stops what it was playing rather than playing into a dead device.
  await expect.poll(engineVoices, { timeout: 15_000, message: 'the show kept playing into a lost device' }).toBe(0)

  // And it says what happened, engine-wide, in its own words.
  await expect
    .poll(
      async () => (await engineEvents()).some((event) => event.type === 'error' && event.code === 'device'),
      { timeout: 10_000, message: 'no device error was reported' }
    )
    .toBe(true)
  const deviceError = (await engineEvents()).find(
    (event): event is AudioErrorEvent => event.type === 'error' && event.code === 'device'
  )
  expect(deviceError?.message).toMatch(/stopped unexpectedly/)
  // The fault belongs to the engine, not to a cue: the operator reads it as a device
  // problem rather than as something the cue did wrong.
  expect(deviceError?.cueId).toBeNull()

  // The session log carries it too, phrased as the engine speaking.
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('audio engine:')
  await expect(page.locator('.log-panel')).toContainText('stopped unexpectedly')

  // And it stays on screen while the condition lasts, where a rig is checked.
  await page.locator('.toolbar-brand').click()
  await page.getByRole('button', { name: /Settings/ }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(page.locator('.settings-warning')).toContainText('stopped unexpectedly', { timeout: 15_000 })
  await page.keyboard.press('Escape')

  // The show is not over: the same cue plays again on the same engine.
  await playWalkInForever()
  await expect.poll(engineVoices, { timeout: 15_000, message: 'nothing played after the device came back' }).toBeGreaterThanOrEqual(1)
  await page.locator('.btn-stop').click()
  await expect.poll(engineVoices, { timeout: 10_000 }).toBe(0)
})
