// A cue's times edited in the list where they are read: double-click the cell, type, Enter.
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

test('a pre-wait, a post-wait and a wait’s length are typed into the list itself', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  const row = page.locator('.cue-row').first()

  await row.locator('.col-pre').dblclick()
  await row.locator('.col-pre input').fill('2.5')
  await row.locator('.col-pre input').press('Enter')
  await expect(row.locator('.col-pre')).toHaveText('2.5s')

  await row.locator('.col-post').dblclick()
  await row.locator('.col-post input').fill('1:05')
  await row.locator('.col-post input').press('Enter')
  await expect(row.locator('.col-post')).toHaveText('1:05.0')

  await row.locator('.col-dur').dblclick()
  await row.locator('.col-dur input').fill('4')
  await row.locator('.col-dur input').press('Enter')
  await expect(row.locator('.col-dur')).toHaveText('4.0s')

  // The inspector reads the same cue.
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await expect(page.locator('.inspector .field-row', { hasText: 'Pre-wait' }).locator('input')).toHaveValue('2.5')
})

test('Escape puts the time back and stops nothing; the row’s own double-click still renames', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  const row = page.locator('.cue-row').first()
  await row.locator('.col-pre').dblclick()
  await row.locator('.col-pre input').fill('9')
  await row.locator('.col-pre input').press('Escape')
  await expect(row.locator('.col-pre')).toHaveText('–')

  await row.locator('.col-name').dblclick()
  await expect(row.locator('.name-edit')).toBeVisible()
})

test('an audio cue’s length is measured, not typed: its cell does not open', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  const row = page.locator('.cue-row').first()
  await row.locator('.col-dur').dblclick()
  await expect(row.locator('.col-dur input')).toHaveCount(0)
})
