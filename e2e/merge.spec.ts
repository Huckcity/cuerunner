// Two people, one show: the designer's file, the associate's file, and the version they
// both started from, merged into a third.
//
// The dialogs are answered in the main process; the three files, the merge and the
// merged show that comes back are real. This is the last slice of B6 and the one with the
// most to get wrong, so it is driven from the File menu the way an operator does it.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, mintLicense, type TestLicense } from './helpers'

let app: ElectronApplication | undefined
let root: string
let ours: string
let theirs: string
let ancestor: string
let merged: string

function audioCue(
  id: string,
  number: string,
  name: string,
  over: Record<string, unknown> = {}
): unknown {
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
    filePath: '',
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 0,
    ...over
  }
}

function writeShow(file: string, cues: unknown[]): void {
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        version: 1,
        id: 'w-hamlet',
        name: 'Hamlet',
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

function cuesOnDisk(file: string): Array<{ name: string; volume?: number }> {
  return JSON.parse(fs.readFileSync(file, 'utf-8')).cues
}

async function start(options: { license?: TestLicense } = {}): Promise<Page> {
  const userDataDir = path.join(root, `userdata-${options.license ? 'pro' : 'free'}`)
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([ours]))
  const launched = await launchApp({ ...options, userDataDir })
  app = launched.app
  return launched.page
}

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-merge-'))

  ancestor = path.join(root, 'Hamlet — base.wlab')
  writeShow(ancestor, [
    audioCue('a', '1', 'Walk-in'),
    audioCue('b', '2', 'Interval'),
    audioCue('c', '3', 'Bows')
  ])

  // This show: the walk-in turned down.
  ours = path.join(root, 'Hamlet.wlab')
  writeShow(ours, [
    audioCue('a', '1', 'Walk-in', { volume: 0.6 }),
    audioCue('b', '2', 'Interval'),
    audioCue('c', '3', 'Bows')
  ])

  // The associate's: the interval renamed, and a curtain call added.
  theirs = path.join(root, 'Hamlet — associate.wlab')
  writeShow(theirs, [
    audioCue('a', '1', 'Walk-in'),
    audioCue('b', '2', 'Interval (20 min)'),
    audioCue('c', '3', 'Bows'),
    audioCue('z', '4', 'Curtain call')
  ])

  merged = path.join(root, 'Hamlet (merged).wlab')
})

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

async function openShow(page: Page): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Hamlet.wlab' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Walk-in' })).toBeVisible()
}

/** Answers the merge's three dialogs: their show, the common ancestor, where to write. */
async function stubMergeDialogs(destination: string): Promise<void> {
  await app!.evaluate(async ({ dialog }, [theirsPath, ancestorPath, target]) => {
    let opens = 0
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [opens++ === 0 ? theirsPath : ancestorPath]
    })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
  }, [theirs, ancestor, destination])
}

test('two people changing different things merge into a third file', async () => {
  test.setTimeout(120_000)
  const page = await start({ license: mintLicense() })
  await openShow(page)
  await stubMergeDialogs(merged)

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="merge"]').click()

  const report = page.getByRole('dialog', { name: 'Merge' })
  await expect(report).toBeVisible()
  await expect(report.locator('.changes-intro')).toContainText('Hamlet (merged).wlab')
  await expect(report.locator('.changes-intro')).toContainText('1 from this show')
  await expect(report.locator('.changes-intro')).toContainText('2 from the other show')
  // Nobody disagreed about anything, and the report says so rather than listing decisions.
  await expect(report.locator('.changes-empty')).toContainText('nothing needed deciding')

  // The merged file holds both people's work.
  const mergedCues = cuesOnDisk(merged)
  expect(mergedCues.map(cue => cue.name)).toEqual([
    'Walk-in', 'Interval (20 min)', 'Bows', 'Curtain call'
  ])
  expect(mergedCues[0].volume).toBe(0.6)
  // …and this show has not been changed by merging into a new file.
  expect(cuesOnDisk(ours).map(cue => cue.name)).toEqual(['Walk-in', 'Interval', 'Bows'])

  // Opening it puts the operator in front of the merged show.
  await report.locator('.changes-actions button', { hasText: 'Open the merged show' }).click()
  await expect(page.getByRole('dialog', { name: 'Merge' })).toHaveCount(0)
  await expect(page.locator('.cue-row', { hasText: 'Curtain call' })).toBeVisible()
  await expect(page.locator('.cue-row', { hasText: 'Interval (20 min)' })).toBeVisible()
})

test('a cue both people changed is named, and the other side can have it with one press', async () => {
  test.setTimeout(120_000)
  // Both sides turn the walk-in down, to different levels.
  writeShow(theirs, [
    audioCue('a', '1', 'Walk-in', { volume: 0.9 }),
    audioCue('b', '2', 'Interval (20 min)'),
    audioCue('c', '3', 'Bows'),
    audioCue('z', '4', 'Curtain call')
  ])

  const page = await start({ license: mintLicense() })
  await openShow(page)
  await stubMergeDialogs(merged)

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="merge"]').click()

  const report = page.getByRole('dialog', { name: 'Merge' })
  await expect(report.locator('.changes-note')).toContainText('1 cue was changed on both sides')
  // The notes follow the cue list, so the cue both sides changed is the first line.
  await expect(report.locator('.changes-line').first()).toContainText('1 Walk-in')
  await expect(report.locator('.changes-line').first()).toContainText('kept this show (0.6 against 0.9)')
  expect(cuesOnDisk(merged)[0].volume).toBe(0.6)

  // The second attempt runs over the same two files, with the other side's choices.
  await report.locator('.changes-actions button', { hasText: 'Merge again' }).click()
  await expect(report.locator('.changes-line').first()).toContainText('kept the other show')
  await expect.poll(() => cuesOnDisk(merged)[0].volume).toBe(0.9)
})

test('a machine with no key is told what merging is for, and merges nothing', async () => {
  const page = await start()
  await openShow(page)

  await page.locator('.toolbar-brand').click()
  await expect(page.locator('.file-menu button[data-action="merge"] .pro-mark')).toHaveCount(1)
  await page.locator('.file-menu button[data-action="merge"]').click()

  await expect(page.locator('.app-notice')).toContainText('WinsLab Pro is required')
  expect(fs.existsSync(merged)).toBe(false)
})
