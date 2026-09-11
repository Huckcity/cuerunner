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

test('a stop cue aimed at a script takes that run away too', async () => {
  await addScriptCue('while (true) {}', 120_000)
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(page.locator('.running-badge')).toContainText('1 running')

  // A stop cue for the script alone, not for everything.
  await page.locator('.toolbar-cue-btn', { hasText: 'Stop' }).click()
  await page.locator('.inspector-tab', { hasText: 'Stop' }).click()
  await page.locator('.field-row').filter({ hasText: 'Target' }).locator('select').selectOption({ index: 1 })

  await page.locator('.cue-row').nth(1).click()
  await page.getByRole('button', { name: /GO/ }).click()

  // The script is gone, and it records nothing: nothing was wrong with it.
  await expect(page.locator('.running-badge')).toHaveText('idle')
  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await expect(page.locator('.last-run-badge')).toHaveCount(0)

  // The interface answered throughout, and the show still runs.
  await expect.poll(() => page.evaluate(() => 1 + 1)).toBe(2)
  await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
  await page.locator('.cue-row').nth(2).click()
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(page.locator('.running-badge')).toContainText('1 running')
})

test('a stop cue aimed at a group reaches the scripts inside it', async () => {
  // A group whose children both never yield: stopping the group has to stop the one
  // that is running and keep the sequence from firing the next one.
  await page.locator('.toolbar-cue-btn', { hasText: 'Group' }).click()
  await addScriptCue('while (true) {}', 120_000)
  await addScriptCue('while (true) {}', 120_000)
  await expect(page.locator('.cue-row[data-depth="1"]')).toHaveCount(2)

  await page.locator('.cue-row').first().click()
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(page.locator('.running-badge')).toContainText('running')

  // The stop cue lands outside the group, aimed at the group itself.
  await page.locator('.cue-list-scroll').click({ position: { x: 60, y: 200 } })
  await page.locator('.toolbar-cue-btn', { hasText: 'Stop' }).click()
  await page.locator('.inspector-tab', { hasText: 'Stop' }).click()
  await page.locator('.field-row').filter({ hasText: 'Target' }).locator('select').selectOption({ index: 1 })
  await page.locator('.cue-row').last().click()
  await page.getByRole('button', { name: /GO/ }).click()

  // Both children are gone, and the group does not carry on to the second.
  await expect(page.locator('.running-badge')).toHaveText('idle')
  await page.waitForTimeout(1000)
  await expect(page.locator('.running-badge')).toHaveText('idle')

  // The child that was stopped records nothing: nothing was wrong with it.
  await page.locator('.cue-row[data-depth="1"]').first().click()
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await expect(page.locator('.last-run-badge')).toHaveCount(0)
})
