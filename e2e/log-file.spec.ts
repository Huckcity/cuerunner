// The session log on disk: what the Log tab says is also written to a file in the app's logs
// folder, which outlives the window — and the folder is one menu item away.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  ;({ app, page, userDataDir } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

function logText(): string {
  // Inside the user-data folder on Windows and Linux; a Mac keeps it in ~/Library/Logs.
  const file = path.join(userDataDir, 'logs', 'cuerunner.log')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
}

test('a cue’s run is written to the log file, stamped, under the cue it is about', async () => {
  test.skip(process.platform === 'darwin', 'the logs folder is ~/Library/Logs on a Mac, outside the run’s own folder')
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-row').first().click()
  await page.getByRole('button', { name: /GO/ }).click()

  await expect.poll(logText).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z INFO \[1 · Wait\] started$/m)
  await expect.poll(logText, { timeout: 8000 }).toMatch(/INFO \[1 · Wait\] completed in \d+ms/)
})

test('the File menu and the Log tab both offer the folder', async () => {
  const items = await app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()?.items.find(item => item.label === 'File')
    return file?.submenu?.items.map(item => item.label) ?? []
  })
  expect(items).toContain('Open Logs Folder')

  await page.locator('.toolbar-brand').click()
  await expect(page.locator('.file-menu [data-action="open-logs"]')).toHaveText(/Open Logs Folder/)
  await page.keyboard.press('Escape')

  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel .log-folder')).toBeVisible()
})
