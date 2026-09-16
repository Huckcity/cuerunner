// Placing a slice boundary well: the engine finds where the notes begin, and the panel
// makes those places easy to hit. The file here is four short bursts with silence
// between them, so both halves of the feature are observable — the onsets the engine
// reports and the boundary that lands on one.
//
// The tolerances are a frame: an onset is the middle of a 1024-sample analysis window,
// so it lands within a hop (5.3 ms at 48 kHz) of the attack. A boundary that missed by
// more than that would be a boundary beside the note rather than on it.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let root: string

/**
 * Four 60 ms bursts of tone at 0.5 s, 1.0 s, 1.5 s and 2.0 s in a three-second file, with
 * silence everywhere else: four attacks the engine has to find and nothing to find
 * between them.
 */
function writeBursts(filePath: string): void {
  const sampleRate = 48000
  const frames = sampleRate * 3
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  const bursts = [0.5, 1.0, 1.5, 2.0].map(at => Math.round(at * sampleRate))
  for (let frame = 0; frame < frames; frame++) {
    const inBurst = bursts.some(at => frame >= at && frame < at + sampleRate * 0.06)
    const value = inBurst ? Math.round(Math.sin(frame / 12) * 12000) : 0
    buffer.writeInt16LE(value, 44 + frame * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

test.beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-onsets-'))
  const media = path.join(root, 'bursts.wav')
  writeBursts(media)
  const showPath = path.join(root, 'Bursts.wlab')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1,
    id: 'w-bursts',
    name: 'Bursts',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [{
      id: 'a1', number: '1', name: 'Four hits', type: 'audio',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
      duration: 0, advance: 'none', isArmed: true, notes: '',
      filePath: media,
      startTime: 0, endTime: null, fadeInDuration: 0,
      volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
    }]
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  ;({ app, page } = await launchApp({ userDataDir }))

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Bursts.wlab' }).click()
  await page.locator('.cue-row', { hasText: 'Four hits' }).click()
  await expect(page.locator('.waveform-total')).toHaveText('0:03.0')
  // Four bursts, so four attacks: the panel says so once it has them, which is the
  // signal that a click will snap rather than land where the mouse was.
  await expect(page.locator('.waveform-canvas')).toHaveAttribute('data-onsets', '4')
})

test.afterEach(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

/** A click on the waveform at a fraction of its width, then the cursor's own time. */
async function clickAt(fraction: number): Promise<string> {
  const box = (await page.locator('.waveform-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2)
  await expect(page.locator('.waveform-cursor')).toBeVisible()
  return page.locator('.waveform-cursor').innerText()
}

/** The head cue's end time, in ms, as the inspector shows it. */
async function headEndMs(): Promise<number> {
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  const seconds = await page.locator('.field-row', { hasText: 'End time' }).locator('input').inputValue()
  return Math.round(Number(seconds) * 1000)
}

test('a boundary lands on the note rather than beside it', async () => {
  // The second burst starts at 1.0 s. A click at 0.32 of the file is 960 ms — forty
  // milliseconds away, and inside the reach of a hand that cannot hit an attack.
  const cursor = await clickAt(0.32)

  // The cursor's own readout is the snapped time, and it is the attack's time: the
  // boundary is placed where the note is, not where the mouse was.
  expect(cursor).toBe('split 0:01.0')
})

test('the cursor lands within a frame of the attack', async () => {
  // What "on the note" means, measured: the split writes the time the cursor stands on,
  // and the inspector reads it back in seconds.
  await clickAt(0.32)
  await page.locator('.cue-row').click({ button: 'right' })
  await page.locator('.cue-context-menu-item', { hasText: 'Split here' }).click()
  await expect(page.locator('.cue-row')).toHaveCount(2)

  await page.locator('.cue-row').first().click()
  const end = await headEndMs()
  expect(Math.abs(end - 1000)).toBeLessThanOrEqual(16)
})

test('every hit in the file is a place a boundary can land on', async () => {
  // Four bursts at 0.5 s, 1.0 s, 1.5 s and 2.0 s. Clicks near each of them land on the
  // hit rather than on the mouse: a file where only the first attack is snappable is a
  // file where the operator is placing boundaries by hand after all.
  for (const [fraction, expected] of [[0.17, 'split 0:00.5'], [0.32, 'split 0:01.0'],
    [0.49, 'split 0:01.5'], [0.65, 'split 0:02.0']] as const) {
    expect(await clickAt(fraction)).toBe(expected)
  }
})

test('splitting on a transient gives two cues that meet at the note', async () => {
  await clickAt(0.32)
  await page.locator('.cue-row').click({ button: 'right' })
  await page.locator('.cue-context-menu-item', { hasText: 'Split here' }).click()

  await expect(page.locator('.cue-row')).toHaveCount(2)
  // The second burst is at 1.0 s: the pair meet there, and the tail plays what is left.
  await page.locator('.cue-row').first().click()
  expect(await headEndMs()).toBe(1000)
  await page.locator('.cue-row').nth(1).click()
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  const start = await page.locator('.field-row', { hasText: 'Start time' }).locator('input').inputValue()
  expect(Math.round(Number(start) * 1000)).toBe(1000)
})
