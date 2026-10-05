/**
 * A show has one name, and the window says it the same way everywhere.
 *
 * The toolbar used to draw the file's name once there was a file, while the title bar and
 * the close prompt drew the show's own — and a first save wrote the born-with "Untitled"
 * into a file the operator had just called something else. So a show saved as Macbeth read
 * "Macbeth" in the toolbar and "Untitled" in the title bar, and a rename typed into the
 * toolbar changed the title and left the toolbar as it was.
 *
 * What is on trial: a first save names an untitled show after its file, in the window and
 * in the bytes; and a rename shows where it was typed, and is what the next save writes.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page
let root: string
let showPath: string

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-show-name-'))
  showPath = path.join(root, 'Macbeth.cuerunner')
  ;({ app, page } = await launchApp())
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
  }, showPath)
})

test.afterAll(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

async function saveFromFileMenu(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save"]').click()
}

/** The name the file on disk carries, once the save that writes it has landed. */
function nameOnDisk(): string | null {
  try {
    return (JSON.parse(fs.readFileSync(showPath, 'utf-8')) as { name: string }).name
  } catch {
    return null
  }
}

const shownName = () => page.locator('.workspace-name-text')

test('a first save names an untitled show after its file, in the toolbar, the title and the file', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await expect(shownName()).toContainText('Untitled')
  await expect(page).toHaveTitle('Untitled ● — Cuerunner')

  await saveFromFileMenu()

  // The file first: the window's name is only worth reading once the bytes are down.
  await expect.poll(nameOnDisk, { message: 'the save should have written the show' }).toBe('Macbeth')
  await expect(shownName()).toHaveText('Macbeth')
  await expect(page).toHaveTitle('Macbeth — Cuerunner')
})

test('a rename shows where it was typed, and is what the next save writes', async () => {
  await shownName().dblclick()
  const field = page.locator('.workspace-name-input')
  await field.fill('Hamlet')
  await field.press('Enter')

  // The toolbar and the title move together, and the dot says the file is behind them.
  await expect(shownName()).toContainText('Hamlet')
  await expect(shownName()).toContainText('●')
  await expect(page).toHaveTitle('Hamlet ● — Cuerunner')

  await saveFromFileMenu()

  // Same file, new name inside it: a rename is not a Save As.
  await expect.poll(nameOnDisk, { message: 'the save should have written the new name' }).toBe('Hamlet')
  await expect(shownName()).toHaveText('Hamlet')
  await expect(page).toHaveTitle('Hamlet — Cuerunner')
  expect(fs.readdirSync(root).filter(name => name.endsWith('.cuerunner'))).toEqual(['Macbeth.cuerunner'])
})
