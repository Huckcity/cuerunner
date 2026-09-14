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

test('Ctrl+Shift+A takes the selected cue out of the show and puts it back', async () => {
  // Arming is the one edit that happens mid-run, so it has to be a key rather than a
  // right-click: the operator is watching the stage, not the mouse.
  await toolbarCueBtn(page, 'Wait').click()
  const row = page.locator('.cue-row').first()
  await expect(row).toHaveAttribute('data-armed', 'true')

  await list(page).press('Control+Shift+a')
  await expect(row).toHaveAttribute('data-armed', 'false')
  await expect(row.locator('.disarmed-pill')).toHaveText('disarmed')

  await list(page).press('Control+Shift+a')
  await expect(row).toHaveAttribute('data-armed', 'true')
  await expect(row.locator('.disarmed-pill')).toHaveCount(0)
})
