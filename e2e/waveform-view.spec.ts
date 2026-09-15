// The waveform panel as a place to read a track: what part of the file is on screen, what
// a click reaches, and which cue the cursor belongs to. The file is a steady tone, so
// nothing here is snapped onto a transient — every time the panel reports is the time the
// pointer asked for.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'
import { HANDLE_RADIUS } from '../src/renderer/src/utils/waveform'

let app: ElectronApplication
let page: Page
let root: string

/** Twenty seconds of tone: long enough that a zoomed window is a different place, and
    long enough that a playing cue outlives the presses a test makes around it. */
function writeWav(filePath: string, seconds = 20): void {
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

const cue = (id: string, number: string, name: string, filePath: string): unknown => ({
  id, number, name, type: 'audio',
  colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
  duration: 0, advance: 'none', isArmed: true, notes: '',
  filePath,
  startTime: 0, endTime: null, fadeInDuration: 0,
  volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
})

test.beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-view-'))
  const media = path.join(root, 'reel.wav')
  writeWav(media)
  const showPath = path.join(root, 'View.wlab')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1,
    id: 'w-view',
    name: 'View',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [
      cue('a1', '1', 'Reel One', media),
      cue('a2', '2', 'Reel Two', media)
    ]
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  ;({ app, page } = await launchApp({ userDataDir }))

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'View.wlab' }).click()
  await page.locator('.cue-row', { hasText: 'Reel One' }).click()
  await expect(page.locator('.waveform-total')).toHaveText('0:20.0')
})

test.afterEach(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

/**
 * A click at a fraction of the canvas, and the time the panel says it landed on.
 *
 * The cursor appears when the panel has drawn the click, and a click that arrives while the
 * canvas is still settling is a click into nothing. On the Windows runner — a VM with software
 * rendering, which is also busy with whatever else the host is doing — that window is wide
 * enough to lose, which is how this spec failed a lane that had passed without it five runs
 * running. So the click is repeated until the panel has something to show, bounded: a panel
 * that never draws a cursor for a click still fails, three attempts later.
 */
async function clickAt(fraction: number): Promise<string> {
  const canvas = page.locator('.waveform-canvas')
  const cursor = page.locator('.waveform-cursor')
  await expect(canvas).toBeVisible()

  for (let attempt = 0; ; attempt++) {
    const box = await canvas.boundingBox()
    if (box) await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2)
    try {
      await expect(cursor).toBeVisible({ timeout: 2000 })
      return cursor.innerText()
    } catch (error) {
      if (attempt >= 2) throw error
    }
  }
}

const zoomLabel = (): Promise<string> => page.locator('.waveform-zoom-label').innerText()

/** The cursor's time, in ms, from the panel's own readout. */
function ms(text: string): number {
  const [min, sec] = text.replace('split ', '').split(':')
  return Number(min) * 60_000 + Number(sec) * 1000
}

test('the panel zooms into the file, and the same presses reach less of it', async () => {
  // What two presses across the panel are worth in file time: three fifths of whatever
  // the window is showing.
  const span = async (): Promise<number> =>
    ms(await clickAt(0.85)) - ms(await clickAt(0.25))

  // The whole file: the two presses are twelve seconds apart.
  expect(await span()).toBe(12_000)

  // Two steps in, and the window is five seconds wide: the same presses are three
  // seconds apart, which is the whole point of a zoom — less of the track on screen.
  await page.locator('.waveform-zoom-btn', { hasText: '+' }).click()
  await page.locator('.waveform-zoom-btn', { hasText: '+' }).click()
  expect(await zoomLabel()).toBe('4×')
  expect(await span()).toBe(3000)

  // And all the way back out: the window is the file again, and the presses with it.
  await page.locator('.waveform-zoom-btn', { hasText: '−' }).click()
  await page.locator('.waveform-zoom-btn', { hasText: '−' }).click()
  expect(await zoomLabel()).toBe('1×')
  expect(await span()).toBe(12_000)
})

test('the drum of a wheel pans a zoomed window along the file', async () => {
  await page.locator('.waveform-zoom-btn', { hasText: '+' }).click()
  await page.locator('.waveform-zoom-btn', { hasText: '+' }).click()

  const before = await clickAt(0.25)
  const box = (await page.locator('.waveform-canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 400)
  const after = await clickAt(0.25)

  // The same press reaches further into the track: the window moved rather than the file.
  expect(ms(after)).toBeGreaterThan(ms(before))
})

test('a cursor belongs to the cue it was placed on', async () => {
  // Placed on the first reel: it is a time in that file, so it is that cue's.
  expect(await clickAt(0.5)).toBe('split 0:10.0')
  expect(await zoomLabel()).toBe('1×')

  // The second reel has no cursor of its own — and no split to offer at one, however
  // close the first reel's time happens to be to this file's middle.
  await page.locator('.cue-row', { hasText: 'Reel Two' }).click()
  await expect(page.locator('.waveform-cursor')).toBeHidden()
  await page.locator('.cue-row', { hasText: 'Reel Two' }).click({ button: 'right' })
  await expect(page.locator('.cue-context-menu-item', { hasText: 'Split here' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Coming back to the first reel is coming back to where the operator was.
  await page.locator('.cue-row', { hasText: 'Reel One' }).click()
  await expect(page.locator('.waveform-cursor')).toContainText('split 0:10.0')
})

test('a zoom is a reading of the reel it was made on', async () => {
  await page.locator('.waveform-zoom-btn', { hasText: '+' }).click()
  expect(await zoomLabel()).toBe('2×')

  await page.locator('.cue-row', { hasText: 'Reel Two' }).click()
  await expect(page.locator('.waveform-zoom-label')).toHaveText('1×')
  await page.locator('.cue-row', { hasText: 'Reel One' }).click()
})

test('Escape stops a playing track without taking the panel away', async () => {
  // The panel is drawn from the selection, so an Escape that dropped the selection would
  // take the waveform with it — at exactly the moment the operator is watching it.
  await page.locator('.cue-row', { hasText: 'Reel One' }).click()
  await page.getByRole('button', { name: /GO/ }).click()

  // GO moves the selection on; the operator puts their hand back on the track that is
  // making the sound, which is what shows the waveform of a playing cue.
  await page.locator('.cue-row', { hasText: 'Reel One' }).click()
  await expect(page.locator('.waveform-elapsed')).toBeVisible()

  await page.keyboard.press('Escape')

  // The show stopped and the panel stayed: the press belongs to the transport.
  await expect(page.locator('.waveform-elapsed')).toBeHidden()
  await expect(page.locator('.waveform-canvas')).toBeVisible()
  await expect(page.locator('.cue-row', { hasText: 'Reel One' })).toHaveAttribute('data-selected', 'true')
})

test('the panel is framed: the grips are never on the window’s edge', async () => {
  // The grips are drawn on the file's own edges, which are the canvas's: with the canvas
  // against the window's edge, half of each one is a handle nobody can aim at.
  const box = (await page.locator('.waveform-canvas').boundingBox())!
  const windowWidth = await page.evaluate(() => window.innerWidth)

  expect(box.x).toBeGreaterThanOrEqual(HANDLE_RADIUS)
  expect(windowWidth - (box.x + box.width)).toBeGreaterThanOrEqual(HANDLE_RADIUS)
})
