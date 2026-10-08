// Several cue lists in one show: a tab each, each with its own playhead and its own GO; cues
// and whole groups moved between them; every list operation one undo; the lists saved in the
// file and read back; a remote naming a list over OSC; and each list on the incoming clock at
// its own offset.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createSocket, type Socket } from 'node:dgram'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  closeApp, launchApp, mintLicense, oscPortOfItsOwn, openLogPanel, sendOsc, toolbarCueBtn
} from './helpers'

let app: ElectronApplication
let page: Page
let root: string
const sockets: Socket[] = []
const timers: NodeJS.Timeout[] = []

test.beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-cue-lists-'))
})

test.afterEach(async () => {
  for (const timer of timers.splice(0)) clearInterval(timer)
  for (const socket of sockets.splice(0)) socket.close()
  if (app) await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

const tab = (index: number) => page.locator('.cue-list-tab').nth(index)
const rows = () => page.locator('.cue-row')
const row = (number: string) =>
  page.locator('.cue-row').filter({ has: page.locator('.cue-number', { hasText: new RegExp(`^${number.replace('.', '\\.')}$`) }) })

async function menu(id: 'edit-undo' | 'edit-redo'): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, item) => {
    Menu.getApplicationMenu()?.getMenuItemById(item)?.click(undefined, BrowserWindow.getAllWindows()[0])
  }, id)
}

async function tabMenu(index: number, action: string): Promise<void> {
  await tab(index).click({ button: 'right' })
  await page.locator(`.cue-list-tab-menu [data-action="${action}"]`).click()
}

/** Two lists: the main one with cues 1–3, and "Effects" with cues 4–5, standing on the main list. */
async function twoLists(): Promise<void> {
  for (let i = 0; i < 3; i++) await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-list-tab-add').click()
  await expect(page.locator('.cue-list-tab')).toHaveCount(2)
  await expect(tab(1)).toHaveAttribute('aria-selected', 'true')
  await expect(rows()).toHaveCount(0)
  await tab(1).dblclick()
  await page.locator('.cue-list-tab-rename').fill('Effects')
  await page.locator('.cue-list-tab-rename').press('Enter')
  await expect(tab(1)).toContainText('Effects')
  for (let i = 0; i < 2; i++) await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row .cue-number')).toHaveText(['4', '5'])
  await tab(0).click()
  await expect(page.locator('.cue-row .cue-number')).toHaveText(['1', '2', '3'])
}

test('each list is a tab with its own cues and its own playhead, and GO acts on the one in front', async () => {
  ;({ app, page } = await launchApp())
  await twoLists()

  // Standing on cue 2 of the main list; the effects list's place is where it was left, on the
  // cue last added there. Its hand is put on its first cue.
  await row('2').click()
  await tab(1).click()
  await expect(row('5')).toHaveAttribute('data-selected', 'true')
  await row('4').click()

  await page.locator('.cue-list-container').focus()
  await page.keyboard.press('Space')
  await expect(row('4')).toHaveAttribute('data-running', 'true')
  await expect(row('5')).toHaveAttribute('data-selected', 'true')

  // Back on the main list, the hand is where it was left, and GO fires from there.
  await tab(0).click()
  await expect(row('2')).toHaveAttribute('data-selected', 'true')
  await expect(row('1')).toHaveAttribute('data-running', 'false')
  // The effects tab says it has something running while it is not on screen.
  await expect(tab(1).locator('.cue-list-tab-running')).toBeVisible()
  await page.locator('.cue-list-container').focus()
  await page.keyboard.press('Space')
  await expect(row('2')).toHaveAttribute('data-running', 'true')

  // The Active panel names each running cue's list.
  await page.locator('.dock-tab.btn-active').click()
  await expect(page.locator('.active-row[data-cue-id] .active-list')).toHaveText([' · Effects', ' · Main Cue List'])

  // STOP is the list in front's: the effects cue plays on.
  await page.keyboard.press('Escape')
  await expect(row('2')).toHaveAttribute('data-running', 'false')
  await expect(tab(1).locator('.cue-list-tab-running')).toBeVisible()
})

test('a group moves to another list whole, and one undo puts it back', async () => {
  ;({ app, page } = await launchApp())
  await twoLists()
  await row('3').click()
  await toolbarCueBtn(page, 'Group').click()
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row[data-depth="1"]')).toHaveCount(2)
  const group = page.locator('.cue-row[data-type="group"]')

  await group.click({ button: 'right' })
  await page.locator('.cue-context-menu [data-action="move-to-list"]').click()
  await expect(page.locator('.cue-row .cue-number')).toHaveText(['1', '2', '3'])

  await tab(1).click()
  await expect(page.locator('.cue-row[data-type="group"]')).toHaveCount(1)
  await expect(page.locator('.cue-row[data-depth="1"]')).toHaveCount(2)
  await expect(rows()).toHaveCount(5)

  await menu('edit-undo')
  await expect(rows()).toHaveCount(2)
  await tab(0).click()
  await expect(page.locator('.cue-row[data-depth="1"]')).toHaveCount(2)
  await expect(rows()).toHaveCount(6)
})

