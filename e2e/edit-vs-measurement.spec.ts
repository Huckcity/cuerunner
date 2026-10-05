// A measurement is not an edit, and a typed number still is (AD-11).
//
// The app measures a file's length when the show loads and writes it onto the cue, which
// changes the bytes in the showfile. That change is the app's own work, so the file's
// history must not claim a person made it — while a duration an operator actually typed
// on a wait cue must still be recorded. Both are read off the file on disk, after a real
// save: a show handwritten with `duration: 0`, a WAV the spec writes, and no cue clicked
// until the measurement has landed.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, openFromRecent } from './helpers'

const OVERTURE_SECONDS = 3

/** A PCM WAV of an exact length, so the number the app reports is known to the test. */
function writeWav(filePath: string, seconds: number): void {
  const sampleRate = 48000
  const frames = seconds * sampleRate
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let frame = 0; frame < frames; frame++) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 12000), 44 + frame * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

const BASE = {
  colorLabel: 'none',
  parentId: null,
  preWait: 0,
  postWait: 0,
  timelineOffset: 0,
  advance: 'none',
  isArmed: true,
  notes: ''
}

/** An audio cue as a show that nobody has listened to holds it: `duration: 0`. */
function audioCue(id: string, number: string, name: string, filePath: string): unknown {
  return {
    ...BASE,
    id,
    number,
    name,
    type: 'audio',
    duration: 0,
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 1,
    playbackRate: 1,
    trim: 0
  }
}

/** A cue whose length only a person can set: nothing in the app measures a wait. */
function waitCue(id: string, number: string, name: string, duration: number): unknown {
  return { ...BASE, id, number, name, type: 'wait', duration }
}

let app: ElectronApplication
let page: Page
let root: string
let showPath: string

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-edit-vs-measurement-'))
  const overture = path.join(root, 'overture.wav')
  writeWav(overture, OVERTURE_SECONDS)

  showPath = path.join(root, 'Measures.cuerunner')
  fs.writeFileSync(
    showPath,
    JSON.stringify({
      version: 1,
      id: 'w-measures',
      name: 'Measures',
      createdAt: '2026-01-01T00:00:00.000Z',
      audioSettings: { outputDeviceId: 'default' },
      midiSettings: { outputPortName: '' },
      cues: [
        audioCue('a1', '1', 'Overture', overture),
        waitCue('w1', '2', 'Hold', 1000)
      ]
    })
  )

  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  ;({ app, page } = await launchApp({ userDataDir }))

  await openFromRecent(page, userDataDir, showPath)
  await expect(page.locator('.workspace-name')).toContainText('Measures')
})

test.afterAll(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

interface SavedShow {
  cues: Array<{ id: string; duration: number }>
  history?: Array<{ cues: Array<{ kind: string; id: string; label: string; fields?: string[] }> }>
}

/** The showfile as it is on disk, which is what a save is judged by. */
function savedShow(): SavedShow {
  return JSON.parse(fs.readFileSync(showPath, 'utf-8')) as SavedShow
}

async function save(page: Page): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save"]').click()
}

test('a save records a typed duration and not the length the app measured', async () => {
  test.setTimeout(120_000)

  // The measurement lands on its own: the row reads the file's own length with nobody
  // having clicked the cue or typed anything.
  await expect(page.locator('.cue-row', { hasText: 'Overture' }).locator('.col-dur')).toHaveText('3.0s')

  await save(page)

  // The bytes really did change — the file now carries the measured length — and the
  // history says nothing happened, because nothing did. Wait on the file, not the UI: the
  // measured duration on disk is the save, so the history read after it is the file's.
  await expect
    .poll(() => savedShow().cues.find(cue => cue.id === 'a1')?.duration, {
      message: 'the measured length written to the file',
      timeout: 30_000
    })
    .toBe(3000)
  expect(savedShow().history ?? []).toEqual([])

  // A duration the operator types on a wait cue is an edit, and the file remembers it.
  await page.locator('.cue-row', { hasText: 'Hold' }).click()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await page.locator('.field-row').filter({ hasText: 'Duration (s)' }).locator('input').fill('2.5')

  await save(page)

  await expect
    .poll(() => savedShow().cues.find(cue => cue.id === 'w1')?.duration, {
      message: 'the typed duration written to the file',
      timeout: 30_000
    })
    .toBe(2500)
  const history = savedShow().history ?? []
  expect(history).toHaveLength(1)
  expect(history[0].cues).toEqual([{ kind: 'edited', id: 'w1', label: '2 Hold', fields: ['duration'] }])
})
