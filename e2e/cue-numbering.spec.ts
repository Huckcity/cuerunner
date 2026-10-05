/**
 * A new cue's number follows the show it is added to.
 *
 * The number used to come from a counter the window kept, started at 1 with the app and
 * never told about a show that was opened: the first cue added to the demo was a second
 * cue 1, and a show made after it began wherever the last one's count had got to. The
 * reference page promises "next free", so that is what is on trial — against an opened
 * show, and against a new one made after it.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

/** The number on the row the last press left selected: the cue that was just added. */
function selectedNumber() {
  return page.locator('.cue-row[data-selected="true"] .cue-number')
}

test('a cue added to an opened show takes the number after its highest', async () => {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  // The demo is numbered 1 to 15, and opens standing on its first cue.
  await expect(page.locator('.cue-row')).toHaveCount(15)
  await expect(page.locator('.cue-row').last().locator('.cue-number')).toHaveText('15')

  await toolbarCueBtn(page, 'Wait').click()

  await expect(page.locator('.cue-row')).toHaveCount(16)
  await expect(selectedNumber()).toHaveText('16')
})

test('a new show starts at cue 1, whatever the last one reached', async () => {
  // The demo has an edit in it now, so New asks; the answer is Don't Save.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="new"]').click()
  await expect(page.locator('.cue-list-empty')).toBeVisible()

  await toolbarCueBtn(page, 'Wait').click()
  await expect(selectedNumber()).toHaveText('1')
  await toolbarCueBtn(page, 'Wait').click()
  await expect(selectedNumber()).toHaveText('2')
})
