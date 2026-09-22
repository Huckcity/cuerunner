// Durability of the workspace file: a save that cannot be completed must say so and
// must leave the previous file alone, and unsaved work must survive a session that
// ended without saving.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
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

function workspaceFile(cues: unknown[] = [], name = 'Read Only Show'): string {
  return JSON.stringify({
    version: 1,
    id: 'w1',
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues
  })
}

test('a save that cannot be written is reported and leaves the file untouched', async () => {
  test.skip(process.platform === 'win32', 'needs POSIX directory permissions to make a save fail')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-readonly-'))
  const file = path.join(dir, 'Read Only Show.cuerunner')
  const original = workspaceFile()
  fs.writeFileSync(file, original)

  // Put it in this instance's recent list, then open it the way an operator would.
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([file]))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Read Only Show.cuerunner' }).click()
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
  expect(fs.readdirSync(dir)).toEqual(['Read Only Show.cuerunner'])

  fs.rmSync(dir, { recursive: true, force: true })
})

test('unsaved work is offered back after a session that ended without saving', async () => {
  // One autosave interval is thirty seconds, and the interval is the point of the test.
  test.setTimeout(120_000)

  const firstCue = {
    id: 'c1', number: '1', name: 'Recovered Wait', type: 'wait',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
    duration: 1000, advance: 'none', isArmed: true, notes: ''
  }
  const secondCue = { ...firstCue, id: 'c2', number: '2', name: 'Where I Was' }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-recovery-'))
  const file = path.join(dir, 'Lost Show.cuerunner')
  fs.writeFileSync(file, workspaceFile([firstCue, secondCue], 'Lost Show'))

  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([file]))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Lost Show.cuerunner' }).click()
  await expect(page.locator('.workspace-name')).toContainText('Lost Show')

  // An operator's edit, then the cue GO would fire next: what a snapshot is for.
  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  const duration = page.locator('.field-row').filter({ hasText: 'Duration' }).locator('input')
  await duration.click()
  await duration.fill('4500')
  await duration.blur()
  await page.locator('.cue-row').nth(1).click()

  // The app's own autosave writes the snapshot — no fabricated file — so what the
  // recovery path reads is what the session actually left behind.
  const snapshotPath = path.join(userDataDir, 'recovery.cuerunner')
  await expect.poll(() => fs.existsSync(snapshotPath), { timeout: 60_000 }).toBe(true)
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'))
  expect(snapshot.workspace.name).toBe('Lost Show')
  expect(snapshot.workspace.cues.map((c: { name: string }) => c.name))
    .toEqual(['Recovered Wait', 'Where I Was'])
  expect(snapshot.selectedCueId).toBe(snapshot.workspace.cues[1].id)
  // The snapshot carries the identity main holds for the file this session was built from
  // — the show it opened from the recent list — so a save after this crash can tell that
  // the file changed while the app was dead.
  expect(snapshot.sourceFingerprint).toEqual({
    size: fs.statSync(file).size,
    hash: createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  })

  // A session that never saved, then one that offers the work back.
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
  expect(fs.existsSync(path.join(userDataDir, 'recovery.cuerunner'))).toBe(false)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('a snapshot this build cannot read is said rather than swallowed', async () => {
  // The session before this one ended without saving, so there is work to offer back — and
  // the snapshot on disk is not one this build can bring forward. The operator's only sight
  // of it is the bar, which has to say so: silently offering nothing reads as a session that
  // never autosaved.
  await closeApp(app)
  fs.writeFileSync(path.join(userDataDir, 'recovery.cuerunner'), '{"workspace":{"cues":[')
  ;({ app, page } = await launchApp({ userDataDir }))

  const bar = page.locator('.app-notice[data-kind="recovery"]')
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('Could not bring the unsaved work back')
  // The file it could not read is named, and V8's parse text is not what the operator reads.
  await expect(bar).toContainText('recovery.cuerunner')
  await expect(bar).not.toContainText('Unexpected token')
  // Nothing to decide about a snapshot that is not offerable: no Recover, no Discard.
  await expect(bar.locator('.app-notice-action')).toHaveCount(0)

  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('Could not bring the unsaved work back')
})
