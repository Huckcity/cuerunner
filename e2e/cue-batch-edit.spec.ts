// Editing several cues at once from the list's right-click menu, and making a fade or a stop
// for what is selected: the operator's hand stays on the list, and each is one undo.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

function row(number: string) {
  return page.locator('.cue-row').filter({ has: page.locator('.cue-number', { hasText: new RegExp(`^${number.replace('.', '\\.')}$`) }) })
}

/** Undo, the way the Edit menu does it: the accelerator lives in the application menu. */
async function undo(): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()
      ?.getMenuItemById('edit-undo')
      ?.click(undefined, BrowserWindow.getAllWindows()[0])
  })
}

async function selectRange(from: string, to: string): Promise<void> {
  await row(from).click()
  await row(to).click({ modifiers: ['Shift'] })
}

test('Edit (n)… writes a pre-wait and an advance to every selected cue, as one undo', async () => {
  for (let i = 0; i < 3; i++) await toolbarCueBtn(page, 'Wait').click()
  await selectRange('1', '3')

  await row('2').click({ button: 'right' })
  await page.locator('.cue-context-menu-item[data-action="batch-edit"]').click()
  const dialog = page.getByRole('dialog', { name: 'Edit 3 cues' })
  await expect(dialog).toBeVisible()
  // A set with no audio in it is not offered an audio cue's fields.
  await expect(dialog.locator('#batch-volume')).toHaveCount(0)

  await dialog.locator('#batch-pre-wait').fill('1.5')
  await dialog.locator('#batch-advance').selectOption('on-end')
  await dialog.getByRole('button', { name: 'Apply to 3' }).click()
  await expect(dialog).toHaveCount(0)

  for (const number of ['1', '2', '3']) {
    await expect(row(number).locator('.col-pre')).toHaveText('1.5s')
    await expect(row(number).locator('.col-adv')).toHaveText('on-end')
  }

  // One edit, one undo: every row goes back together.
  await undo()
  for (const number of ['1', '2', '3']) {
    await expect(row(number).locator('.col-pre')).toHaveText('–')
  }
})

test('an audio cue’s own fields go to the audio cues in a mixed set and to nothing else', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await toolbarCueBtn(page, 'Wait').click()
  await selectRange('1', '2')

  await row('1').click({ button: 'right' })
  await page.locator('.cue-context-menu-item[data-action="batch-edit"]').click()
  const dialog = page.getByRole('dialog', { name: 'Edit 2 cues' })
  await expect(dialog).toContainText('The 1 audio cues')
  await dialog.locator('#batch-fade-out').fill('2')
  await dialog.getByRole('button', { name: 'Apply to 1' }).click()

  await row('1').click()
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  await expect(page.locator('.field-row', { hasText: 'Fade out' }).locator('input')).toHaveValue('2')
})

test('Fade out (n) makes one GO of fades aimed at each selected sound', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await toolbarCueBtn(page, 'Audio').click()
  await toolbarCueBtn(page, 'Wait').click()
  await selectRange('1', '2')

  await row('1').click({ button: 'right' })
  await page.locator('.cue-context-menu-item[data-action="fade-out"]').click()

  // A group after the last of them, with a fade at each, all at once.
  await expect(row('4')).toHaveAttribute('data-type', 'group')
  await expect(row('4')).toContainText('Fade out 2 cues')
  await expect(row('4.1')).toHaveAttribute('data-type', 'fade')
  await expect(row('4.2')).toHaveAttribute('data-type', 'fade')
  await expect(page.locator('.cue-row').nth(2)).toContainText('Fade out 2 cues')

  await undo()
  await expect(page.locator('.cue-row[data-type="fade"]')).toHaveCount(0)
})

test('Add stop on one cue makes one stop cue aimed at it', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await row('1').click({ button: 'right' })
  // One wait cannot be faded, so the menu does not offer it.
  await expect(page.locator('.cue-context-menu-item[data-action="fade-out"]')).toHaveCount(0)
  await page.locator('.cue-context-menu-item[data-action="stop-cue"]').click()

  await expect(row('2')).toHaveAttribute('data-type', 'stop')
  await expect(row('2')).toContainText('Stop Wait')
})
