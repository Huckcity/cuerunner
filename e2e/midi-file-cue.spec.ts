// A MIDI File cue, end to end: added from the toolbar, pointed at a file and a port, and
// fired — and what it played read back from the port itself.
//
// The port is the loopback the main process installs when a launch names one
// (`CUERUNNER_TEST_MIDI_LOOPBACK`, src/main/midi/loopback.ts): an output port by that name that
// writes down every message it is sent and when. A runner has no MIDI interface, and a build
// without ALSA's headers has no native MIDI module at all, so this is what lets the lane read
// the bytes, their order and their timing rather than trusting the cue's own account. The
// port is named after this branch, so it cannot be mistaken for one another spec set up.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { addCueFromMoreMenu, closeApp, launchApp, openLogPanel, setGuardWindow } from './helpers'

const PORT = 'cuerunner-feat-midi-file-cue'

let app: ElectronApplication
let page: Page
let root: string

/** A variable-length quantity, as a MIDI file writes its delta times. */
function vlq(value: number): number[] {
  const bytes = [value & 0x7f]
  let rest = value >> 7
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80)
    rest >>= 7
  }
  return bytes
}

function chunk(id: string, body: number[]): number[] {
  const length = [(body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff]
  return [...[...id].map(c => c.charCodeAt(0)), ...length, ...body]
}

function track(events: [number, ...number[]][]): number[] {
  const body = events.flatMap(([delta, ...bytes]) => [...vlq(delta), ...bytes])
  return chunk('MTrk', [...body, 0x00, 0xff, 0x2f, 0x00])
}

const named = (text: string): number[] => [0xff, 0x03, text.length, ...[...text].map(c => c.charCodeAt(0))]

/**
 * The fixture: format 1, 480 ticks a quarter. A conductor track at 120 BPM that doubles the
 * tempo on beat three; a keys part on channel 1 whose second note sits across that change; and
 * a bass part on channel 2 that the cue will be told not to send.
 *
 *   keys  60 on at 0 ms, off at 500 ms; 64 on at 1000 ms, off at 1125 ms (half a beat at 240)
 *   bass  48 on at 0 ms, off at 500 ms
 *   end   at tick 1920: 1000 ms for two beats at 120, then 500 ms for two at 240 — 1.5 s
 */
function writeFixture(): string {
  const conductor = track([
    [0, ...named('Conductor')],
    [0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20],
    [960, 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90],
    [960, 0xff, 0x01, 0x03, 0x65, 0x6e, 0x64]
  ])
  const keys = track([
    [0, ...named('Keys')],
    [0, 0x90, 60, 100],
    [480, 0x80, 60, 0],
    [480, 0x90, 64, 100],
    [240, 0x80, 64, 0]
  ])
  const bass = track([[0, ...named('Bass')], [0, 0x91, 48, 100], [480, 0x81, 48, 0]])
  const header = chunk('MThd', [0, 1, 0, 3, 0x01, 0xe0])
  const file = path.join(root, 'Overture.mid')
  fs.writeFileSync(file, Uint8Array.from([...header, ...conductor, ...keys, ...bass]))
  return file
}

interface Received {
  at: number
  bytes: number[]
}

/** What the loopback port has received, read in main. */
async function received(): Promise<Received[]> {
  return app.evaluate(() => globalThis.__cuerunnerMidiLoopback?.messages() ?? [])
}

/** One row of the inspector's fields, by the label the operator reads it under. */
function field(label: string) {
  return page.locator('.field-row').filter({ has: page.locator('label', { hasText: label }) })
}

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-feat-midi-file-cue-'))
  ;({ app, page } = await launchApp({ env: { CUERUNNER_TEST_MIDI_LOOPBACK: PORT } }))
  // The repeat guard off. Its window swallows a GO that comes within 300 ms of the one before,
  // which is its job — and on a fast runner one case's GO lands that close to the last case's,
  // so the second GO was the guard working, not the cue failing (it failed that way on macOS,
  // and fails that way here with the window set to 2000 ms). What these cases are about is the
  // file on the wire; the guard has its own spec (trigger-guard.spec.ts).
  await setGuardWindow(page, 0)
})

