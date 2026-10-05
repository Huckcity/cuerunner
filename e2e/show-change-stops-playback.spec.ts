/**
 * A show that is replaced stops playing.
 *
 * Loading a show only swapped the cue list: the store forgot what was running, the engine
 * went on playing it, and the sound carried on under a transport that said "idle", over a
 * list the cue was no longer in. The first-show guide walks straight into it — open the
 * demo, press GO, then File → New.
 *
 * The demo's walk-in loops until it is faded out, so it has no end of its own to reach:
 * what silences the engine here is the show being replaced, and nothing else can.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

/** The engine's own count of the voices it is playing, read in the main process. */
function activeVoices(): Promise<number> {
  return app.evaluate(async () => (await globalThis.__cuerunnerDevHarness?.engineInfo())?.activeVoices ?? 0)
}

test('File → New silences the show that was playing', async () => {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  const walkIn = page.locator('.cue-row', { hasText: 'Walk-in Music' })
  await walkIn.click()
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(page.locator('.running-badge')).toHaveText('1 running')
  await expect
    .poll(activeVoices, { timeout: 5000, message: 'the engine should have a voice playing' })
    .toBeGreaterThan(0)

  // The demo opens clean and nothing has edited it, so New does not ask.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="new"]').click()

  await expect(page.locator('.cue-list-empty')).toBeVisible()
  await expect(page.locator('.running-badge')).toHaveText('idle')
  // And the engine agrees with the transport: the voice is gone, not just forgotten.
  await expect
    .poll(activeVoices, { timeout: 5000, message: 'the engine should have stopped the old show' })
    .toBe(0)

  // The silence nobody pressed for is explained where the operator looks for explanations.
  await page.locator('.dock-tab.btn-log').click()
  await expect(page.locator('.log-row', { hasText: 'stopped what was running: another show was opened' }))
    .toBeVisible()
})
