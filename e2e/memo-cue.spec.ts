// The memo cue: a note written into the stack, read on its row, that the show runs through.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { addCueFromMoreMenu, closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

function row(number: string) {
  return page.locator('.cue-row').filter({ has: page.locator('.cue-number', { hasText: new RegExp(`^${number}$`) }) })
}

test('a memo is added from More, written on Basics, and read on its row', async () => {
  await addCueFromMoreMenu(page, 'Memo')
  await expect(row('1')).toHaveAttribute('data-type', 'memo')
  await expect(row('1').locator('.cue-icon[data-type="memo"]')).toBeVisible()

  // Basics is all a memo has: its name and its note.
  await expect(page.locator('.inspector-tab')).toHaveText(['Basics', 'Triggers'])
  await page.locator('.inspector textarea').fill('Hold for the bow\nHouse lights are the SM’s')
  await expect(row('1').locator('.memo-text')).toHaveText('Hold for the bow')
})

test('GO on a memo completes it at once and its advance runs on into the next cue', async () => {
  await addCueFromMoreMenu(page, 'Memo')
  await page.locator('.inspector .field-row', { hasText: 'Advance' }).locator('select').selectOption('on-end')
  await toolbarCueBtn(page, 'Wait').click()
  await row('1').click()

  await page.keyboard.press('Space')

  // The wait is running: the memo held nothing up, and is not itself still lit.
  await expect(row('2')).toHaveAttribute('data-running', 'true')
  await expect(row('1')).toHaveAttribute('data-running', 'false')
})