test.afterAll(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

test('a MIDI File cue reads its file back, and plays it to its port by itself', async () => {
  const fixture = writeFixture()
  await app.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, fixture)

  await addCueFromMoreMenu(page, 'MIDI File')
  await expect(page.locator('.inspector-tab')).toHaveText(['Basics', 'MIDI File', 'Channels', 'Triggers'])
  await page.locator('.inspector-tab', { hasText: /^MIDI File$/ }).click()
  await page.locator('.inspector-btn', { hasText: 'Browse' }).click()

  // The file is read back as main parsed it: the tempo map's real length, and each track by
  // name — a MIDI file gives no other way to know it is the one that was meant.
  await expect(page.locator('.midi-file-summary')).toHaveText('Format 1 · 3 tracks · 120 BPM (2 tempo changes) · 1.5s')
  await expect(page.locator('.midi-file-track-name')).toHaveText(['Conductor', 'Keys', 'Bass'])
  const row = page.locator('.cue-row').first()
  await expect(row.locator('.name-text')).toHaveText('Overture')
  await expect(row.locator('.col-dur')).toHaveText('1.5s')

  await field('MIDI Port').locator('select').selectOption(PORT)

  // The two things this cue does that the file does not: the bass part is left out, and the
  // keys go up a tone.
  await page.locator('.inspector-tab', { hasText: /^Channels$/ }).click()
  await page.locator('#midi-file-channel-2').selectOption('0')
  const transpose = field('Transpose').locator('input')
  await transpose.fill('2')
  await transpose.press('Enter')

  await app.evaluate(() => globalThis.__cuerunnerMidiLoopback?.clear())
  await row.click()
  await page.locator('.btn-go').click()
  await expect(row).toHaveAttribute('data-state', 'playing')

  // Every message, in order, transposed, and nothing on channel 2; then, at the file's end,
  // the pedal lifted on the channel it played on.
  await expect.poll(async () => (await received()).map(message => message.bytes), { timeout: 10_000 }).toEqual([
    [0x90, 62, 100],
    [0x80, 62, 0],
    [0x90, 66, 100],
    [0x80, 66, 0],
    [0xb0, 64, 0]
  ])

  // At the file's own times, tempo change and all, measured at the port.
  const messages = await received()
  const offsets = messages.map(message => message.at - messages[0].at)
  const expected = [0, 500, 1000, 1125, 1500]
  offsets.forEach((offset, i) => {
    expect(Math.abs(offset - expected[i]), `message ${i} at ${offset.toFixed(1)} ms, written for ${expected[i]} ms`)
      .toBeLessThan(40)
  })

  // And the cue completes by itself — nobody pressed STOP — with a clean Last run.
  await expect(row).not.toHaveAttribute('data-state', 'playing')
  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: /^MIDI File$/ }).click()
  await expect(page.locator('.last-run-badge')).toHaveText('ok')
  await openLogPanel(page)
  await expect(page.locator('.log-panel .log-row', { hasText: 'completed in' })).toHaveCount(1)
})

test('a file that is not MIDI says so in the tab, and GO says it played nothing', async () => {
  const notMidi = path.join(root, 'setlist.mid')
  fs.writeFileSync(notMidi, 'a set list, saved with the wrong name')
  await app.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, notMidi)

  await addCueFromMoreMenu(page, 'MIDI File')
  await page.locator('.inspector-tab', { hasText: /^MIDI File$/ }).click()
  await page.locator('.inspector-btn', { hasText: 'Browse' }).click()
  await expect(page.locator('.midi-file-fault'))
    .toHaveText('This file cannot be played: setlist.mid: this is not a MIDI file: it does not begin with a MIDI header')

  await app.evaluate(() => globalThis.__cuerunnerMidiLoopback?.clear())
  await page.locator('.cue-row', { hasText: 'setlist' }).click()
  await page.locator('.btn-go').click()
  await openLogPanel(page)
  await expect(page.locator('.log-panel .log-row[data-level="error"]', { hasText: 'setlist.mid: this is not a MIDI file' }))
    .toHaveCount(1)
  expect(await received()).toEqual([])
})

