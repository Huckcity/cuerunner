// Splitting an audio cue: a boundary chosen where the operator can see it, two ordinary
// cues afterwards, and a pair of handles that can move it — because the point chosen at
// the moment of splitting is rarely where it should have been.
//
// The file is a real one this spec writes, so the panel has a real envelope: the rows and
// the inspector read the lengths the engine measured, not numbers the test put there.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'
// The grip is drawn where `waveformLayout` puts it, so the press that takes it is placed
// with the same radius the drawing uses rather than with a copy of the number.
import { HANDLE_RADIUS } from '../src/renderer/src/utils/waveform'

let app: ElectronApplication
let page: Page
let root: string

/** Four seconds of a 48 kHz mono tone at a quarter amplitude: enough to measure. */
function writeWav(filePath: string, seconds = 4): void {
  const sampleRate = 48000
  const frames = sampleRate * seconds
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) {
    buffer.writeInt16LE(Math.round(Math.sin(i / 40) * 8000), 44 + i * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

function audioCue(filePath: string): unknown {
  return {
    id: 'a1', number: '1', name: 'Walk-in Music', type: 'audio',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
    duration: 0, advance: 'none', isArmed: true, notes: '',
    filePath,
    startTime: 0, endTime: null, fadeInDuration: 0,
    volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
  }
}

test.beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-split-'))
  const media = path.join(root, 'walk-in.wav')
  writeWav(media)
  const showPath = path.join(root, 'Split.cuerunner')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1,
    id: 'w-split',
    name: 'Split',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [audioCue(media)]
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  ;({ app, page } = await launchApp({ userDataDir }))

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Split.cuerunner' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
})

test.afterEach(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

/** The canvas, once the engine has answered with an envelope for the file. */
async function waveformCanvas() {
  const canvas = page.locator('.waveform-canvas')
  await expect(canvas).toBeVisible()
  await expect(page.locator('.waveform-total')).toHaveText('0:04.0')
  return canvas
}

/** A click on the waveform at a fraction of its width, the way a hand places the cursor. */
async function clickWaveform(fraction: number): Promise<void> {
  const canvas = await waveformCanvas()
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2)
}

/**
 * The same click at a point the cue plays. The header chip is the panel's own statement
 * that the cursor is inside the region, so waiting for it is also what says the click
 * landed: a press that missed the canvas would leave the cursor where it was.
 */
async function placeCursor(fraction: number): Promise<void> {
  await clickWaveform(fraction)
  await expect(page.locator('.waveform-cursor')).toBeVisible()
}

/** The Time & Loops numbers for the cue being inspected, in milliseconds. */
async function regionOfSelectedCue(): Promise<{ start: number; end: number | null }> {
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  const start = Number(await page.locator('.field-row', { hasText: 'Start time' }).locator('input').inputValue()) * 1000
  const endText = await page.locator('.field-row', { hasText: 'End time' }).locator('input').inputValue()
  return { start, end: endText === '' ? null : Number(endText) * 1000 }
}

test('splitting at the cursor leaves two cues that play what the one did', async () => {
  await page.locator('.cue-row').click()
  await placeCursor(0.5)

  // The menu offers the split only where there is a place to make one.
  await page.locator('.cue-row').first().click({ button: 'right' })
  await page.locator('.cue-context-menu-item', { hasText: 'Split here' }).click()

  await expect(page.locator('.cue-row')).toHaveCount(2)
  // The pair keeps the name the cue had: a track cut in two is still that track, and the
  // two halves read as one thing split.
  await expect(page.locator('.cue-row').first()).toContainText('Walk-in Music')
  await expect(page.locator('.cue-row').nth(1)).toContainText('Walk-in Music 2')

  // The head plays the first half of the file and the tail the rest: together, the file.
  await page.locator('.cue-row').first().click()
  expect(await regionOfSelectedCue()).toEqual({ start: 0, end: 2000 })
  await expect(page.locator('.waveform-region-tag')).toContainText('plays 0:00.0–0:02.0')

  await page.locator('.cue-row').nth(1).click()
  expect(await regionOfSelectedCue()).toEqual({ start: 2000, end: null })
  await expect(page.locator('.waveform-region-tag')).toContainText('plays 0:02.0–0:04.0')
})

