// The showfile's own history, and the comparison against another file — the two halves
// of B6 that are read rather than written. Both open from the File menu, so both are
// driven the way an operator drives them: real windows, real files on disk, and a real
// save in between.
//
// The file dialog belongs to the OS and cannot be driven, so the comparison's pick is
// answered in the main process, exactly as the missing-media spec answers its relink.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, mintLicense, type TestLicense } from './helpers'

let app: ElectronApplication | undefined
let root: string
let showPath: string
let previewPath: string

function audioCue(id: string, number: string, name: string, filePath: string): unknown {
  return {
    id,
    number,
    name,
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 500,
    advance: 'none',
    isArmed: true,
    notes: '',
    type: 'audio',
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 0
  }
}

function waitCue(id: string, number: string, name: string, durationMs: number): unknown {
  return {
    id,
    number,
    name,
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: durationMs,
    advance: 'none',
    isArmed: true,
    notes: '',
    type: 'wait'
  }
}

function writeWav(filePath: string): void {
  const sampleRate = 48000
  const frames = sampleRate / 2
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  fs.writeFileSync(filePath, buffer)
}

function writeShow(file: string, cues: unknown[]): void {
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        version: 1,
        id: 'w-press-night',
        name: 'Press Night',
        createdAt: '2026-01-01T00:00:00.000Z',
        audioSettings: { outputDeviceId: 'default' },
        midiSettings: { outputPortName: '' },
        cues
      },
      null,
      2
    )}\n`
  )
}

async function start(options: { license?: TestLicense } = {}): Promise<Page> {
  const userDataDir = path.join(root, `userdata-${options.license ? 'pro' : 'free'}`)
  fs.mkdirSync(userDataDir, { recursive: true })
  // The app's own recent list, written where it reads it from: an operator's way in that
  // does not need a file dialog.
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  const launched = await launchApp({ ...options, userDataDir })
  app = launched.app
  return launched.page
}

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-changes-'))
  const media = path.join(root, 'walk-in.wav')
  writeWav(media)

  showPath = path.join(root, 'Press Night.wlab')
  writeShow(showPath, [
    audioCue('a1', '1', 'Walk-in Music', media),
    waitCue('w1', '3', 'Bows', 4000)
  ])

  // The version this one is compared against: one cue renamed since, one dropped, one
  // added — a change of each kind, so the comparison has all three to report.
  previewPath = path.join(root, 'Press Night — preview.wlab')
  writeShow(previewPath, [
    audioCue('a1', '1', 'Walk-in', media),
    audioCue('a2', '2', 'Interval', media)
  ])
})

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

async function openShow(page: Page): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Press Night.wlab' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
}

async function save(page: Page): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save"]').click()
  await expect(page.locator('.workspace-name')).not.toContainText('●')
}

async function openChanges(page: Page, tab: 'history' | 'compare'): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator(`.file-menu button[data-action="${tab}"]`).click()
  await expect(page.getByRole('dialog', { name: 'Changes' })).toBeVisible()
}

async function renameSelectedCue(page: Page, name: string): Promise<void> {
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.field-row').filter({ hasText: 'Name' }).locator('input').fill(name)
}

function historyOnDisk(): Array<{ at: string; by: string; cues: Array<{ kind: string; label: string; fields?: string[] }> }> {
  return JSON.parse(fs.readFileSync(showPath, 'utf-8')).history ?? []
}

test('the history says what a save changed, and nothing about a save that did not', async () => {
  test.setTimeout(120_000)
  const page = await start({ license: mintLicense() })
  await openShow(page)

  // The first save writes the file in this build's shape — the services section, the
  // per-cue triggers — which is a change to the file and not to the show. Nobody edited
  // anything, so there is nothing to read.
  await save(page)
  expect(historyOnDisk()).toEqual([])

  await openChanges(page, 'history')
  const dialog = page.getByRole('dialog', { name: 'Changes' })
  await expect(dialog.locator('.changes-empty')).toContainText('Nothing has been saved')
  await dialog.locator('.settings-close').click()

  // A real edit, and the file remembers it.
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await renameSelectedCue(page, 'Walk-in (house to half)')
  await save(page)
  await expect
    .poll(() => historyOnDisk().length, { message: 'one entry in the file' })
    .toBe(1)
  expect(historyOnDisk()[0].by).not.toBe('')
  expect(historyOnDisk()[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/)

  await openChanges(page, 'history')
  await expect(dialog.locator('.changes-entry')).toHaveCount(1)
  await expect(dialog.locator('.changes-entry').first().locator('.changes-summary')).toHaveText('1 edited')
  await dialog.locator('.changes-entry').first().locator('summary').click()
  await expect(dialog.locator('.changes-line').first()).toHaveText(
    'Edited 1 Walk-in (house to half) — name'
  )
  await dialog.locator('.settings-close').click()

  // Saving again with nothing changed writes no second entry: the file is what it was.
  const settled = fs.readFileSync(showPath, 'utf-8')
  await save(page)
  expect(fs.readFileSync(showPath, 'utf-8')).toBe(settled)
  expect(historyOnDisk()).toHaveLength(1)
})

test('the comparison says how this show differs from another file', async () => {
  test.setTimeout(120_000)
  const page = await start({ license: mintLicense() })
  await openShow(page)

  // The pick is answered in the main process; everything after it — reading the file,
  // comparing it with the show on screen, drawing the answer — runs for real.
  await app!.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, previewPath)

  await openChanges(page, 'compare')
  const dialog = page.getByRole('dialog', { name: 'Changes' })
  await dialog.locator('.changes-choose').click()

  await expect(dialog.locator('.changes-intro')).toContainText('Press Night — preview.wlab')
  // The preview had cue 2 and this show does not; this show has a cue 3 and the preview
  // did not; and cue 1 has been renamed since.
  await expect(dialog.locator('[data-group="added"] .changes-line')).toHaveText(['3 Bows'])
  await expect(dialog.locator('[data-group="removed"] .changes-line')).toHaveText(['2 Interval'])
  await expect(dialog.locator('[data-group="changed"] .changes-cue-name')).toHaveText(['1 Walk-in Music'])
  await expect(dialog.locator('[data-group="changed"] .changes-field')).toHaveText(['name “Walk-in” → “Walk-in Music”'])
  await expect(dialog.locator('.changes-foot')).toContainText('the same in both files')
})

test('a machine with no key is told what the history is, rather than shown an empty list', async () => {
  const page = await start()
  await openShow(page)

  // The menu marks the press, as it does for the other Pro surfaces.
  await page.locator('.toolbar-brand').click()
  await expect(page.locator('.file-menu button[data-action="history"] .pro-mark')).toHaveCount(1)
  await page.locator('.file-menu button[data-action="history"]').click()

  const dialog = page.getByRole('dialog', { name: 'Changes' })
  await expect(dialog.locator('.pro-lock[data-feature="Show history"]')).toBeVisible()
  await expect(dialog.locator('.changes-entry')).toHaveCount(0)
  await expect(dialog.locator('.changes-choose')).toHaveCount(0)
})
