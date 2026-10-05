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
import fs from 'node:fs'
import path from 'node:path'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

/** The numbers the shipped demo's cues carry, read from the file the app opens. */
function demoCueNumbers(): number[] {
  const demo = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'resources/demo/Demo Show.cuerunner'), 'utf-8')
  ) as { cues: Array<{ number: string }> }
  return demo.cues.map(cue => Number(cue.number))
}

/** The number on the row the last press left selected: the cue that was just added. */
function selectedNumber() {
  return page.locator('.cue-row[data-selected="true"] .cue-number')
}

test('a cue added to an opened show takes the number after its highest', async () => {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  // The demo opens standing on its first cue. What its highest number is comes from the
  // shipped file rather than from the rows on screen: the list is virtualized, so the rows
  // in the DOM are the ones a window of this height has room for, not the show.
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
  const highest = Math.max(...demoCueNumbers())
  expect(highest).toBeGreaterThan(1)

  await toolbarCueBtn(page, 'Wait').click()

  // The new cue lands after the selected one — the top of the list — and is selected.
  await expect(selectedNumber()).toHaveText(String(highest + 1))
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
