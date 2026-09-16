// The showfile as an artifact someone can diff: saving a show that has not changed must
// put the same bytes back on disk, and a changed show must differ — while keeping the
// identity the file already had. Both halves matter. A file that rewrites its id and
// creation date on every save is a file where every save is a diff; a change that does
// not show up is a file nobody can trust.
//
// The first half used to be false in the worst way: the renderer built the saved
// workspace with a fresh id and a fresh createdAt every time, so pressing Save twice
// rewrote the show's identity.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let root: string
let showPath: string

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
    trim: 1
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

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-showfile-'))
  const media = path.join(root, 'walk-in.wav')
  writeWav(media)

  showPath = path.join(root, 'Press Night.cuerunner')
  fs.writeFileSync(
    showPath,
    `${JSON.stringify(
      {
        version: 1,
        id: 'w-press-night',
        name: 'Press Night',
        createdAt: '2026-01-01T00:00:00.000Z',
        audioSettings: { outputDeviceId: 'default' },
        midiSettings: { outputPortName: '' },
        cues: [audioCue('a1', '1', 'Walk-in Music', media)]
      },
      null,
      2
    )}\n`
  )

  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  ;({ app, page } = await launchApp({ userDataDir }))
})

test.afterAll(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

async function save(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save"]').click()
  // The dot beside the name clears when the save has landed.
  await expect(page.locator('.workspace-name')).not.toContainText('●')
}

async function renameSelectedCue(name: string): Promise<void> {
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.field-row').filter({ hasText: 'Name' }).locator('input').fill(name)
}

test('saving an unedited show writes the same bytes, and an edit writes different ones', async () => {
  test.setTimeout(120_000)

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Press Night.cuerunner' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()

  // A real edit, so the save certainly runs (renaming a cue to the name it already has
  // is not an edit: React does not report a change for a value that did not change, and
  // the spec would then be asserting that an unsaved file equals itself). The file is
  // migrated on this first save — it was written without the show-services section — so
  // what follows compares this version's output with this version's output.
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await renameSelectedCue('Walk-in (house to half)')
  await save()
  const settled = fs.readFileSync(showPath, 'utf-8')
  expect(settled).toContain('Walk-in (house to half)')
  const identity = JSON.parse(settled).id
  const createdAt = JSON.parse(settled).createdAt

  // Rename it back and forth: the workspace is dirty, the content is exactly what was
  // just written, and the save therefore has to put the same bytes back — identity,
  // creation date and all. A save that mints its own id or stamps the clock fails here,
  // and a save that quietly does nothing cannot pass either, because the workspace is
  // dirty when it is asked for.
  await renameSelectedCue('Walk-in Music')
  await renameSelectedCue('Walk-in (house to half)')
  await save()
  const rewritten = fs.readFileSync(showPath, 'utf-8')
  expect(rewritten).toBe(settled)
  expect(JSON.parse(rewritten).id).toBe(identity)
  expect(JSON.parse(rewritten).createdAt).toBe(createdAt)

  // A real change is a real diff, and still does not mint a new show.
  await renameSelectedCue('Walk-in (house to half, Q2)')
  await save()
  const edited = fs.readFileSync(showPath, 'utf-8')
  expect(edited).not.toBe(settled)
  expect(edited).toContain('Walk-in (house to half, Q2)')
  expect(JSON.parse(edited).id).toBe(identity)
  expect(JSON.parse(edited).createdAt).toBe(createdAt)
})
