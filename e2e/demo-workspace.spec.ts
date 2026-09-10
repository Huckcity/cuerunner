// The demo workspace ships inside the app's resources and copies its audio into the
// user-data folder when it opens. Both halves run in the real app here: the resource is
// resolved from out/main/index.js, and the cue the inspector shows must point at a file
// that exists on disk.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

async function openDemoFromFileMenu(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
}

test('the File menu opens the demo workspace', async () => {
  await openDemoFromFileMenu()

  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
  await expect(page.locator('.cue-row', { hasText: 'Act 1' })).toBeVisible()
  await expect(page.locator('.cue-row', { hasText: 'Count 8' })).toBeVisible()
  await expect(page.locator('.workspace-name-text')).toHaveText('Demo Show')
})

test('the empty cue list offers the demo', async () => {
  await expect(page.locator('.cue-list-empty')).toBeVisible()

  await page.locator('.cue-list-empty-demo').click()

  await expect(page.locator('.cue-list-empty')).toHaveCount(0)
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
})

test('the demo opens clean and does not join the Recent list', async () => {
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  const recentFile = `${userData}/recent.json`
  const readRecents = () => (fs.existsSync(recentFile) ? fs.readFileSync(recentFile, 'utf-8') : '')
  const before = readRecents()

  await openDemoFromFileMenu()
  await expect(page.locator('.cue-row', { hasText: 'Act 1' })).toBeVisible()

  // No path and no edits yet — saving it asks where to put the user's copy.
  await expect(page).toHaveTitle('Demo Show — WinsLab')
  expect(readRecents()).toBe(before)
})

test('demo audio is copied out of the app and played from there', async () => {
  await openDemoFromFileMenu()

  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await page.locator('.inspector-tab', { hasText: 'Audio' }).click()

  const filePath = await page
    .locator('.field-row')
    .filter({ hasText: 'File' })
    .locator('input')
    .first()
    .inputValue()

  expect(filePath).toMatch(/walk-in\.wav$/)
  expect(fs.existsSync(filePath)).toBe(true)

  // Copied into the app's user-data folder rather than played from the bundle.
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  expect(filePath.startsWith(userData)).toBe(true)
})