test('a held file goes silent, and STOP lets go of every note the cue struck', async () => {
  // Two long notes, two beats each: whatever moment the hold and the stop land on, one is down.
  const drone = path.join(root, 'Drone.mid')
  const header = chunk('MThd', [0, 0, 0, 1, 0x01, 0xe0])
  fs.writeFileSync(drone, Uint8Array.from([
    ...header,
    ...track([[0, 0x90, 60, 100], [960, 0x80, 60, 0], [0, 0x90, 67, 100], [960, 0x80, 67, 0]])
  ]))
  await app.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, drone)

  await addCueFromMoreMenu(page, 'MIDI File')
  await page.locator('.inspector-tab', { hasText: /^MIDI File$/ }).click()
  await page.locator('.inspector-btn', { hasText: 'Browse' }).click()
  await expect(page.locator('.midi-file-summary')).toContainText('2.0s')
  await field('MIDI Port').locator('select').selectOption(PORT)

  await app.evaluate(() => globalThis.__cuerunnerMidiLoopback?.clear())
  const row = page.locator('.cue-row', { hasText: 'Drone' })
  await row.click()
  // The button rather than Space: the port's select still has the keyboard, and Space there
  // opens the list instead of going.
  await page.locator('.btn-go').click()
  await expect(row).toHaveAttribute('data-state', 'playing')
  await expect.poll(async () => (await received()).map(message => message.bytes)).toEqual([[0x90, 60, 100]])

  // Held: the note is released, and nothing more is sent while it is held.
  await row.click()
  await page.locator('.inspector-tab', { hasText: /^MIDI File$/ }).click()
  await page.locator('.midi-file-hold', { hasText: 'Pause' }).click()
  await expect(row).toHaveAttribute('data-state', 'paused')
  await expect.poll(async () => (await received()).map(message => message.bytes))
    .toEqual([[0x90, 60, 100], [0x80, 60, 0]])
  await page.waitForTimeout(1500)
  expect(await received()).toHaveLength(2)

  // Resumed, it plays on from where it was held — the note it had struck is not struck again
  // — to the second note, past the place it was held.
  await page.locator('.midi-file-hold', { hasText: 'Resume' }).click()
  await expect.poll(async () => (await received()).map(message => message.bytes), { timeout: 5000 })
    .toContainEqual([0x90, 67, 100])
  expect((await received()).filter(message => message.bytes[0] === 0x90 && message.bytes[1] === 60)).toHaveLength(1)

  // STOP: the note this cue struck is released and the pedal lifted on its channel.
  await page.locator('.btn-stop').click()
  await expect.poll(async () => (await received()).map(message => message.bytes).slice(-2))
    .toEqual([[0x80, 67, 0], [0xb0, 64, 0]])
  const settled = (await received()).length
  await page.waitForTimeout(1500)
  expect(await received()).toHaveLength(settled)
  await expect(row).not.toHaveAttribute('data-state', 'playing')
})

test('a MIDI file dropped on the list becomes a MIDI File cue rather than a refusal', async () => {
  const icons = page.locator('.cue-row .cue-icon[data-type="midiFile"]')
  const before = await icons.count()
  await page.evaluate(() => {
    const list = document.querySelector('.cue-list-container')
    if (list === null) throw new Error('no cue list on screen')
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array([0x4d, 0x54, 0x68, 0x64])], 'Click.mid', { type: 'audio/midi' }))
    list.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  })
  await expect(icons).toHaveCount(before + 1)
  await expect(page.locator('.app-notice')).toHaveCount(0)
})

test('the show’s PAUSE holds a playing file silent in main, and RESUME plays it on from there', async () => {
  // The drone's bytes under a name of its own, so its row is told from the drone's.
  const held = path.join(root, 'Hold.mid')
  fs.copyFileSync(path.join(root, 'Drone.mid'), held)
  await app.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, held)
  await addCueFromMoreMenu(page, 'MIDI File')
  await page.locator('.inspector-tab', { hasText: /^MIDI File$/ }).click()
  await page.locator('.inspector-btn', { hasText: 'Browse' }).click()
  await expect(page.locator('.midi-file-summary')).toContainText('2.0s')
  await field('MIDI Port').locator('select').selectOption(PORT)

  await app.evaluate(() => globalThis.__cuerunnerMidiLoopback?.clear())
  const row = page.locator('.cue-row', { hasText: 'Hold' })
  await row.click()
  await page.locator('.btn-go').click()
  await expect(row).toHaveAttribute('data-state', 'playing')
  await expect.poll(async () => (await received()).map(message => message.bytes)).toEqual([[0x90, 60, 100]])

  // The whole show held: the file is held where it plays, its note released, and nothing more
  // goes out for longer than the file had left to its next note.
  await page.locator('.btn-pause').click()
  await expect(row).toHaveAttribute('data-state', 'paused')
  await expect.poll(async () => (await received()).map(message => message.bytes))
    .toEqual([[0x90, 60, 100], [0x80, 60, 0]])
  await page.waitForTimeout(1500)
  expect(await received()).toHaveLength(2)

  // Let go: it plays on from where it was held, to its second note and its end, and completes.
  await page.locator('.btn-pause').click()
  await expect.poll(async () => (await received()).map(message => message.bytes), { timeout: 5000 })
    .toEqual([[0x90, 60, 100], [0x80, 60, 0], [0x90, 67, 100], [0x80, 67, 0], [0xb0, 64, 0]])
  await expect(row).not.toHaveAttribute('data-state', /playing|paused/)
})
