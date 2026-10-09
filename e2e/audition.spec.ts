// Audition against the engine's real output: a cue, a selection and a whole file are heard on
// the audition patch only, the show does not move while they play, and Stop ends them. With no
// audition output chosen, audition says so and plays nothing.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { closeApp } from './helpers'
import { audioCue, capturedChannelPeaks, openShow, writeSineWav } from './audioIo'

let app: ElectronApplication | undefined
let page: Page
let root: string

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

const PATCHES = [
  { id: 'mains', name: 'Mains', deviceId: '', channels: [0, 1], gainDb: 0, muted: false },
  { id: 'phones', name: 'Phones', deviceId: '', channels: [2, 3], gainDb: 0, muted: false }
]

function media(testInfo: { outputDir: string }, name: string, seconds: number): string {
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  const file = path.join(testInfo.outputDir, name)
  writeSineWav(file, { seconds, levelDb: -6 })
  return file
}

test('a cue is auditioned on the audition patch without firing the show, and Stop ends it', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const song = media(testInfo, 'song.wav', 30)
  let capturePath: string
  ;({ app, page, root, capturePath } = await openShow(testInfo, 'Audition', {
    audioSettings: { outputPatches: PATCHES, auditionPatchId: 'phones' },
    cues: [audioCue('a1', '1', 'Song', song), audioCue('a2', '2', 'Other', song)]
  }, { CUERUNNER_AUDIO_CHANNELS: '4' }))

  const songRow = page.locator('.cue-row', { hasText: 'Song' })
  await songRow.click()
  await page.locator('.inspector-tab', { hasText: /^Audio$/ }).click()
  await page.locator('.audition-btn', { hasText: 'Audition cue' }).click()

  // Heard on the phones only; the mains are silent and the show has not moved.
  await expect.poll(() => capturedChannelPeaks(capturePath, 200)[2] ?? 0, { timeout: 8000 }).toBeGreaterThan(0.4)
  const peaks = capturedChannelPeaks(capturePath, 200)
  expect(peaks[0]).toBe(0)
  expect(peaks[1]).toBe(0)
  await expect(songRow).toHaveAttribute('data-running', 'false')
  await expect(page.locator('.cue-row[data-running="true"]')).toHaveCount(0)

  await page.locator('.audition-btn', { hasText: 'Stop audition' }).first().click()
  await expect.poll(() => Math.max(...capturedChannelPeaks(capturePath, 150)), { timeout: 5000 }).toBe(0)

  // A selection from the right-click menu, and a whole file, the same way.
  await page.locator('.cue-row', { hasText: 'Other' }).click({ modifiers: ['Shift'] })
  await songRow.click({ button: 'right' })
  await page.locator('.cue-context-menu-item[data-action="audition"]').click()
  await expect.poll(() => capturedChannelPeaks(capturePath, 200)[3] ?? 0, { timeout: 8000 }).toBeGreaterThan(0.4)
  expect(capturedChannelPeaks(capturePath, 200)[0]).toBe(0)
  await songRow.click()
  await page.locator('.inspector-tab', { hasText: /^Audio$/ }).click()
  await page.locator('.audition-btn', { hasText: 'Stop audition' }).first().click()
  await expect.poll(() => Math.max(...capturedChannelPeaks(capturePath, 150)), { timeout: 5000 }).toBe(0)

  await page.locator('.audition-file').click()
  await expect.poll(() => capturedChannelPeaks(capturePath, 200)[2] ?? 0, { timeout: 8000 }).toBeGreaterThan(0.4)

  // PANIC ends an audition with everything else.
  await page.keyboard.press('Shift+Escape')
  await expect.poll(() => Math.max(...capturedChannelPeaks(capturePath, 150)), { timeout: 5000 }).toBe(0)
})

test('with no audition output chosen, audition says so and plays nothing', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const song = media(testInfo, 'song.wav', 5)
  let capturePath: string
  ;({ app, page, root, capturePath } = await openShow(testInfo, 'NoAudition', { cues: [audioCue('a1', '1', 'Song', song)] }))
  await page.locator('.cue-row', { hasText: 'Song' }).click()
  await page.locator('.inspector-tab', { hasText: /^Audio$/ }).click()
  await page.locator('.audition-btn', { hasText: 'Audition cue' }).click()
  await expect(page.locator('.audition-status').first()).toHaveText(/Choose an audition output in Settings → Audio/)
  await page.waitForTimeout(500)
  expect(Math.max(0, ...capturedChannelPeaks(capturePath, 400))).toBe(0)
})
