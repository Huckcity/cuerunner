// The log panel: cue lifecycle lines, script console output, and shell output, all
// readable in the app rather than only in DevTools.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { addCueFromMoreMenu, closeApp, launchApp, startServer, type TestServer } from './helpers'

let app: ElectronApplication
let page: Page
let server: TestServer | undefined

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
  await server?.close()
  server = undefined
})

function logPanel(page: Page) {
  return page.locator('.log-panel')
}

test('log panel is hidden until toggled, and closes again', async () => {
  await expect(logPanel(page)).toHaveCount(0)

  await page.locator('.btn-log').click()
  await expect(logPanel(page)).toBeVisible()

  // The toggle stays selected while the panel is open
  await expect(page.locator('.btn-log')).toHaveAttribute('data-active', 'true')

  await page.locator('.btn-log').click()
  await expect(logPanel(page)).toHaveCount(0)
})

test('a fired cue is logged with its request and response', async () => {
  server = await startServer()

  await addCueFromMoreMenu(page, 'Network')
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()
  await page.locator('.field-row').filter({ hasText: 'URL' }).locator('input').fill(`${server.baseUrl}/hit`)
  await page.locator('.btn-log').click()

  await page.getByRole('button', { name: /GO/ }).click()

  await expect(logPanel(page)).toContainText('started')
  await expect(logPanel(page)).toContainText(`GET ${server.baseUrl}/hit → 200 OK`)
  // This cue's two lines, wherever they sit among anything else the session has logged:
  // a total row count would be a count of the whole log, not of this run.
  const rows = logPanel(page).locator('.log-row')
  await expect(rows.filter({ hasText: `GET ${server.baseUrl}/hit → 200 OK` })).toHaveCount(1)
  // Cue identity is captured with the entry
  await expect(rows.filter({ hasText: 'Network Cue' }).first()).toBeVisible()
})

test('a failing request is logged as an error', async () => {
  server = await startServer()

  await addCueFromMoreMenu(page, 'Network')
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()
  await page.locator('.field-row').filter({ hasText: 'URL' }).locator('input').fill(`${server.baseUrl}/fail`)
  await page.locator('.btn-log').click()

  await page.getByRole('button', { name: /GO/ }).click()

  // The failing request's own row: an unrelated error elsewhere in the session — the
  // engine saying something, say — must not make this assertion ambiguous.
  const errorRow = logPanel(page)
    .locator('.log-row[data-level="error"]', { hasText: 'HTTP 500 Internal Server Error' })
  await expect(errorRow).toHaveCount(1)
  await expect(errorRow).toContainText('Network Cue')
})

test('script console output reaches the log panel', async () => {
  await addCueFromMoreMenu(page, 'Script')
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await page.locator('.inspector-code').fill("console.log('show is running', 3)")
  await page.locator('.btn-log').click()

  await page.getByRole('button', { name: /GO/ }).click()

  const outputRow = logPanel(page).locator('.log-row[data-level="output"]')
  await expect(outputRow).toContainText('show is running 3')
})

test('shell output reaches the log panel without the script logging it', async () => {
  test.skip(process.platform === 'win32', 'uses a POSIX shell command')

  await addCueFromMoreMenu(page, 'Script')
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await page.locator('.inspector-code').fill("await shell('echo from-the-shell')")
  await page.locator('.btn-log').click()

  await page.getByRole('button', { name: /GO/ }).click()

  await expect(logPanel(page)).toContainText('$ echo from-the-shell')
  await expect(logPanel(page)).toContainText('from-the-shell')
})

test('Clear empties the log', async () => {
  await addCueFromMoreMenu(page, 'Script')
  await page.locator('.btn-log').click()
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(logPanel(page).locator('.log-row').first()).toBeVisible()

  await page.locator('.log-btn', { hasText: 'Clear' }).click()

  await expect(logPanel(page).locator('.log-row')).toHaveCount(0)
})
