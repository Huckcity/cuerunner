/**
 * A Pro lock leads somewhere for a person with no key.
 *
 * The lock offered one thing: a field to enter a key in. For somebody trying the free app
 * who has just met a locked view, that is a dead end — nothing in the window said where a
 * key comes from or what one costs. The lock now also points at the pricing page, which
 * opens in the browser: the link is a new-window request, which the main process hands to
 * the operating system, and the window itself stays on the app.
 *
 * `shell.openExternal` is stood in for, so the suite records the address rather than
 * starting a browser on the machine it runs on.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
  await app.evaluate(({ shell }) => {
    const seen = globalThis as unknown as { __openedExternally: string[] }
    seen.__openedExternally = []
    shell.openExternal = (async (url: string) => { seen.__openedExternally.push(url) }) as typeof shell.openExternal
  })
})

test.afterAll(async () => {
  await closeApp(app)
})

test('the locked Scenes view points at the pricing page, and opens it outside the window', async () => {
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  const lock = page.locator('.pro-lock[data-feature="Scenes"]')
  await expect(lock).toBeVisible()
  // Both ways on are there: a key to enter, and what one costs.
  await expect(lock.locator('.pro-lock-unlock')).toHaveText('Enter license key')
  const pricing = lock.locator('.pro-lock-pricing')
  await expect(pricing).toHaveText('See what Pro costs')

  await pricing.click()

  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { __openedExternally: string[] }).__openedExternally))
    .toEqual(['https://cuerunner.app/pricing.html'])
  // The app is still the app: the page opened elsewhere, not in place of the show.
  await expect(page.locator('.toolbar-brand')).toBeVisible()
  await expect(lock).toBeVisible()
})
