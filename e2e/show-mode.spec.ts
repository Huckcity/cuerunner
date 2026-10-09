// Show mode (F5): the show in large type for running it — the list and inspector give way to a
// card per cue, the transport keeps working, and F5 or View → Show Mode brings the editor back.
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

function card(index: number) {
  return page.locator('.show-card').nth(index)
}

test('F5 swaps the editor for the cards, GO runs the show from them, and F5 swaps back', async () => {
  for (let i = 0; i < 3; i++) await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-row').first().click()

  await page.keyboard.press('F5')
  await expect(page.locator('.show-mode')).toBeVisible()
  await expect(page.locator('.cue-list-container')).toHaveCount(0)
  await expect(page.locator('.inspector')).toHaveCount(0)
  // The buttons that put cues in the list are not there to be pressed by mistake.
  await expect(page.locator('.toolbar-actions')).toBeHidden()
  await expect(page.locator('.show-card')).toHaveCount(3)
  await expect(card(0)).toHaveAttribute('data-state', 'next')

  await page.keyboard.press('Space')
  await expect(card(0)).toHaveAttribute('data-state', 'running')
  await expect(card(1)).toHaveAttribute('data-state', 'next')
  await expect(card(0).locator('.show-card-time')).toHaveText(/^−0:0\d\.\d$/)

  await page.keyboard.press('F5')
  await expect(page.locator('.show-mode')).toHaveCount(0)
  await expect(page.locator('.cue-list-container')).toBeVisible()
  await expect(page.locator('.toolbar-actions')).toBeVisible()
})

test('View → Show Mode in the application menu does the same, and Exit leaves it', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()
      ?.getMenuItemById('view-show-mode')
      ?.click(undefined, BrowserWindow.getAllWindows()[0])
  })
  await expect(page.locator('.show-mode')).toBeVisible()
  await page.locator('.show-mode-exit').click()
  await expect(page.locator('.cue-list-container')).toBeVisible()
})
