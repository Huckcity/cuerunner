// Slices live on the waveform: every marker a line with a grip, every piece between them a
// region saying how often it plays, and every edit made there — a marker added, dragged onto a
// note, taken out; a piece made a vamp or skipped — one undo. While the cue plays the piece the
// music is in is lit and counts its passes, and the playhead's jumps back and over are drawn.
//
// The files are written here: a tone for the playing, four short bursts for the snapping (the
// onsets spec's file), and a QLab workspace cut at twelve markers for a show that arrives with
// its slices already made.
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, openFromRecent, unreadableText } from './helpers'
import { audioCue, cueBase, writeSineWav } from './audioIo'
import { alias, audioSlice, qlabCue, qlabWorkspace, Real } from '../src/main/import/archiveFixture'

let app: ElectronApplication | undefined
let page: Page
let root: string

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-slice-markers-'))
})

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

/** Four 60 ms bursts at 0.5, 1.0, 1.5 and 2.0 s in three seconds of silence: four onsets to snap to. */
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
    buffer.writeInt16LE(inBurst ? Math.round(Math.sin(frame / 12) * 12000) : 0, 44 + frame * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

/** Writes a show around these cues and opens it the way an operator would, from Recent. */
async function openShow(name: string, cues: unknown[]): Promise<void> {
  const showPath = path.join(root, `${name}.cuerunner`)
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1, id: `w-${name}`, name, createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' }, midiSettings: { outputPortName: '' }, cues
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  ;({ app, page } = await launchApp({ userDataDir }))
  await openFromRecent(page, userDataDir, showPath)
}

/** Undo or redo, from the Edit menu that owns them: a synthesized keystroke never reaches its accelerator. */
async function menu(id: 'edit-undo' | 'edit-redo'): Promise<void> {
  await app!.evaluate(({ Menu, BrowserWindow }, itemId) => {
    Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(undefined, BrowserWindow.getAllWindows()[0])
  }, id)
}

/** Every marker's time, ms, as its grip says it. */
async function markerTimes(): Promise<number[]> {
  return page.locator('.slice-marker-grip').evaluateAll(grips =>
    grips.map(grip => Number(grip.getAttribute('aria-valuenow'))))
}

/** The counts the lane shows, piece by piece. */
const counts = (): Locator => page.locator('.slice-region .slice-region-count')

/** A point on the waveform: a fraction across it, in the lane or down over the file. */
async function stagePoint(fraction: number, where: 'lane' | 'file' = 'file'): Promise<{ x: number; y: number }> {
  const stage = (await page.locator('.waveform-stage').boundingBox())!
  return {
    x: stage.x + stage.width * fraction,
    y: where === 'lane' ? stage.y + 10 : stage.y + stage.height * 0.6
  }
}

test('a QLab track cut at twelve markers arrives on the waveform with every vamp and skip in place', async () => {
  test.setTimeout(90_000)
  const show = path.join(root, 'Sliced Track')
  fs.mkdirSync(path.join(show, 'audio'), { recursive: true })
  writeSineWav(path.join(show, 'audio', 'track.wav'), { seconds: 13 })
  // Thirteen one-second pieces. QLab archives a slice by where it ends; the tail is lastSlice.
  //   1 · ×2 · ∞ · skip · 1 · 1 · ×4 · ∞ · skip · 1 · ×3 · skip · 1
  const pieces: Array<[number, boolean]> = [
    [1, false], [2, false], [1, true], [0, false], [1, false], [1, false], [4, false],
    [1, true], [0, false], [1, false], [3, false], [0, false]
  ]
  const workspace = qlabWorkspace({
    name: 'Sliced Track',
    lists: [{
      name: 'Main Cue List',
      cues: [qlabCue('AudioCue', {
        uniqueID: 'ST1', number: '1', name: 'Rehearsal track', fileTarget: alias('audio/track.wav'),
        startTime: new Real(0), endTime: new Real(13), playCount: 1, infiniteLoop: false,
        slices: pieces.map(([count, vamp], i) => audioSlice(i + 1, count, vamp)),
        lastSlice: { $class: 'AudioSlice', time: new Real(0), playCount: 1, infiniteLoop: false }
      })]
    }]
  })
  const workspaceFile = path.join(show, 'Sliced Track.qlab5')
  fs.writeFileSync(workspaceFile, workspace)

  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  ;({ app, page } = await launchApp({ userDataDir }))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="import-qlab"]').click()
  await app!.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, workspaceFile)
  await page.locator('[data-action="qlab-file"]').click()
  const report = page.getByRole('dialog', { name: 'QLab import report' })
  await report.locator('[data-action="qlab-done"]').click()

  const track = page.locator('.cue-row', { hasText: 'Rehearsal track' })
  await track.click()
  await expect(page.locator('.waveform-total')).toHaveText('0:13.0')

  // Twelve lines with twelve grips, and thirteen regions saying what each plays: nothing to
  // open, nothing to press.
  await expect(page.locator('.slice-marker')).toHaveCount(12)
  await expect(page.locator('.slice-marker-grip')).toHaveCount(12)
  await expect(counts()).toHaveText(['×1', '×2', '∞', 'skip', '×1', '×1', '×4', '∞', 'skip', '×1', '×3', 'skip', '×1'])
  await expect(page.locator('.slice-region[data-vamp="true"]')).toHaveCount(2)
  await expect(page.locator('.slice-region[data-skip="true"]')).toHaveCount(3)
  // The file under a vamp is tinted and under a skip is struck out.
  await expect(page.locator('.slice-tint[data-kind="vamp"]')).toHaveCount(2)
  await expect(page.locator('.slice-tint[data-kind="skip"]')).toHaveCount(3)
  expect((await markerTimes())).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000])
  // Every count reads on the lane behind it, a vamp's amber and a skip's struck grey included.
  const unreadable = await unreadableText(page)
  expect(unreadable, unreadable.join('\n')).toEqual([])
  // Every piece is named for a screen reader, its count in words.
  await expect(page.locator('.slice-region').nth(2)).toHaveAttribute('aria-label', /Slice 3 of 13, 0:02.00 to 0:03.00, vamps until a devamp/)

  // Zoomed in, the markers that are on screen are still there, and the labels have room.
  await page.locator('.waveform-zoom-btn', { hasText: '+' }).click()
  await page.locator('.waveform-zoom-btn', { hasText: '+' }).click()
  await expect(page.locator('.waveform-zoom-label')).toHaveText('4×')
  expect(await page.locator('.slice-marker').count()).toBeGreaterThanOrEqual(3)
  await expect(page.locator('.slice-region[data-fit="full"]').first()).toBeVisible()
  await page.locator('.waveform-zoom-btn', { hasText: '−' }).click()
  await page.locator('.waveform-zoom-btn', { hasText: '−' }).click()

  // The inspector reads them and points at the waveform rather than editing them itself.
  await page.locator('.inspector-tab', { hasText: 'Slices' }).click()
  await expect(page.locator('.slices-summary')).toHaveText('13 slices · 2 vamps · 3 skipped — holds until a devamp')
  await expect(page.locator('.slice-marker-row')).toHaveCount(12)
  await page.locator('.inspector').screenshot({ path: test.info().outputPath('inspector.png') })
  await page.locator('.slice-marker-row[data-marker="6"]').click()
  await expect(page.locator('.slice-marker[data-marker="6"]')).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('.slice-marker-grip[data-marker="6"]')).toBeFocused()
  // The dock folded away comes back for "Show on waveform".
  await page.locator('.dock-collapse').click()
  await expect(page.locator('.waveform-panel')).toHaveCount(0)
  await page.locator('.slices-show').click()
  await expect(page.locator('.waveform-stage')).toBeFocused()

  await page.locator('.waveform-panel').screenshot({ path: test.info().outputPath('qlab-twelve-markers.png') })
})

