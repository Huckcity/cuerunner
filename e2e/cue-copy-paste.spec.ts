// Copy and paste of cues: Edit → Copy and Paste reach the cue list as they reach a text field,
// and the right-click menu offers the same. A paste lands after the cue the operator stands on.
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

/** What Edit → Copy / Cut / Paste do: the window's own editing command, sent to what has focus. */
async function edit(command: 'copy' | 'cut' | 'paste'): Promise<void> {
  await app.evaluate(({ BrowserWindow }, verb) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    if (verb === 'copy') contents.copy()
    else if (verb === 'cut') contents.cut()
    else contents.paste()
  }, command)
}

async function shape(): Promise<string[]> {
  return page.$$eval('.cue-row', rows => rows.map(row =>
    `${row.querySelector('.cue-number')?.textContent} ${row.getAttribute('data-type')}`))
}

test('Edit → Copy and Paste duplicate the selection after the cue the operator stands on', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Fade').click()
  await toolbarCueBtn(page, 'Stop').click()
  await page.locator('.cue-row').nth(0).click()
  await page.locator('.cue-row').nth(1).click({ modifiers: ['Shift'] })

  await edit('copy')
  await page.locator('.cue-row').nth(2).click()
  await edit('paste')

  await expect(page.locator('.cue-row')).toHaveCount(5)
  expect(await shape()).toEqual(['1 wait', '2 fade', '3 stop', '4 wait', '5 fade'])
  // The first copy is what the operator holds now.
  await expect(page.locator('.cue-row').nth(3)).toHaveAttribute('data-selected', 'true')
})

test('Cut takes the cues out, and they paste back in somewhere else', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Stop').click()
  await page.locator('.cue-row').nth(0).click()
  await edit('cut')
  await expect(page.locator('.cue-row')).toHaveCount(1)

  await page.locator('.cue-row').nth(0).click()
  await edit('paste')
  expect(await shape()).toEqual(['2 stop', '3 wait'])
})

test('the right-click menu copies and pastes as well', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-row').first().click({ button: 'right' })
  // Nothing has been copied yet, so there is nothing to offer to paste.
  await expect(page.locator('.cue-context-menu-item[data-action="paste"]')).toHaveCount(0)
  await page.locator('.cue-context-menu-item[data-action="copy"]').click()

  await page.locator('.cue-row').first().click({ button: 'right' })
  await page.locator('.cue-context-menu-item[data-action="paste"]').click()
  expect(await shape()).toEqual(['1 wait', '2 wait'])
})

test('a copy made in a text field is the field’s, not the cues', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-row').first().click()
  const name = page.locator('.inspector .field-row', { hasText: 'Name' }).locator('input')
  await name.click()
  await name.selectText()
  await edit('copy')
  await page.locator('.cue-row').first().click()
  await edit('paste')
  // Nothing pasted into the list: the field's text was what was copied.
  await expect(page.locator('.cue-row')).toHaveCount(1)
})
