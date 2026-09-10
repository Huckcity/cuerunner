// Failure surfaces: a crashed renderer comes back with an explanation, and errors the
// operator cannot see in a packaged build reach the session log.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

test('recovers from a renderer crash with an explanation', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()
  })

  // Playwright's page handle stays marked as crashed after the renderer is replaced,
  // so the recovered window is inspected through its own webContents instead. The poll
  // reads the crash flag only: executeJavaScript issued while the renderer is down
  // never settles.
  await expect.poll(
    async () => app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.isCrashed()),
    { timeout: 15_000 }
  ).toBe(false)

  const recovered = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents
    return {
      banner: await wc.executeJavaScript("document.querySelector('.crash-notice')?.textContent ?? null"),
      toolbar: await wc.executeJavaScript("!!document.querySelector('.toolbar')")
    }
  })

  expect(recovered.toolbar).toBe(true)
  expect(recovered.banner).toContain('The interface stopped unexpectedly')
  expect(recovered.banner).toContain('Anything unsaved is gone')
  expect(recovered.banner).toContain('killed')

  // The interface answers input again, not just renders: the LOG toggle works.
  const logOpened = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents
    await wc.executeJavaScript("document.querySelector('.btn-log').click()")
    return wc.executeJavaScript("!!document.querySelector('.log-panel')")
  })
  expect(logOpened).toBe(true)
})

test('an unhandled rejection in the renderer reaches the session log', async () => {
  await page.evaluate(() => { void Promise.reject(new Error('e2e unhandled rejection')) })

  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('Unhandled rejection: e2e unhandled rejection')
})

test('a main-process exception reaches the session log and leaves the app running', async () => {
  await app.evaluate(() => {
    setTimeout(() => { throw new Error('e2e main boom') }, 0)
  })

  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('e2e main boom')

  // Still usable: the log toggles and the transport bar answers a GO.
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toHaveCount(0)
  await expect(page.locator('.btn-go')).toBeEnabled()
})