test('rows dropped on a tab move to that list', async () => {
  ;({ app, page } = await launchApp())
  await twoLists()
  await row('1').dragTo(tab(1))
  await expect(page.locator('.cue-row .cue-number')).toHaveText(['2', '3'])
  await tab(1).click()
  await expect(page.locator('.cue-row .cue-number')).toHaveText(['4', '5', '1'])
})

test('a list is renamed, coloured, made a cart, moved and deleted — each one undo — and saved with the show', async () => {
  ;({ app, page } = await launchApp())
  await twoLists()

  await tabMenu(1, 'toggle-cart')
  await expect(tab(1)).toHaveAttribute('data-cart', 'true')
  await tab(1).click({ button: 'right' })
  await page.locator('.cue-list-tab-menu .cue-context-menu-color[aria-label="blue"]').click()
  await tabMenu(1, 'move-left')
  await expect(page.locator('.cue-list-tab .cue-list-tab-name')).toHaveText(['Effects', 'Main Cue List'])
  await menu('edit-undo')
  await expect(page.locator('.cue-list-tab .cue-list-tab-name')).toHaveText(['Main Cue List', 'Effects'])

  // Saved, the file carries the lists and each cue's list; reopened, the tabs come back.
  const saved = path.join(root, 'Lists.cuerunner')
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, saved)
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save-as"]').click()
  await expect.poll(() => fs.existsSync(saved)).toBe(true)
  const file = JSON.parse(fs.readFileSync(saved, 'utf-8')) as {
    cueLists: Array<{ id: string; name: string; color?: string; cart?: boolean }>
    cues: Array<{ number: string; listId?: string }>
  }
  expect(file.cueLists.map(list => [list.name, list.color ?? 'none', list.cart === true]))
    .toEqual([['Main Cue List', 'none', false], ['Effects', 'blue', true]])
  expect(file.cues.map(cue => [cue.number, cue.listId ?? 'main']))
    .toEqual([['1', 'main'], ['2', 'main'], ['3', 'main'], ['4', file.cueLists[1].id], ['5', file.cueLists[1].id]])

  // Deleting asks first, and counts what goes with it.
  await tabMenu(1, 'delete-list')
  const confirm = page.getByRole('alertdialog', { name: 'Delete list' })
  await expect(confirm).toContainText('Its 2 cues go with it.')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.cue-list-tab')).toHaveCount(2)
  await tabMenu(1, 'delete-list')
  await confirm.locator('[data-action="confirm-delete-list"]').click()
  await expect(page.locator('.cue-list-tab')).toHaveCount(1)
  await menu('edit-undo')
  await expect(page.locator('.cue-list-tab')).toHaveCount(2)
  await tab(1).click()
  await expect(page.locator('.cart-tile')).toHaveCount(2)

  // The main list cannot be deleted: it is where a cue with no list runs.
  await tab(0).click({ button: 'right' })
  await expect(page.locator('.cue-list-tab-menu [data-action="delete-list"]')).toBeDisabled()
})

test('a cart list fires its tiles, and a tile given a key fires from any list', async () => {
  ;({ app, page } = await launchApp())
  await twoLists()
  await tabMenu(1, 'toggle-cart')
  await tab(1).click()
  await expect(page.locator('.cart-tile')).toHaveCount(2)

  await page.locator('.cart-tile').nth(1).click({ button: 'right' })
  await expect(page.locator('.cart-hint')).toContainText('Press the key for this tile')
  await page.keyboard.press('q')
  await expect(page.locator('.cart-tile').nth(1)).toHaveAttribute('data-own-key', 'q')

  // From the main list, the key fires the tile behind it.
  await tab(0).click()
  await page.locator('.cue-list-container').focus()
  await page.keyboard.press('q')
  await expect(tab(1).locator('.cue-list-tab-running')).toBeVisible()
  await expect(row('1')).toHaveAttribute('data-running', 'false')
})