test('the menu offers no split when the cursor is not in the cue’s region', async () => {
  await page.locator('.cue-row').click()
  // Trim the cue first, so there is a region the cursor can be outside of.
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  await page.locator('.field-row', { hasText: 'Start time' }).locator('input').fill('3')
  await page.locator('.field-row', { hasText: 'Start time' }).locator('input').press('Enter')

  // The canvas is the whole file, so four fifths of the way across it is a point inside
  // the 3s–4s region the trim left, where the split is offered…
  await placeCursor(0.8)
  await page.locator('.cue-row').first().click({ button: 'right' })
  await expect(page.locator('.cue-context-menu-item', { hasText: 'Split here' })).toHaveCount(1)

  // …and a quarter of the way across is a point outside it, which is not this cue's
  // business. That press also closes the menu; the panel's own chip goes with the cursor
  // leaving the region, and the menu then offers no split of its own accord.
  await clickWaveform(0.25)
  await expect(page.locator('.waveform-cursor')).toBeHidden()
  await page.locator('.cue-row').first().click({ button: 'right' })
  await expect(page.locator('.cue-context-menu-item', { hasText: 'Split here' })).toHaveCount(0)
})

test('the boundary can be dragged, and moves both halves together', async () => {
  await page.locator('.cue-row').click()
  await placeCursor(0.5)
  await page.locator('.cue-row').first().click({ button: 'right' })
  await page.locator('.cue-context-menu-item', { hasText: 'Split here' }).click()

  // The head's tail grip is the circle `waveformLayout` draws on the bottom edge at the
  // end of the region — the join with the second half, half way across a four second
  // file. Selecting the head is a fresh panel, so the header has to say it is drawing the
  // head's region before anything is grabbed, and the click that lands inside that region
  // is what puts the cursor there and redraws the canvas the hand is about to press on.
  await page.locator('.cue-row').first().click()
  await expect(page.locator('.waveform-region-tag')).toContainText('plays 0:00.0–0:02.0')
  await placeCursor(0.25)

  const canvas = await waveformCanvas()
  const box = (await canvas.boundingBox())!
  const from = { x: box.x + box.width * 0.5, y: box.y + box.height - HANDLE_RADIUS }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.25, from.y, { steps: 8 })
  await page.mouse.up()

  // The head now ends where the hand left it…
  const head = await regionOfSelectedCue()
  expect(head.end).toBeGreaterThan(800)
  expect(head.end).toBeLessThan(1200)

  // …and the tail starts exactly there: a pair that no longer meets is two cues.
  await page.locator('.cue-row').nth(1).click()
  const tail = await regionOfSelectedCue()
  expect(tail.start).toBe(head.end)
})

test('one undo puts the original cue back', async () => {
  await page.locator('.cue-row').click()
  await placeCursor(0.5)
  await page.locator('.cue-row').first().click({ button: 'right' })
  await page.locator('.cue-context-menu-item', { hasText: 'Split here' }).click()
  await expect(page.locator('.cue-row')).toHaveCount(2)

  // Undo lives in the native Edit menu, and the menu owns the accelerator: a synthesized
  // keystroke never reaches it, so the item is clicked the way the menu-undo spec does.
  await app.evaluate(({ Menu, BrowserWindow }, id) => {
    Menu.getApplicationMenu()
      ?.getMenuItemById(id)
      ?.click(undefined, BrowserWindow.getAllWindows()[0])
  }, 'edit-undo')

  await expect(page.locator('.cue-row')).toHaveCount(1)
  await expect(page.locator('.cue-row').first()).toContainText('Walk-in Music')
})
