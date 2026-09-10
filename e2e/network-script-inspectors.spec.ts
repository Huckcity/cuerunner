// Network and Script cue inspectors: the fields they expose, and proof that the
// values they store actually reach the engine when the cue is fired.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { addCueFromMoreMenu, closeApp, launchApp, startServer, type TestServer } from './helpers'

let app: ElectronApplication
let page: Page
let server: TestServer | undefined
const tempFiles: string[] = []

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
  await server?.close()
  server = undefined
})

test.afterAll(() => {
  for (const f of tempFiles) fs.rmSync(f, { force: true })
})

function tempPath(name: string): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-e2e-')), name)
  tempFiles.push(p)
  return p
}

test('Network tab stores the request configuration', async () => {
  await addCueFromMoreMenu(page, 'Network')
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()

  const method = page.locator('.field-row').filter({ hasText: 'Method' }).locator('select')
  const url = page.locator('.field-row').filter({ hasText: 'URL' }).locator('input')
  const timeout = page.locator('.field-row').filter({ hasText: 'Timeout' }).locator('input')
  const body = page.locator('.inspector textarea')

  await expect(method).toHaveValue('GET')
  // GET carries no body, so the field is inert until the method allows one
  await expect(body).toBeDisabled()
  await expect(timeout).toHaveValue('5000')

  await method.selectOption('POST')
  await expect(body).toBeEnabled()
  await url.fill('https://example.com/hook')
  await timeout.fill('2500')
  await body.fill('{"scene":3}')

  await page.locator('.inspector-add-btn').click()
  const header = page.locator('.field-row').filter({ hasText: 'Header 1' })
  await header.locator('input').nth(0).fill('X-Show')
  await header.locator('input').nth(1).fill('demo')

  // Switch away and back — the values must survive a remount of the tab
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()

  await expect(page.locator('.field-row').filter({ hasText: 'Method' }).locator('select')).toHaveValue('POST')
  await expect(page.locator('.field-row').filter({ hasText: 'URL' }).locator('input')).toHaveValue('https://example.com/hook')
  await expect(page.locator('.field-row').filter({ hasText: 'Timeout' }).locator('input')).toHaveValue('2500')
  await expect(page.locator('.inspector textarea')).toHaveValue('{"scene":3}')
  await expect(page.locator('.field-row').filter({ hasText: 'Header 1' }).locator('input').nth(0)).toHaveValue('X-Show')
  await expect(page.locator('.field-row').filter({ hasText: 'Header 1' }).locator('input').nth(1)).toHaveValue('demo')

  // Not fired yet, so there is no run result to show
  await expect(page.locator('.last-run')).toHaveCount(0)
  await expect(page.locator('.inspector')).toContainText('Not run yet.')
})

test('network cue sends the configured method, headers, and body', async () => {
  server = await startServer()

  await addCueFromMoreMenu(page, 'Network')
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()

  await page.locator('.field-row').filter({ hasText: 'Method' }).locator('select').selectOption('POST')
  await page.locator('.field-row').filter({ hasText: 'URL' }).locator('input').fill(`${server.baseUrl}/hit`)
  await page.locator('.inspector-add-btn').click()
  const header = page.locator('.field-row').filter({ hasText: 'Header 1' })
  await header.locator('input').nth(0).fill('X-Show')
  await header.locator('input').nth(1).fill('demo')
  await page.locator('.inspector textarea').fill('{"scene":3}')

  await page.getByRole('button', { name: /GO/ }).click()

  await expect.poll(() => server!.hits.length, { timeout: 10_000 }).toBe(1)
  const hit = server.hits[0]
  expect(hit.method).toBe('POST')
  expect(hit.url).toBe('/hit')
  expect(hit.headers['x-show']).toBe('demo')
  expect(hit.body).toBe('{"scene":3}')

  // GO advances the selection past the cue (null — it was the only one), so the
  // inspector is empty afterwards. Re-select it: the result must have been kept
  // outside the cue's config and survive that.
  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()
  await expect(page.locator('.last-run-badge')).toHaveText('ok')
  await expect(page.locator('.last-run')).toContainText('200 OK')
})

test('network cue reports a failing response in the inspector', async () => {
  server = await startServer()

  await addCueFromMoreMenu(page, 'Network')
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()
  await page.locator('.field-row').filter({ hasText: 'URL' }).locator('input').fill(`${server.baseUrl}/fail`)

  await page.getByRole('button', { name: /GO/ }).click()

  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()
  await expect(page.locator('.last-run-badge')).toHaveText('failed')
  await expect(page.locator('.last-run-error')).toHaveText('HTTP 500 Internal Server Error')
})

test('Script tab stores the script and shell() runs it on GO', async () => {
  test.skip(process.platform === 'win32', 'uses a POSIX shell command')

  const marker = tempPath('shell.txt')
  await addCueFromMoreMenu(page, 'Script')
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()

  const script = `await shell('printf fired > "${marker}"')`
  await page.locator('.inspector-code').fill(script)

  // Survives a tab switch
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await expect(page.locator('.inspector-code')).toHaveValue(script)

  await page.getByRole('button', { name: /GO/ }).click()

  await expect.poll(() => fs.existsSync(marker), { timeout: 10_000 }).toBe(true)
  expect(fs.readFileSync(marker, 'utf-8')).toBe('fired')

  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await expect(page.locator('.last-run-badge')).toHaveText('ok')
})

test('script cue runs another file through include()', async () => {
  test.skip(process.platform === 'win32', 'uses a POSIX shell command')

  const marker = tempPath('include.txt')
  const included = tempPath('included.js')
  fs.writeFileSync(included, `await shell('printf included > "${marker}"')`)

  await addCueFromMoreMenu(page, 'Script')
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await page.locator('.inspector-code').fill(`await include(${JSON.stringify(included)})`)

  await page.getByRole('button', { name: /GO/ }).click()

  await expect.poll(() => fs.existsSync(marker), { timeout: 10_000 }).toBe(true)
  expect(fs.readFileSync(marker, 'utf-8')).toBe('included')
})
