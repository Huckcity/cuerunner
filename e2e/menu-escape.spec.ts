/**
 * Escape closes an open menu, and nothing else.
 *
 * Escape is STOP, anywhere but a text field — and the toolbar's two menus are not text
 * fields. An operator backing out of Cuerunner ▾ or More ▾ with the key every menu closes
 * on stopped the show behind it, and the menu stayed open. The row menu already took the
 * press for itself; these two now do the same. GO is deliberately not taken: it is pressed
 * without looking, and a menu passes it through (`go-press.spec.ts`).
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
  // A cue that is still running whenever a menu is closed: a post-wait far longer than
  // this file takes.
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.field-row').filter({ hasText: 'Post-wait' }).locator('input').fill('60')
  await page.locator('.cue-row').first().click()
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-running', 'true')
})

test.afterAll(async () => {
  await closeApp(app)
})

for (const [name, button, menu] of [
  ['Cuerunner ▾', '.toolbar-brand', '.file-menu'],
  ['More ▾', '.toolbar-more-btn', '.toolbar-more-menu']
] as const) {
  test(`Escape closes ${name} and leaves the show running`, async () => {
    await page.locator(button).click()
    await expect(page.locator(menu)).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(page.locator(menu)).toHaveCount(0)
    await expect(page.locator('.cue-row').first()).toHaveAttribute('data-running', 'true')
  })
}

test('with no menu open, Escape is STOP again', async () => {
  await page.locator('.cue-row').first().click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-running', 'false')
})
