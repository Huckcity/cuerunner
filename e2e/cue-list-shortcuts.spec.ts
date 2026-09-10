// Cue list keyboard shortcuts on Windows and Linux, where there is no Cmd key.
// The list listens on its container, so each test focuses it before pressing.
// Undo and redo live in the Edit menu (see menu-undo.spec.ts): Electron handles the
// menu accelerators in the browser process, so a synthesised key press here would
// never reach them.
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

const list = (p: Page) => p.locator('.cue-list-container')

test('Ctrl+D duplicates the selected cue', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row')).toHaveCount(1)

  await list(page).press('Control+d')

  await expect(page.locator('.cue-row')).toHaveCount(2)
})

test('Ctrl+Backspace deletes the selected cue', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row')).toHaveCount(1)

  await list(page).press('Control+Backspace')

  await expect(page.locator('.cue-row')).toHaveCount(0)
})
