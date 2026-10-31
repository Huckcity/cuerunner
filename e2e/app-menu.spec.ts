// One File menu. The application menu (a bar in the window on Windows and Linux) and the
// Cuerunner ▾ button draw the same items from one definition, and either one runs them.
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

const mac = process.platform === 'darwin'

async function menu(): Promise<{ top: string[]; file: string[] }> {
  return app.evaluate(({ Menu }) => {
    const items = Menu.getApplicationMenu()?.items ?? []
    const file = items.find(item => item.label === 'File')
    return {
      top: items.map(item => item.label),
      file: file?.submenu?.items.filter(item => item.type !== 'separator').map(item => item.label) ?? []
    }
  })
}

test('the menu bar is the conventional one for this platform, with no second Cuerunner', async () => {
  const { top } = await menu()
  expect(top).toEqual(mac ? ['Cuerunner', 'File', 'Edit', 'View', 'Playback'] : ['File', 'Edit', 'View', 'Playback', 'Help'])
})

test('the Cuerunner button and the File menu offer the same things', async () => {
  const { file } = await menu()

  await page.locator('.toolbar-brand').click()
  // The label specifically: an entry's shortcut sits inside the same button, and the
  // application menu carries it elsewhere.
  const inWindow = await page.locator('.file-menu button[data-action] .file-menu-label').allTextContents()

  // Settings sits under the app's name on a Mac, and Exit is the menu bar's own.
  const shared = (labels: string[]) => labels.filter(label => label !== 'Settings…' && label !== 'Exit')
  expect(shared(inWindow)).toEqual(shared(file))
  expect(inWindow).toContain('Settings…')
})

test('the File menu opens the demo as the button does', async () => {
  // The window answers once it has drawn, so a click the moment the process is up can
  // arrive with nobody listening.
  await expect(page.locator('.toolbar')).toBeVisible()
  // Clicked the way the menu-undo spec clicks: with the window the menu belongs to.
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()
      ?.getMenuItemById('file-open-demo')
      ?.click(undefined, BrowserWindow.getAllWindows()[0])
  })
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
  await expect(page.locator('.workspace-name-text')).toHaveText('Demo Show')
})
