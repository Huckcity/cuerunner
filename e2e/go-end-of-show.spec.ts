// GO fires nothing when nothing is selected.
//
// The selection is empty exactly once in every performance: after the last cue. GO used to
// fire the first cue of the show from there, and the bar under the toolbar said so —
// "NEXT 1" — so one more press at the end, a hand resting on Space as the house lights
// came up, started the walk-in again over the bows. The show's own state is what is read
// here: what is running, what the bar says GO will do, and what the log saw.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, openLogPanel, setGuardWindow, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

test('after the last cue GO fires nothing, and the bar says so until a cue is selected', async () => {
  // Presses in this test are deliberate and close together: the repeat guard is for a
  // hand that shook, and is not what is on trial.
  await setGuardWindow(page, 0)
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  const next = page.locator('.ctx-next')
  const rows = page.locator('.cue-row')

  // Standing on the first cue: two presses run the show to its end.
  await rows.nth(0).click()
  await expect(next.locator('.ctx-number')).toHaveText('1')
  await page.locator('.btn-go').click()
  await expect(next.locator('.ctx-number')).toHaveText('2')
  await page.locator('.btn-go').click()

  // The end of the show: nothing is selected, and the bar no longer names cue 1.
  await expect(page.locator('.cue-row[data-selected="true"]')).toHaveCount(0)
  await expect(next.locator('.ctx-none')).toHaveText('Nothing selected — GO fires nothing')
  await expect(next.locator('.ctx-number')).toHaveCount(0)

  await openLogPanel(page)
  const started = page.locator('.log-row', { hasText: 'started' })
  await expect(started).toHaveCount(2)

  // The press that used to restart the show.
  await page.locator('.btn-go').click()
  await page.keyboard.press('Space')
  await expect(next.locator('.ctx-none')).toBeVisible()
  await expect(rows.nth(0)).toHaveAttribute('data-running', 'false')
  await expect(started).toHaveCount(2)

  // The top of the show is one deliberate click away.
  await rows.nth(0).click()
  await expect(next.locator('.ctx-number')).toHaveText('1')
  await page.locator('.btn-go').click()
  await expect(started).toHaveCount(3)
})
