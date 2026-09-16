// Durations exist as soon as a file does (ROADMAP R1).
//
// A workspace saved without lengths — the normal state of a show that has just been
// written, or of one whose media moved — used to show nothing until somebody clicked
// each cue: a `–` in the Duration cell and a stub where a timeline block should be.
// Both symptoms are one fault, and this spec reads both off a loaded show with nothing
// selected and nothing clicked: the cell says the file's length, the group says its
// children's, the timeline block is as wide as the cue is long, and a file that is not
// there says so rather than reading as a zero.
//
// The show is handwritten and the media is written by the spec, so the lengths it
// asserts are its own and not the demo's.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'

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

/** An audio cue as the workspace file holds it: `duration: 0`, because nobody measured it. */
function audioCue(id: string, number: string, name: string, filePath: string, parentId: string | null): unknown {
  return {
    ...BASE,
    id,
    number,
    name,
    parentId,
    type: 'audio',
    duration: 0,
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    fadeOutDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 1
  }
}

function groupCue(id: string, number: string, name: string): unknown {
  return { ...BASE, id, number, name, type: 'group', duration: 0, mode: 'timeline' }
}

let app: ElectronApplication
let page: Page
let root: string

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-durations-'))
  const overture = path.join(root, 'overture.wav')
  writeWav(overture, OVERTURE_SECONDS)

  // Two timeline groups: one whose child is a file the spec wrote, one whose child is a
  // file nobody will find.
  const showPath = path.join(root, 'Lengths.wlab')
  fs.writeFileSync(
    showPath,
    JSON.stringify({
      version: 1,
      id: 'w-lengths',
      name: 'Lengths',
      createdAt: '2026-01-01T00:00:00.000Z',
      audioSettings: { outputDeviceId: 'default' },
      midiSettings: { outputPortName: '' },
      cues: [
        groupCue('g1', '1', 'Act One'),
        audioCue('a1', '2', 'Overture', overture, 'g1'),
        groupCue('g2', '3', 'Act Two'),
        audioCue('a2', '4', 'Sting', path.join(root, 'gone', 'sting.wav'), 'g2')
      ]
    })
  )

  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  ;({ app, page } = await launchApp({ userDataDir }))

  // Opened the way an operator opens it, and no cue is clicked afterwards.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Lengths.wlab' }).click()
  await expect(page.locator('.workspace-name')).toContainText('Lengths')
})

test.afterAll(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

function row(name: string) {
  return page.locator('.cue-row', { hasText: name })
}

test('the cue list has every length it can have, without touching a cue', async () => {
  // The file's own length, measured from its header.
  await expect(row('Overture').locator('.col-dur')).toHaveText('3.0s')
  // A group's length is its children's, and it is there without opening the group.
  await expect(row('Act One').locator('.col-dur')).toHaveText('3.0s')

  // A file the workspace cannot find is legible as such, not as a zero-length cue.
  await expect(row('Sting').locator('.col-dur')).toHaveText('missing')
  await expect(row('Act Two').locator('.col-dur')).toHaveText('missing')
})

test('a timeline block is the cue’s length rather than a stub', async () => {
  await row('Act One').click()
  await expect(page.locator('.timeline-panel')).toBeVisible()

  // Zoomed to 100 px/s, so three seconds is 300 px: the width is the length, not the 8px
  // stub a block of unknown length is drawn as.
  for (let click = 0; click < 4; click++) await page.locator('.tl-zoom-btn', { hasText: '+' }).click()
  await expect(page.locator('.tl-zoom-label')).toHaveText('100px/s')

  const box = await page.locator('.tl-block', { hasText: 'Overture' }).boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThan(OVERTURE_SECONDS * 100 - 3)
  expect(box!.width).toBeLessThan(OVERTURE_SECONDS * 100 + 3)
})

test('a block whose file cannot be read says so instead of drawing a length', async () => {
  await row('Act Two').click()
  const block = page.locator('.tl-block[data-media="missing"]')
  await expect(block).toHaveCount(1)
  await expect(block).toHaveAttribute('title', /could not be read/)
})