test('a disarmed list fires nothing, and says so', async () => {
  ;({ app, page } = await launchApp())
  await twoLists()
  await tabMenu(1, 'toggle-armed')
  await expect(tab(1)).toHaveAttribute('data-disarmed', 'true')
  await tab(1).click()
  await page.locator('.cue-list-container').focus()
  await page.keyboard.press('Space')
  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText('not fired: the list “Effects” is disarmed')
  await expect(row('4')).toHaveAttribute('data-running', 'false')
})

test('a remote names a list over OSC: GO and STOP on it, and /go stays the list in front’s', async () => {
  ;({ app, page } = await launchApp())
  const port = await oscPortOfItsOwn(page)
  await twoLists()
  await row('1').click()

  // GO on the effects list, by name, with the main list in front.
  await expect.poll(async () => {
    await sendOsc(port, '/list/Effects/go')
    return tab(1).locator('.cue-list-tab-running').count()
  }).toBeGreaterThan(0)
  await expect(tab(0)).toHaveAttribute('aria-selected', 'true')
  await expect(row('1')).toHaveAttribute('data-running', 'false')

  // /go is the list in front's.
  await sendOsc(port, '/go')
  await expect(row('1')).toHaveAttribute('data-running', 'true')

  // QLab's /cue_id/{list id}/stop, the way a QLab remote names a list.
  const effects = await tab(1).getAttribute('data-list-id')
  await sendOsc(port, `/cue_id/${effects}/stop`)
  await expect(tab(1).locator('.cue-list-tab-running')).toHaveCount(0)
  await expect(row('1')).toHaveAttribute('data-running', 'true')

  // /cuerunner/list/2/select brings the second tab to the front.
  await sendOsc(port, '/cuerunner/list/2/select')
  await expect(tab(1)).toHaveAttribute('aria-selected', 'true')
})

function artTimecode(hours: number, minutes: number, seconds: number, frames: number): Buffer {
  const packet = Buffer.alloc(19)
  packet.write('Art-Net\0', 0, 'latin1')
  packet[9] = 0x97
  packet[11] = 14
  packet[14] = frames
  packet[15] = seconds
  packet[16] = minutes
  packet[17] = hours
  packet[18] = 1
  return packet
}

test('each list follows the clock at its own offset, or not at all', async () => {
  ;({ app, page } = await launchApp({ license: mintLicense() }))
  const port = 47900 + Math.floor(Math.random() * 90)
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Timecode', exact: true }).click()
  await dialog.locator('#settings-timecode-source').selectOption('artnet')
  await dialog.locator('#settings-timecode-artnet-port').fill(String(port))
  await dialog.locator('#settings-timecode-artnet-port').blur()
  await expect(dialog.locator('.settings-service[data-service="timecode"]')).toContainText(`UDP ${port}`)
  await dialog.getByRole('button', { name: 'Close' }).click()

  const triggerAt = async (label: string): Promise<void> => {
    await toolbarCueBtn(page, 'Wait').click()
    await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
    await page.locator('#trigger-timecode').fill(label)
    await page.locator('.trigger-timecode-add').click()
  }
  // A cue in the main list, and one in each of two more lists, all on 01:00:01:00.
  await triggerAt('01:00:01:00')
  for (const name of ['Later', 'Off']) {
    await page.locator('.cue-list-tab-add').click()
    await page.locator('.cue-list-tab').last().dblclick()
    await page.locator('.cue-list-tab-rename').fill(name)
    await page.locator('.cue-list-tab-rename').press('Enter')
    await triggerAt('01:00:01:00')
  }
  // "Later" sits a second further on the clock; "Off" does not follow it.
  await tabMenu(1, 'list-settings')
  const settings = page.getByRole('dialog', { name: 'List settings' })
  await settings.locator('#list-offset').fill('25')
  await settings.locator('#list-offset').press('Enter')
  await settings.getByRole('button', { name: 'Done' }).click()
  await tabMenu(2, 'list-settings')
  await settings.locator('#list-timecode').uncheck()
  await settings.getByRole('button', { name: 'Done' }).click()

  const socket = createSocket('udp4')
  sockets.push(socket)
  let frame = 0
  timers.push(setInterval(() => {
    const total = 90_000 + frame++
    socket.send(artTimecode(Math.floor(total / 90_000), Math.floor(total / 1500) % 60, Math.floor(total / 25) % 60, total % 25), port, '127.0.0.1')
  }, 40))

  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText('Triggered by timecode 01:00:01:00', { timeout: 10_000 })
  await expect(page.locator('.log-panel')).toContainText('Triggered by timecode 01:00:02:00', { timeout: 10_000 })
  await page.waitForTimeout(500)
  // Two firings, never three: the list that does not follow the clock stayed quiet.
  await expect(page.locator('.log-panel').getByText(/Triggered by timecode/)).toHaveCount(2)
})
