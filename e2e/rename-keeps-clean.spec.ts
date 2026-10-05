/**
 * Opening a name field and leaving it as it was is not an edit.
 *
 * A double-click on a row opens its name for editing, and so does one on the show's name
 * in the toolbar. Leaving either without typing used to write the same name back: the
 * unsaved dot appeared on a show nobody had changed, and closing it asked to save nothing.
 * The demo is the show on trial because it opens clean.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
  await expect(page.locator('.workspace-name')).not.toContainText('●')
})

test.afterAll(async () => {
  await closeApp(app)
})

test('a cue name opened and left alone leaves the show clean', async () => {
  const row = page.locator('.cue-row', { hasText: 'Walk-in Music' })
  await row.dblclick()
  await expect(page.locator('.name-edit')).toBeVisible()
  await page.locator('.name-edit').press('Enter')

  await expect(page.locator('.name-edit')).toHaveCount(0)
  await expect(row).toBeVisible()
  await expect(page.locator('.workspace-name')).not.toContainText('●')
})

test('the show name opened and left alone leaves the show clean', async () => {
  await page.locator('.workspace-name-text').dblclick()
  await expect(page.locator('.workspace-name-input')).toBeVisible()
  await page.locator('.workspace-name-input').press('Enter')

  await expect(page.locator('.workspace-name-text')).toHaveText('Demo Show')
})

test('a name that is changed is still an edit', async () => {
  const row = page.locator('.cue-row', { hasText: 'Walk-in Music' })
  await row.dblclick()
  await page.locator('.name-edit').fill('House Music')
  await page.locator('.name-edit').press('Enter')

  await expect(page.locator('.cue-row', { hasText: 'House Music' })).toBeVisible()
  await expect(page.locator('.workspace-name')).toContainText('●')
})
