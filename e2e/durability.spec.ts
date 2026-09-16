// Durability of the workspace file: a save that cannot be completed must say so and
// must leave the previous file alone, and unsaved work must survive a session that
// ended without saving.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  ;({ app, page, userDataDir } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

function workspaceFile(cues: unknown[] = []): string {
  return JSON.stringify({
    version: 1,
    id: 'w1',
    name: 'Read Only Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues
  })
}

test('a save that cannot be written is reported and leaves the file untouched', async () => {
  test.skip(process.platform === 'win32', 'needs POSIX directory permissions to make a save fail')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-readonly-'))
  const file = path.join(dir, 'Read Only Show.wlab')
  const original = workspaceFile()
  fs.writeFileSync(file, original)

  // Put it in this instance's recent list, then open it the way an operator would.
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([file]))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Read Only Show.wlab' }).click()
  await expect(page.locator('.workspace-name')).toContainText('Read Only Show')

  // Dirty the session, then take the directory away from the app.
  await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
  fs.chmodSync(dir, 0o500)

  await page.locator('.toolbar-brand').click()
  // The File menu's own Save, by the action it performs: "Save" as text also matches
  // "Save As…", and the label carries whatever shortcut this keyboard has.
  await page.locator('.file-menu button[data-action="save"]').click()

  const notice = page.locator('.app-notice[data-kind="error"]')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Could not save the workspace')
  // The dot stays: the session really is still unsaved.
  await expect(page.locator('.workspace-name')).toContainText('●')

  fs.chmodSync(dir, 0o700)
  expect(fs.readFileSync(file, 'utf-8')).toBe(original)
  // No half-written file and no leftover temporary next to it.
  expect(fs.readdirSync(dir)).toEqual(['Read Only Show.wlab'])

  fs.rmSync(dir, { recursive: true, force: true })
})

test('unsaved work is offered back after a session that ended without saving', async () => {
  const cue = {
    id: 'c1', number: '1', name: 'Recovered Wait', type: 'wait',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
    duration: 1000, advance: 'none', isArmed: true, notes: ''
  }
  const secondCue = { ...cue, id: 'c2', number: '2', name: 'Where I Was' }
  const snapshot = {
    savedAt: Date.now(),
    sourcePath: null,
    // The session was standing on the second cue when it ended: what GO would have fired
    // next, and the first thing the operator needs back.
    selectedCueId: 'c2',
    workspace: {
      version: 1,
      id: 'w2',
      name: 'Lost Show',
      createdAt: '2026-01-01T00:00:00.000Z',
      audioSettings: { outputDeviceId: 'default' },
      midiSettings: { outputPortName: '' },
      cues: [cue, secondCue]
    }
  }

  // What autosave would have left behind, then a session that never saved.
  fs.writeFileSync(path.join(userDataDir, 'recovery.wlab'), JSON.stringify(snapshot))
  await closeApp(app)
  ;({ app, page } = await launchApp({ userDataDir }))

  const notice = page.locator('.app-notice[data-kind="recovery"]')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Lost Show')
  await expect(notice).toContainText('2 · Where I Was')

  await notice.getByRole('button', { name: 'Recover' }).click()

  await expect(page.locator('.cue-row')).toHaveCount(2)
  await expect(page.locator('.cue-row').first()).toContainText('Recovered Wait')
  // The place came back with the cues: the second row is where the session stood, so the
  // next GO fires what it would have fired.
  await expect(page.locator('.cue-row[data-selected="true"]')).toHaveCount(1)
  await expect(page.locator('.cue-row[data-selected="true"]')).toContainText('Where I Was')
  await expect(page.locator('.workspace-name')).toContainText('Lost Show')
  // Recovered work is unsaved work: the file on disk is older than the session.
  await expect(page.locator('.workspace-name')).toContainText('●')
  await expect(page.locator('.app-notice[data-kind="recovery"]')).toHaveCount(0)
  // The snapshot is consumed, so the next launch does not offer it again.
  expect(fs.existsSync(path.join(userDataDir, 'recovery.wlab'))).toBe(false)
})
