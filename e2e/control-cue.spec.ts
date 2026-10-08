// The Control cue, from the toolbar to the cues it acts on: a verb, a list of targets, and a
// GO that does that verb to them — start, go to, disarm — and then is over.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { addCueFromMoreMenu, closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  // No key: the Control cue is the free half of the app.
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

function row(number: string) {
  return page.locator('.cue-row').filter({ has: page.locator('.cue-number', { hasText: new RegExp(`^${number}$`) }) })
}

/** Three waits, then a Control cue after them, selected with its tab open. */
async function threeWaitsAndAControl(): Promise<void> {
  for (let i = 0; i < 3; i++) await toolbarCueBtn(page, 'Wait').click()
  await row('3').click()
  await addCueFromMoreMenu(page, 'Control')
  await expect(row('4')).toHaveAttribute('data-type', 'control')
  await row('4').click()
  await page.locator('.inspector-tab', { hasText: 'Control' }).click()
}

async function addTarget(number: string): Promise<void> {
  const picker = page.locator('#control-target-add')
  const option = picker.locator('option', { hasText: new RegExp(`^${number} `) })
  await picker.selectOption({ label: (await option.textContent()) ?? '' })
}

test('a Control cue starts every cue it names, and leaves the rest', async () => {
  await threeWaitsAndAControl()
  await addTarget('1')
  await addTarget('3')
  await expect(page.locator('.target-row')).toHaveCount(2)

  await row('4').click()
  await page.keyboard.press('Space')

  await expect(row('1')).toHaveAttribute('data-running', 'true')
  await expect(row('3')).toHaveAttribute('data-running', 'true')
  await expect(row('2')).toHaveAttribute('data-running', 'false')
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('started by 4 · Control Cue')
})

test('Go to moves the playhead and fires nothing', async () => {
  await threeWaitsAndAControl()
  await page.locator('#control-action').selectOption('goto')
  await expect(page.locator('.control-does')).toContainText('Moves the playhead')
  await addTarget('2')

  await row('4').click()
  await page.keyboard.press('Space')

  await expect(row('2')).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('.cue-row[data-running="true"]')).toHaveCount(0)
})

test('Disarm takes its targets out of the show, as an edit that undo puts back', async () => {
  await threeWaitsAndAControl()
  await page.locator('#control-action').selectOption('disarm')
  await addTarget('2')

  await row('4').click()
  await page.keyboard.press('Space')

  await expect(row('2')).toHaveAttribute('data-armed', 'false')
  await expect(row('1')).toHaveAttribute('data-armed', 'true')

  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()?.getMenuItemById('edit-undo')?.click(undefined, BrowserWindow.getAllWindows()[0])
  })
  await expect(row('2')).toHaveAttribute('data-armed', 'true')
})

test('a Control cue aimed at nothing does nothing, and says so', async () => {
  await threeWaitsAndAControl()
  await expect(page.locator('.target-list-empty')).toContainText('No cue chosen')
  await row('4').click()
  await page.keyboard.press('Space')
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('no cue chosen')
  await expect(page.locator('.cue-row[data-running="true"]')).toHaveCount(0)
})
