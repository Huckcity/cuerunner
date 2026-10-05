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

/** A new, empty show: the one before it has edits, and New's prompt is answered Don't Save. */
async function newShow(): Promise<void> {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="new"]').click()
  await expect(page.locator('.cue-list-empty')).toBeVisible()
}

const rowNumbers = (): Promise<string[]> => page.locator('.cue-number').allTextContents()

// A copy is a new cue. It used to be numbered after its original — "4 copy", then
// "4 copy copy" — in a column with no room for the word, and a duplicated group's children
// kept their originals' numbers, so the show had two of each.
test('a duplicate takes the next free number, and so does every cue in a duplicated group', async () => {
  await newShow()
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Group').click()
  // Added with the group selected, so it lands inside it.
  await toolbarCueBtn(page, 'Stop').click()
  expect(await rowNumbers()).toEqual(['1', '2', '3'])

  await page.locator('.cue-row[data-type="group"]').click()
  await page.keyboard.press('ControlOrMeta+d')
  await expect(page.locator('.cue-row')).toHaveCount(5)
  expect(await rowNumbers()).toEqual(['1', '2', '3', '4', '5'])
  // One row was selected and one row is: the copy's header, with its child under it.
  await expect(page.locator('.cue-row[data-selected="true"]')).toHaveCount(1)
  await expect(page.locator('.cue-row[data-selected="true"] .cue-number')).toHaveText('4')

  // The copy is what is selected, so the same press again duplicates the copy — and only
  // the copy: its child is not duplicated a second time inside it.
  await page.keyboard.press('ControlOrMeta+d')
  await expect(page.locator('.cue-row')).toHaveCount(7)
  expect(await rowNumbers()).toEqual(['1', '2', '3', '4', '5', '6', '7'])
})

// A number is text — the reference gives `12.5` and `LX 12` — and the column drew it in
// 28px with wrapping left on: `LX 12` broke onto two lines, and anything longer ran out
// over the row's borders, its icon and its name.
test('a number is drawn on one line, whole when it fits and cut short clear of the icon when it does not', async () => {
  await newShow()
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  const row = page.locator('.cue-row[data-selected="true"]')
  const number = row.locator('.cue-number')
  const field = page.locator('.inspector .field-row', { hasText: 'Number' }).locator('input')

  /** How the number is drawn: its lines, whether it is cut, and where it ends against the icon. */
  const drawn = (): Promise<{ lines: number; cut: boolean; clearOfIcon: boolean; insideRow: boolean }> =>
    number.evaluate(element => {
      const box = element.getBoundingClientRect()
      const rowBox = element.closest('.cue-row')!.getBoundingClientRect()
      const icon = element.parentElement!.querySelector('.cue-icon-slot')!.getBoundingClientRect()
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || box.height
      return {
        lines: Math.round(element.scrollHeight / lineHeight),
        cut: element.scrollWidth > element.clientWidth,
        clearOfIcon: box.right <= icon.left,
        insideRow: box.left >= rowBox.left && box.top >= rowBox.top && box.bottom <= rowBox.bottom
      }
    })

  for (const fits of ['12.5', '100.5', 'LX 12']) {
    await field.fill(fits)
    await field.press('Enter')
    await expect(number).toHaveText(fits)
    expect(await drawn(), `"${fits}" is whole, on one line`).toEqual({
      lines: 1, cut: false, clearOfIcon: true, insideRow: true
    })
  }

  const long = 'Preshow-A.15 (alt)'
  await field.fill(long)
  await field.press('Enter')
  await expect(number).toHaveText(long)
  expect(await drawn(), 'a long number is cut, on one line').toEqual({
    lines: 1, cut: true, clearOfIcon: true, insideRow: true
  })
  // What the ellipsis took is a hover away.
  await expect(number).toHaveAttribute('title', long)
})
