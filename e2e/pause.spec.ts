// Pause, heard: the engine's real output is captured, and a held show is silence that picks up
// where it stopped. P and the transport's PAUSE hold the whole show; the Active tab holds one
// cue; a remote's /pause does what P does.
import { test, expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { capturedOutputPeak, closeApp, launchApp, oscPortOfItsOwn, sendOsc } from './helpers'

let app: ElectronApplication | undefined
let page: Page
let root: string

/** Twenty seconds of steady tone, so a gap in it is the show's doing. */
function writeWav(filePath: string, seconds = 20): void {
  const sampleRate = 48000
  const frames = sampleRate * seconds
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 20) * 8000), 44 + i * 2)
  fs.writeFileSync(filePath, buffer)
}

async function openShow(testInfo: TestInfo): Promise<string> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-parity-sweep-pause-'))
  const media = path.join(root, 'bed.wav')
  writeWav(media)
  const showPath = path.join(root, 'Pause.cuerunner')
  const cue = (id: string, number: string, name: string): unknown => ({
    id, number, name, type: 'audio',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
    duration: 0, advance: 'none', isArmed: true, notes: '',
    filePath: media, startTime: 0, endTime: null, fadeInDuration: 0,
    volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
  })
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1, id: 'w-pause', name: 'Pause', createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' }, midiSettings: { outputPortName: '' },
    cues: [cue('a1', '1', 'Bed'), cue('a2', '2', 'Other')]
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  const capturePath = testInfo.outputPath('engine-output.wav')
  ;({ app, page } = await launchApp({ userDataDir, env: { CUERUNNER_TEST_AUDIO_CAPTURE: capturePath } }))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Pause.cuerunner' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Bed' }).locator('.col-dur')).toHaveText('20.0s')
  return capturePath
}

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

const bed = () => page.locator('.cue-row', { hasText: 'Bed' })

test('P holds the whole show in silence and lets it go on from where it stood', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const capturePath = await openShow(testInfo)
  await bed().click()
  await page.keyboard.press('Space')
  await expect(bed()).toHaveAttribute('data-running', 'true')
  await expect.poll(() => capturedOutputPeak(capturePath, 200), { timeout: 8000 }).toBeGreaterThan(0.05)

  await page.keyboard.press('KeyP')
  await expect(bed()).toHaveAttribute('data-state', 'paused')
  await expect(page.locator('.btn-pause')).toHaveText('RESUME')
  await expect(page.locator('.running-badge')).toHaveText('1 paused')
  // Held: the engine's output is silence, and stays it.
  await expect.poll(() => capturedOutputPeak(capturePath, 300), { timeout: 5000 }).toBe(0)
  await page.waitForTimeout(800)
  expect(capturedOutputPeak(capturePath, 600)).toBe(0)

  // GO waits for the resume, and the log says why.
  await page.keyboard.press('Space')
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('the show is paused')
  await expect(page.locator('.cue-row', { hasText: 'Other' })).toHaveAttribute('data-running', 'false')

  await page.locator('.btn-pause').click()
  await expect(bed()).toHaveAttribute('data-state', 'playing')
  await expect(page.locator('.btn-pause')).toHaveText('PAUSE')
  await expect.poll(() => capturedOutputPeak(capturePath, 200), { timeout: 5000 }).toBeGreaterThan(0.05)
})

test('the Active tab holds one cue while the other plays on', async ({}, testInfo) => {
  test.setTimeout(60_000)
  await openShow(testInfo)
  await bed().click()
  await page.keyboard.press('Space')
  await page.waitForTimeout(400)
  await page.keyboard.press('Space')
  await page.locator('.dock-tab.btn-active').click()
  await expect(page.locator('.active-row')).toHaveCount(2)

  const bedRow = page.locator('.active-row', { hasText: 'Bed' })
  await bedRow.locator('.active-pause').click()
  await expect(bedRow).toHaveAttribute('data-state', 'paused')
  await expect(page.locator('.active-row', { hasText: 'Other' })).toHaveAttribute('data-state', 'playing')
  // The transport is not holding the show: one cue is held, not everything.
  await expect(page.locator('.btn-pause')).toHaveText('PAUSE')

  // The row draws once more after the state changes, so read it once two reads agree.
  let time: string | null = null
  await expect.poll(async () => {
    const before = time
    time = await bedRow.locator('.active-time').textContent()
    return time !== null && time === before
  }).toBe(true)
  await page.waitForTimeout(700)
  await expect(bedRow.locator('.active-time')).toHaveText(time ?? '')

  await bedRow.locator('.active-pause').click()
  await expect(bedRow).toHaveAttribute('data-state', 'playing')
  await expect.poll(async () => bedRow.locator('.active-time').textContent()).not.toBe(time)
})

test('a remote’s /pause and /resume hold and release the show as P does', async ({}, testInfo) => {
  test.setTimeout(60_000)
  await openShow(testInfo)
  const port = await oscPortOfItsOwn(page)
  await bed().click()
  await page.keyboard.press('Space')
  await expect(bed()).toHaveAttribute('data-running', 'true')

  await sendOsc(port, '/pause')
  await expect(bed()).toHaveAttribute('data-state', 'paused')
  await sendOsc(port, '/resume')
  await expect(bed()).toHaveAttribute('data-state', 'playing')
})
