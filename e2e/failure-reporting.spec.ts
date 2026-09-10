// What the operator can see when a cue could not do what it says. A missing MIDI port
// and an OSC host that does not resolve used to fire silently; both are now reported in
// the inspector's Last Run and in the log.
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

// Firing a cue advances the selection, so the cue is selected again before its run
// result is read.
async function selectFirstCue(): Promise<void> {
  await page.locator('.cue-row').first().click()
}

test('a MIDI cue that reached no port is reported as failed', async () => {
  await addCueFromMoreMenu(page, 'MIDI')
  await page.locator('.inspector-tab', { hasText: 'MIDI' }).click()
  // No ports exist in the test environment, so the inspector offers a free-text field
  // and the cue has nowhere to go.
  const port = page.locator('.field-row').filter({ hasText: 'MIDI Port' }).locator('input')
  await expect(port).toHaveAttribute('placeholder', 'No MIDI ports found')

  await page.getByRole('button', { name: /GO/ }).click()
  await selectFirstCue()
  await page.locator('.inspector-tab', { hasText: 'MIDI' }).click()

  await expect(page.locator('.last-run-badge')).toHaveText('failed')
  await expect(page.locator('.last-run-error')).toContainText('No MIDI output port is set for this cue')
})

test('an OSC cue whose host cannot be resolved is reported as failed', async () => {
  await addCueFromMoreMenu(page, 'OSC')
  await page.locator('.inspector-tab', { hasText: 'OSC' }).click()
  await page.locator('.field-row').filter({ hasText: 'Host' }).locator('input').fill('no-such-host.invalid')

  await page.getByRole('button', { name: /GO/ }).click()
  await selectFirstCue()
  await page.locator('.inspector-tab', { hasText: 'OSC' }).click()

  await expect(page.locator('.last-run-badge')).toHaveText('failed', { timeout: 10_000 })
  await expect(page.locator('.last-run-error')).toContainText('ENOTFOUND')
})

test('an OSC cue that is sent reports ok', async () => {
  await addCueFromMoreMenu(page, 'OSC')
  await page.locator('.inspector-tab', { hasText: 'OSC' }).click()
  // UDP to a port nothing listens on still sends: there is no delivery report, and the
  // cue must not be reported as a failure for it.
  await page.locator('.field-row').filter({ hasText: 'Host' }).locator('input').fill('127.0.0.1')

  await page.getByRole('button', { name: /GO/ }).click()
  await selectFirstCue()
  await page.locator('.inspector-tab', { hasText: 'OSC' }).click()

  await expect(page.locator('.last-run-badge')).toHaveText('ok')
})

test('every cue type shows its last run, including a wait cue', async () => {
  await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await page.locator('.field-row').filter({ hasText: 'Duration' }).locator('input').fill('150')

  await page.getByRole('button', { name: /GO/ }).click()
  await selectFirstCue()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()

  await expect(page.locator('.last-run-badge')).toHaveText('ok')
  await expect(page.locator('.last-run-error')).toHaveCount(0)
})
