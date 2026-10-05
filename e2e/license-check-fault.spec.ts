/**
 * A licence check that faults says so, and can be tried again.
 *
 * A refused key is an answer and the field has always shown it. A check that *fails* — the
 * key file cannot be written, the main process throws — was nothing at all: the window
 * awaited a call that rejected, the Activate button stayed disabled for good, and no
 * sentence appeared. The channel is made to fault here by standing a throwing handler in
 * for main's own, which is the only way to reach that state without breaking the disk.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

test('a check that throws is reported under the field, and the button comes back', async () => {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('license:activate')
    ipcMain.handle('license:activate', () => {
      throw new Error('EACCES: the key file could not be written')
    })
  })

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'License', exact: true }).click()
  await page.locator('#license-key').fill('CRN1-ABCDEFGH-ABCDEFGH')
  const activate = dialog.getByRole('button', { name: 'Activate' })
  await activate.click()

  const error = page.locator('.license-error')
  await expect(error).toContainText('The key could not be checked')
  await expect(error).toContainText('the key file could not be written')
  // Electron's own wrapper around a rejected call is plumbing, not a reason.
  await expect(error).not.toContainText('Error invoking remote method')
  // Not stuck: the key is still in the field and the press can be made again.
  await expect(activate).toBeEnabled()
  await expect(page.locator('#license-key')).toHaveValue('CRN1-ABCDEFGH-ABCDEFGH')
})
