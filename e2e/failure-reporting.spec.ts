// What the operator can see when a cue could not do what it says. A missing MIDI port
// and an OSC host that does not resolve used to fire silently; both are now reported in
// the inspector's Last Run and in the log — and, because GO has moved the selection on by
// the time a cue fails, on the cue's own row and on the Log tab, which are the two parts
// of that report still on screen.
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
  // What the machine can say differs — a missing module and a missing port are both
  // real — but the cue must fail visibly and say what it was about. The exact sentence
  // is not the contract.
  await expect(page.locator('.last-run-error')).toBeVisible()
  await expect(page.locator('.last-run-error')).toContainText('MIDI')
})

test('a cue that failed says so on its row and on the Log tab, with nothing reselected', async () => {
  await addCueFromMoreMenu(page, 'MIDI')
  // A second cue, so GO has somewhere to move the selection on to: the inspector is on
  // this one by the time the MIDI cue has failed.
  await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
  const midi = page.locator('.cue-row').first()
  await midi.click()
  await expect(midi.locator('.failed-pill')).toHaveCount(0)
  await expect(page.locator('.dock-tab.btn-log .dock-tab-count')).toHaveCount(0)

  await page.getByRole('button', { name: /GO/ }).click()
  await expect(page.locator('.cue-row').nth(1)).toHaveAttribute('data-selected', 'true')

  // The row carries the failure, and the reason is on the mark itself.
  await expect(midi.locator('.failed-pill')).toHaveText('failed')
  await expect(midi).toHaveAttribute('data-failed', 'true')
  await expect(midi.locator('.failed-pill')).toHaveAttribute('title', /^Last run failed: .*MIDI/)
  // And the tab of the panel that explains it counts what has not been read.
  // (Not held to a number: a machine with no MIDI at all has said so in the log already.)
  const unread = page.locator('.dock-tab.btn-log .dock-tab-count')
  await expect(unread).toBeVisible()

  // Opening the log is reading it.
  await page.locator('.dock-tab.btn-log').click()
  await expect(page.locator('.log-row[data-level="error"]', { hasText: 'MIDI' }).first()).toBeVisible()
  await expect(unread).toHaveCount(0)
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
