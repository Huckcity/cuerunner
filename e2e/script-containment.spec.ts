// Script cues run on a worker thread, so the interface survives a script that never
// yields — and the timeout or STOP can take the script away from it.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { addCueFromMoreMenu, closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

async function addScriptCue(script: string, timeoutMs: number): Promise<void> {
  await addCueFromMoreMenu(page, 'Script')
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await page.locator('.inspector-code').fill(script)
  await page.locator('.field-row').filter({ hasText: 'Timeout' }).locator('input').fill(String(timeoutMs))
}

test('a script that never yields is stopped by its timeout, not by the app hanging', async () => {
  await addScriptCue('while (true) {}', 1500)

  // The timeout is a stored cue field, not just an editor value
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await expect(page.locator('.field-row').filter({ hasText: 'Timeout' }).locator('input')).toHaveValue('1500')

  await page.getByRole('button', { name: /GO/ }).click()

  // The interface answers while the script spins: this call hangs if the script is
  // running on the renderer's thread.
  await expect.poll(() => page.evaluate(() => 1 + 1)).toBe(2)

  // The run is reported as a failure and releases the show
  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await expect(page.locator('.last-run-badge')).toHaveText('failed', { timeout: 10_000 })
  await expect(page.locator('.last-run-error')).toContainText('timed out after 1500 ms')
  await expect(page.locator('.running-badge')).toHaveText('idle')
})

test('STOP takes a running script away with it', async () => {
  // Long enough that the timeout cannot be what ends this run
  await addScriptCue('while (true) {}', 120_000)
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(page.locator('.running-badge')).toContainText('1 running')

  // The STOP button, not Escape: focus is in the script textarea, where the keyboard
  // shortcut is deliberately inert.
  await page.locator('.btn-stop').click()

  await expect(page.locator('.running-badge')).toHaveText('idle')
  await expect(page.locator('.last-run-badge')).toHaveCount(0)

  // The app is still a working show: a following cue fires normally.
  await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
  await page.locator('.cue-row').nth(1).click()
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(page.locator('.running-badge')).toContainText('1 running')
})
