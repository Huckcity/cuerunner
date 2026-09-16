// Batch colour across a multi-selection (ROADMAP R4).
//
// The colour has been in the model since the beginning — a label on the cue, drawn on
// every row — and what was missing was a way to put one on more than one cue at a time.
// So: shift takes the run between two rows, cmd/ctrl takes one row in or out of the set,
// and a swatch writes across the whole set as a single edit that one undo takes back.
//
// The set is a bulk-edit tool, not a second transport: GO still fires the one cue the
// operator's hand is on.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

/** `--cue-color-blue`, as the browser computes it. */
const BLUE = 'rgb(61, 143, 224)'
/** No label at all: a transparent bar. */
const NONE = 'rgba(0, 0, 0, 0)'

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
  for (let cue = 0; cue < 3; cue++) await toolbarCueBtn(page, 'Wait').click()
})

test.afterAll(async () => {
  await closeApp(app)
})

function row(index: number) {
  return page.locator('.cue-row').nth(index)
}

/** Undo through the Edit menu: a programmatic accelerator needs a focused window. */
async function clickEdit(id: 'edit-undo'): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, menuId) => {
    Menu.getApplicationMenu()?.getMenuItemById(menuId)?.click(undefined, BrowserWindow.getAllWindows()[0])
  }, id)
}

test('shift-click takes the run of rows between the two clicks', async () => {
  await row(0).click()
  await row(2).click({ modifiers: ['Shift'] })

  await expect(row(0)).toHaveAttribute('data-selected', 'true')
  await expect(row(1)).toHaveAttribute('data-selected', 'true')
  await expect(row(2)).toHaveAttribute('data-selected', 'true')
})

test('cmd-click takes one row in, and out, of the set', async () => {
  await row(0).click()
  await row(2).click({ modifiers: ['ControlOrMeta'] })

  await expect(row(0)).toHaveAttribute('data-selected', 'true')
  await expect(row(1)).not.toHaveAttribute('data-selected', 'true')
  await expect(row(2)).toHaveAttribute('data-selected', 'true')

  // The same press again takes it back out.
  await row(2).click({ modifiers: ['ControlOrMeta'] })
  await expect(row(0)).toHaveAttribute('data-selected', 'true')
  await expect(row(2)).not.toHaveAttribute('data-selected', 'true')
})

test('one swatch colours the whole selection, and one undo takes it back', async () => {
  await row(0).click()
  await row(2).click({ modifiers: ['Shift'] })
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()

  // The set has no colour in common, so no swatch is marked; the press writes to all three.
  await page.locator('.inspector button[title="blue"]').click()
  for (const index of [0, 1, 2]) {
    await expect(row(index).locator('.col-color')).toHaveCSS('background-color', BLUE)
  }

  // One edit, one undo: the three go back together.
  await clickEdit('edit-undo')
  for (const index of [0, 1, 2]) {
    await expect(row(index).locator('.col-color')).toHaveCSS('background-color', NONE)
  }
})

test('GO fires the cue the hand is on, and the set is not a second transport', async () => {
  await row(0).click()
  await row(2).click({ modifiers: ['Shift'] })
  await page.keyboard.press('Space')

  // The cue that was clicked last fires; the two behind it do not.
  await expect(row(2)).toHaveAttribute('data-running', 'true')
  await expect(row(0)).not.toHaveAttribute('data-running', 'true')
  await expect(row(1)).not.toHaveAttribute('data-running', 'true')

  // And the advance is a selection of its own: the set is gone.
  await expect(row(0)).not.toHaveAttribute('data-selected', 'true')
  await expect(row(1)).not.toHaveAttribute('data-selected', 'true')
  await expect(row(2)).not.toHaveAttribute('data-selected', 'true')
})

test('Delete takes the whole set, and one undo puts it back', async () => {
  await row(0).click()
  await row(2).click({ modifiers: ['Shift'] })

  await page.locator('.cue-list-container').press('Delete')
  await expect(page.locator('.cue-row')).toHaveCount(0)

  await clickEdit('edit-undo')
  await expect(page.locator('.cue-row')).toHaveCount(3)
})