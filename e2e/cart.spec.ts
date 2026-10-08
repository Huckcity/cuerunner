// The cart (F6): the list as a wall of buttons — a press or a number key plays a tile's cue
// wherever the show is standing — remembered on this machine across a reload.
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

const tile = (index: number) => page.locator('.cart-tile').nth(index)

test('F6 turns the list into tiles; a press and a number key each play their own cue', async () => {
  for (let i = 0; i < 3; i++) await toolbarCueBtn(page, 'Wait').click()
  await page.keyboard.press('F6')
  await expect(page.locator('.cart')).toBeVisible()
  await expect(page.locator('.cart-tile')).toHaveCount(3)
  await expect(page.locator('.toolbar-actions')).toBeHidden()

  await tile(2).locator('.cart-tile-fire').click()
  await expect(tile(2)).toHaveAttribute('data-state', 'playing')
  await expect(tile(0)).toHaveAttribute('data-state', 'idle')

  // Past the repeat guard, so the key is a press of its own.
  await page.waitForTimeout(400)
  await page.keyboard.press('1')
  await expect(tile(0)).toHaveAttribute('data-state', 'playing')

  await tile(2).locator('.cart-tile-stop').click()
  await expect(tile(2)).toHaveAttribute('data-state', 'idle')

  // The machine remembers the cart: a reload opens on it.
  await page.reload()
  await expect(page.locator('.cart')).toBeVisible()

  await page.locator('.cart-exit').click()
  await expect(page.locator('.cue-list-container')).toBeVisible()
})

test('View → Cart in the application menu does the same', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()
      ?.getMenuItemById('view-cart')
      ?.click(undefined, BrowserWindow.getAllWindows()[0])
  })
  await expect(page.locator('.cart')).toBeVisible()
  await page.keyboard.press('F6')
  await expect(page.locator('.cart')).toHaveCount(0)
})