test('markers are added, dragged onto a note, deleted and their pieces counted on the waveform — each one undo', async () => {
  test.setTimeout(120_000)
  const media = path.join(root, 'bursts.wav')
  writeBursts(media)
  await openShow('Bursts', [audioCue('a1', '1', 'Four hits', media)])
  await page.locator('.cue-row', { hasText: 'Four hits' }).click()
  await expect(page.locator('.waveform-total')).toHaveText('0:03.0')
  await expect(page.locator('.waveform-canvas')).toHaveAttribute('data-onsets', '4')
  // No slices: no lane, nothing drawn over the file.
  await expect(page.locator('.slice-marker')).toHaveCount(0)
  await expect(page.locator('.slice-lane')).toHaveCount(0)

  // ── Add: the cursor on a note, then M.
  const near1s = await stagePoint(0.32)
  await page.mouse.click(near1s.x, near1s.y)
  await expect(page.locator('.waveform-cursor')).toHaveText('split 0:01.0')
  await page.keyboard.press('m')
  await expect(page.locator('.slice-marker')).toHaveCount(1)
  await expect(counts()).toHaveText(['×1', '×1'])
  expect(Math.abs((await markerTimes())[0] - 1000)).toBeLessThanOrEqual(16)
  await expect(page.locator('.slice-marker-grip').first()).toBeFocused()
  await menu('edit-undo')
  await expect(page.locator('.slice-marker')).toHaveCount(0)
  await menu('edit-redo')
  await expect(page.locator('.slice-marker')).toHaveCount(1)

  // ── Add: a double-click lands on the note too.
  const near500 = await stagePoint(0.17)
  await page.mouse.dblclick(near500.x, near500.y)
  await expect(page.locator('.slice-marker')).toHaveCount(2)
  let times = await markerTimes()
  expect(Math.abs(times[0] - 500)).toBeLessThanOrEqual(16)

  // ── Add: from the context menu, at the place it was opened.
  const near2s = await stagePoint(0.66)
  await page.mouse.click(near2s.x, near2s.y, { button: 'right' })
  await page.locator('.slice-context-menu [data-action="slice-add"]').click()
  await expect(page.locator('.slice-marker')).toHaveCount(3)
  times = await markerTimes()
  expect(Math.abs(times[2] - 2000)).toBeLessThanOrEqual(16)

  // ── Drag: the 1 s marker taken to near 1.5 s lands on the burst there.
  const grip = page.locator('.slice-marker-grip[data-marker="1"]')
  const box = (await grip.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const to = await stagePoint(0.485, 'lane')
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => Math.abs((await markerTimes())[1] - 1500)).toBeLessThanOrEqual(16)
  // One drag, one undo: back where it was picked up, not one pointer move back.
  await menu('edit-undo')
  await expect.poll(async () => Math.abs((await markerTimes())[1] - 1000)).toBeLessThanOrEqual(16)
  await menu('edit-redo')

  // ── Drag with Shift: no snap. 1.37 s would otherwise pull onto the 1.5 s burst.
  const moved = (await grip.boundingBox())!
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  const free = await stagePoint(1370 / 3000, 'lane')
  await page.mouse.move(free.x, free.y, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  times = await markerTimes()
  expect(Math.abs(times[1] - 1370)).toBeLessThanOrEqual(12)
  expect(Math.abs(times[1] - 1500)).toBeGreaterThan(80)
  await menu('edit-undo')
  await expect.poll(async () => Math.abs((await markerTimes())[1] - 1500)).toBeLessThanOrEqual(16)

  // ── Markers cannot cross: dragged past its neighbour, a marker stops against it.
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2)
  await page.mouse.down()
  const past = await stagePoint(0.9, 'lane')
  await page.mouse.move(past.x, past.y, { steps: 8 })
  await page.mouse.up()
  times = await markerTimes()
  expect(times[1]).toBeLessThan(times[2])
  await menu('edit-undo')
  await expect.poll(async () => Math.abs((await markerTimes())[1] - 1500)).toBeLessThanOrEqual(16)

  // ── Nudge from the keyboard: ten milliseconds a press, a hundred with Shift, each press an edit.
  const before = (await markerTimes())[1]
  await grip.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await markerTimes())[1]).toBe(before + 20)
  await page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => (await markerTimes())[1]).toBe(before - 80)
  await menu('edit-undo')
  await expect.poll(async () => (await markerTimes())[1]).toBe(before + 20)
  await menu('edit-undo')
  await menu('edit-undo')
  await expect.poll(async () => (await markerTimes())[1]).toBe(before)

  // ── The keyboard walks the lane in file order: a piece, the marker that ends it, the next piece.
  await page.locator('.slice-region').first().focus()
  await page.keyboard.press('Tab')
  await expect(page.locator('.slice-marker-grip[data-marker="0"]')).toBeFocused()
  await expect(page.locator('.slice-marker-grip[data-marker="0"]')).toHaveAttribute('aria-valuetext', /^0:00\.5\d, then ×1$/)
  await page.keyboard.press('Tab')
  await expect(page.locator('.slice-region').nth(1)).toBeFocused()

  // ── Set ∞: the piece between 0.5 s and 1.5 s, chosen from its popover.
  await expect(counts()).toHaveText(['×1', '×1', '×1', '×1'])
  await page.locator('.slice-region').nth(1).click()
  const chooser = page.getByRole('menu', { name: 'Slice 2 plays' })
  await expect(chooser).toBeVisible()
  await expect(chooser.locator('[aria-checked="true"]')).toHaveText('×1')
  expect(await unreadableText(page)).toEqual([])
  await page.locator('.waveform-panel').screenshot({ path: test.info().outputPath('chooser.png') })
  await chooser.locator('[data-count="-1"]').click()
  await expect(chooser).toHaveCount(0)
  await expect(counts()).toHaveText(['×1', '∞', '×1', '×1'])
  await expect(page.locator('.slice-region').nth(1)).toHaveAttribute('data-vamp', 'true')
  await menu('edit-undo')
  await expect(counts()).toHaveText(['×1', '×1', '×1', '×1'])
  await menu('edit-redo')

  // ── Skip: from the context menu over the piece.
  const third = await stagePoint(0.58)
  await page.mouse.click(third.x, third.y, { button: 'right' })
  await page.screenshot({ path: test.info().outputPath('context-menu.png') })
  await page.locator('.slice-context-menu [data-action="slice-skip"]').click()
  await expect(counts()).toHaveText(['×1', '∞', 'skip', '×1'])
  await expect(page.locator('.slice-tint[data-kind="skip"]')).toHaveCount(1)
  await menu('edit-undo')
  await expect(counts()).toHaveText(['×1', '∞', '×1', '×1'])

  // ── A count from the keys: ↑ on a focused piece is one pass more, a digit is that count.
  await page.locator('.slice-region').nth(3).focus()
  await page.keyboard.press('ArrowUp')
  await expect(counts()).toHaveText(['×1', '∞', '×1', '×2'])
  await page.keyboard.press('0')
  await expect(counts()).toHaveText(['×1', '∞', '×1', 'skip'])
  await menu('edit-undo')
  await menu('edit-undo')
  await expect(counts()).toHaveText(['×1', '∞', '×1', '×1'])

  // ── Delete: the marker between ×1 and ∞ goes, the pieces join, and the header says the ×1 was kept.
  await page.locator('.slice-marker-grip[data-marker="0"]').focus()
  await page.keyboard.press('Delete')
  await expect(page.locator('.slice-marker')).toHaveCount(2)
  await expect(counts()).toHaveText(['×1', '×1', '×1'])
  await expect(page.locator('.waveform-slice-status')).toHaveText('Marker removed: slices 1 and 2 joined, ×1 kept over ∞')
  await menu('edit-undo')
  await expect(page.locator('.slice-marker')).toHaveCount(3)
  await expect(counts()).toHaveText(['×1', '∞', '×1', '×1'])
  // The sentence was about the removal, and the undo took the removal back.
  await expect(page.locator('.waveform-slice-status')).toHaveText('')

  // ── Delete from the context menu, on the marker itself.
  const markerX = await page.locator('.slice-marker[data-marker="2"]').evaluate(node => node.getBoundingClientRect().left)
  const stage = (await page.locator('.waveform-stage').boundingBox())!
  await page.mouse.click(markerX, stage.y + stage.height * 0.6, { button: 'right' })
  await expect(page.locator('.slice-context-menu [data-action="slice-remove"]')).toHaveAttribute('title', /Joins slices 3 and 4/)
  await page.locator('.slice-context-menu [data-action="slice-remove"]').click()
  await expect(page.locator('.slice-marker')).toHaveCount(2)
  await menu('edit-undo')
  await expect(page.locator('.slice-marker')).toHaveCount(3)

  // The show is the slices as the waveform left them, written into the cue when it is saved.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save"]').click()
  await expect(page.locator('.workspace-name')).not.toContainText('●')
  const written = JSON.parse(fs.readFileSync(path.join(root, 'Bursts.cuerunner'), 'utf-8')) as {
    cues: Array<{ slices?: { markers: number[]; playCounts: number[] } }>
  }
  const slices = written.cues[0].slices!
  expect(slices.playCounts).toEqual([1, -1, 1, 1])
  expect(slices.markers.map(ms => Math.round(ms / 100) * 100)).toEqual([500, 1500, 2000])
  await page.locator('.waveform-panel').screenshot({ path: test.info().outputPath('edited.png') })
})

