// Undo/redo driven from the native Edit menu. A programmatic click has no focused
// window, so the menu falls back to the first open window (which the test supplies).
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

test('Edit menu exposes Undo and Redo with their accelerators', async () => {
  const menu = await app.evaluate(({ Menu }) => {
    const edit = Menu.getApplicationMenu()?.items.find(item => item.label === 'Edit')
    return {
      menuLabels: Menu.getApplicationMenu()?.items.map(item => item.label) ?? [],
      items: edit?.submenu?.items.map(item => ({
        id: item.id,
        label: item.label,
        accelerator: item.accelerator
      })) ?? []
    }
  })

  expect(menu.menuLabels).toContain('Edit')

  const undo = menu.items.find(item => item.id === 'edit-undo')
  const redo = menu.items.find(item => item.id === 'edit-redo')
  expect(undo?.label).toBe('Undo')
  expect(undo?.accelerator).toBe('CmdOrCtrl+Z')
  expect(redo?.label).toBe('Redo')
  expect(redo?.accelerator).toBe('Shift+CmdOrCtrl+Z')
})

test('Edit menu undo removes one cue and redo restores it', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row')).toHaveCount(2)

  for (const [menuItemId, expectedCount] of [['edit-undo', 1], ['edit-redo', 2]] as const) {
    await app.evaluate(({ Menu, BrowserWindow }, id) => {
      Menu.getApplicationMenu()
        ?.getMenuItemById(id)
        ?.click(undefined, BrowserWindow.getAllWindows()[0])
    }, menuItemId)
    await expect(page.locator('.cue-row')).toHaveCount(expectedCount)
  }
})

test('a fade added from a selected cue is one edit: one undo takes the whole cue away', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await toolbarCueBtn(page, 'Fade').click()
  // Born named for the audio cue it was made from, and aimed at it.
  await expect(page.locator('.cue-row')).toHaveCount(2)
  await expect(page.locator('.cue-row').nth(1)).toContainText('Fade Audio Cue')

  // Naming and aiming it used to be a second edit, so the first undo only un-named the
  // fade and left it in the list.
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()
      ?.getMenuItemById('edit-undo')
      ?.click(undefined, BrowserWindow.getAllWindows()[0])
  })
  await expect(page.locator('.cue-row')).toHaveCount(1)
  await expect(page.locator('.cue-row').first()).toContainText('Audio Cue')
})
