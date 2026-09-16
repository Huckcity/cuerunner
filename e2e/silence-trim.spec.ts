// Auto-trim: what a cue plays once the silence at the edges of its file has been
// measured. The file here is shaped so there is nothing to interpret — two seconds of
// digital silence, six seconds of tone, three more of silence — so what the trim drops
// is a number the test reads off the app rather than infers from a waveform. The scan
// itself is the engine's; what these tests hold to is that the surfaces agree with it.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, mintLicense, openFromRecent, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page
let root: string
let media: string
let showPath: string
let userDataDir: string

/** What the inspector should say the trim drops from the shaped file: the two seconds of
    silence at the head and the three at the tail, and nothing from the tone between. */
const TRIMMED = 'cuts 2.0s at the head · 3.0s at the tail'

/** Eleven seconds of 16-bit mono at 48 kHz, with silence no scan can mistake: two
    seconds of zeroes, six seconds of tone, then three more seconds of zeroes. */
function writeShapedWav(filePath: string): void {
  const sampleRate = 48000
  const seconds = 11
  const toneStart = 2
  const toneEnd = 8
  const frames = sampleRate * seconds
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) {
    const secondsIn = i / sampleRate
    const audible = secondsIn >= toneStart && secondsIn < toneEnd
    buffer.writeInt16LE(audible ? Math.round(Math.sin(i / 40) * 8000) : 0, 44 + i * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

/** An audio cue, with the trim asked for and nothing measured yet — what a show written
    on another machine and flagged for auto-trim looks like when it arrives. */
const audioCue = (
  id: string,
  number: string,
  name: string,
  filePath: string,
  patch: Record<string, unknown> = {}
): unknown => ({
  id, number, name, type: 'audio',
  colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
  duration: 0, advance: 'none', isArmed: true, notes: '',
  filePath,
  startTime: 0, endTime: null, fadeInDuration: 0,
  volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1,
  ...patch
})

/** The workspace on disk as a saved show looks, so the app opens it the way it opens any
    other — the show's own settings and its cues, nothing else. */
function writeShow(cues: unknown[], audioSettings: Record<string, unknown> = {}): void {
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1,
    id: 'w-trim',
    name: 'Trim',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default', ...audioSettings },
    midiSettings: { outputPortName: '' },
    cues
  }, null, 2)}\n`)
}

/**
 * The file and show for one test, a launch, and the show opened from the app's own
 * recents. Licensed unless the test says otherwise: the trim needs no licence, and the
 * unlicensed launch is the test that keeps that true.
 */
async function openShow(options: {
  licensed?: boolean
  cues?: unknown[]
  audioSettings?: Record<string, unknown>
} = {}): Promise<void> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-trim-'))
  media = path.join(root, 'shaped.wav')
  writeShapedWav(media)
  showPath = path.join(root, 'Trim.wlab')
  writeShow(
    options.cues ?? [audioCue('a1', '1', 'Reel One', media, { trimSilence: true })],
    options.audioSettings
  )
  userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  ;({ app, page } = await launchApp({
    userDataDir,
    ...(options.licensed === false ? {} : { license: mintLicense() })
  }))
  await openFromRecent(page, userDataDir, showPath)
  await expect(page.locator('.cue-row').first()).toBeVisible()
}

/** Selects the cue by name and opens the tab the silence trim sits on, beside the
    region it plays. */
async function inspect(name: string): Promise<void> {
  await page.locator('.cue-row', { hasText: name }).click()
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
}

// ── Settings, opened the way the Window menu does ────────────────────────────

async function openSettingsOn(tab: string): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: tab, exact: true }).click()
}

async function closeSettings(): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).not.toBeVisible()
}

test.afterEach(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

test('a flagged cue is measured, and the inspector and the panel agree on what it drops', async () => {
  await openShow()
  await inspect('Reel One')

  // The panel knows the file before it knows the sound: the length arrives from the
  // engine's own probe, and the scan is the separate question asked on the way in.
  await expect(page.locator('.waveform-total')).toHaveText('0:11.0')

  // The measurement lands and the trim becomes a number the operator can check: two
  // seconds off the head, three off the tail, every silent sample in the file.
  await expect(page.locator('.trim-silence-readout')).toHaveText(TRIMMED)
  await expect(page.locator('.waveform-region-tag')).toHaveText('plays 0:02.0–0:08.0')
})

test('the trim is a way of playing the cue, not an edit to it, and it keeps its answer', async () => {
  await openShow()
  await inspect('Reel One')
  await expect(page.locator('.waveform-region-tag')).toHaveText('plays 0:02.0–0:08.0')

  // Off: the cue plays the whole file it names, which is the region exactly as the
  // operator set it. Nothing was rewritten, so nothing has to be restored — the readout
  // still carries the measurement, marked as not being applied.
  await page.locator('#inspector-trim-silence').setChecked(false)
  await expect(page.locator('.waveform-region-tag')).toHaveCount(0)
  await expect(page.locator('.waveform-total')).toHaveText('0:11.0')
  await expect(page.locator('.trim-silence-readout')).toHaveText(`measured: ${TRIMMED} (trim is off)`)

  // On again: the measurement is a fact about the file, so it is still held and the
  // readout is back in the same breath as the press — no second pass to wait for. The
  // checkbox and the readout are drawn from the same cue, so once the press has landed
  // in the checkbox the sentence beside it is the settled one, read rather than waited for.
  await page.locator('#inspector-trim-silence').setChecked(true)
  await expect(page.locator('#inspector-trim-silence')).toBeChecked()
  expect(await page.locator('.trim-silence-readout').innerText()).toBe(TRIMMED)
  await expect(page.locator('.waveform-region-tag')).toHaveText('plays 0:02.0–0:08.0')
})

test('the show setting seeds the cues added after it, not the show it was set in', async () => {
  await openShow({
    cues: [audioCue('a1', '1', 'Reel One', media)],
    audioSettings: { autoTrimSilence: false }
  })

  // The setting is the show's, and it is off until someone asks for it.
  await openSettingsOn('Audio')
  const autoTrim = page.locator('#settings-auto-trim')
  await expect(autoTrim).not.toBeChecked()
  await autoTrim.setChecked(true)
  await closeSettings()

  // The cue that was already in the show is the operator's, not the setting's: turning
  // the default on does not go back and rewrite a stack that was built without it.
  await inspect('Reel One')
  await expect(page.locator('#inspector-trim-silence')).not.toBeChecked()

  // A cue added now is born with it, which is the whole of what the setting promises.
  await toolbarCueBtn(page, 'Audio').click()
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  await expect(page.locator('#inspector-trim-silence')).toBeChecked()

  // It is workspace state, so it is still there — and still settable — next time the
  // dialog opens, and a cue added after it is turned off is born without the trim.
  await openSettingsOn('Audio')
  await expect(page.locator('#settings-auto-trim')).toBeChecked()
  await page.locator('#settings-auto-trim').setChecked(false)
  await closeSettings()

  await toolbarCueBtn(page, 'Audio').click()
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  await expect(page.locator('#inspector-trim-silence')).not.toBeChecked()
})

test('the trim applies on a machine with no key', async () => {
  await openShow({ licensed: false })
  await inspect('Reel One')

  // Nothing about this row asks for a key. A machine with no licence gets the same trim
  // as any other, because the trim is the cue's own behaviour rather than an entitlement.
  await expect(page.locator('.license-hint')).toHaveCount(0)
  const trim = page.locator('#inspector-trim-silence')
  await expect(trim).toBeEnabled()
  await expect(trim).toBeChecked()

  // The measurement pass runs here too, and the panel shades what the cue plays.
  await expect(page.locator('.waveform-total')).toHaveText('0:11.0')
  await expect(page.locator('.trim-silence-readout')).toHaveText(TRIMMED)
  await expect(page.locator('.waveform-region-tag')).toHaveText('plays 0:02.0–0:08.0')
})