test('a playing cue lights its pieces in order, counts a vamp\'s passes, and the devamp moves it on past a skip', async () => {
  test.setTimeout(120_000)
  const song = path.join(root, 'song.wav')
  writeSineWav(song, { seconds: 4, levelDb: -12 })
  // 0–0.8 once · 0.8–1.6 twice · 1.6–2.4 vamps · 2.4–3.2 skipped · 3.2–4 once
  await openShow('Playing', [
    audioCue('a1', '1', 'Groove', song, {
      duration: 4000,
      slices: { markers: [800, 1600, 2400, 3200], playCounts: [1, 2, -1, 0, 1] }
    }),
    { ...cueBase('d1', '2', 'Out'), type: 'devamp', targetCueId: 'a1' }
  ])
  const groove = page.locator('.cue-row', { hasText: 'Groove' })
  await groove.click()
  await expect(counts()).toHaveText(['×1', '×2', '∞', 'skip', '×1'])

  // A watcher in the page writes down every piece and pass the lane shows, and every jump it draws.
  await page.evaluate(() => {
    const w = window as unknown as { __places: string[]; __jumps: number }
    w.__places = []
    w.__jumps = 0
    setInterval(() => {
      const layer = document.querySelector('.slice-layer')
      const piece = layer?.getAttribute('data-playing-piece')
      const pass = layer?.getAttribute('data-pass')
      if (document.querySelector('.slice-jump')) w.__jumps++
      if (piece === null || piece === undefined) return
      const entry = `${piece}:${pass}`
      if (w.__places[w.__places.length - 1] !== entry) w.__places.push(entry)
    }, 10)
  })
  const places = () => page.evaluate(() => (window as unknown as { __places: string[] }).__places)

  await page.keyboard.press('Space')
  await expect(groove).toHaveAttribute('data-running', 'true')
  // GO moved the selection on; the waveform is the cue's, so the cue is selected again.
  await groove.click()
  await expect.poll(places, { timeout: 6000 }).toContain('2:3')
  const seen = await places()
  // In order: the twice-played piece's second pass, then the vamp pass after pass.
  expect(seen.indexOf('1:2'), seen.join(' ')).toBeGreaterThanOrEqual(0)
  expect(seen.indexOf('1:2')).toBeLessThan(seen.indexOf('2:1'))
  expect(seen.indexOf('2:1')).toBeLessThan(seen.indexOf('2:2'))
  // The lit piece says its pass, and the header names the devamp that will let it go.
  await expect(page.locator('.slice-region[data-playing="true"]')).toHaveAttribute('data-vamp', 'true')
  await expect(page.locator('.slice-region[data-playing="true"] .slice-region-pass')).toHaveText(/pass \d+/)
  await expect(page.locator('.waveform-vamp-tag')).toContainText('2 Out releases it')
  // The lit piece, its pass and the header's tag read on what is behind them.
  expect(await unreadableText(page)).toEqual([])
  // The playhead was seen jumping back at the wraps.
  expect(Number(await page.locator('.waveform-stage').getAttribute('data-jumps'))).toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as unknown as { __jumps: number }).__jumps)).toBeGreaterThan(0)
  await page.locator('.waveform-panel').screenshot({ path: test.info().outputPath('vamping.png') })

  // The devamp: the pass finishes, the skipped piece is passed over, and the last piece plays.
  await page.locator('.cue-row', { hasText: 'Out' }).click()
  await page.keyboard.press('Space')
  await groove.click()
  await expect.poll(places, { timeout: 6000 }).toContain('4:1')
  const after = await places()
  expect(after.some(place => place.startsWith('3:')), after.join(' ')).toBe(false)
  await expect(page.locator('.waveform-vamp-tag')).toHaveCount(0)
  await expect(groove).toHaveAttribute('data-running', 'false', { timeout: 5000 })
  await expect(page.locator('.slice-region[data-playing="true"]')).toHaveCount(0)
})
