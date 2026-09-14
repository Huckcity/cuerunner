// A cue whose file is not at the rig's rate. The engine resamples, so the audio is
// right — but "right" and "stated" are different things, and an operator comparing two
// cues should not have to work out why one was resampled. The demo's own walk-in is
// 44.1 kHz on a 48 kHz engine, so this is the common case, not an exotic one.
//
// The show here is handwritten and opened the way an operator opens one, so the spec
// does not depend on the demo's contents.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let root: string

/** A half-second PCM WAV at the given rate: enough for the engine to measure. */
function writeWav(filePath: string, sampleRate: number): void {
  const frames = Math.round(sampleRate / 2)
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22)
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

function audioCue(id: string, number: string, name: string, filePath: string): unknown {
  return {
    id,
    number,
    name,
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 500,
    advance: 'none',
    isArmed: true,
    notes: '',
    type: 'audio',
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 1
  }
}

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-sample-rates-'))
  const fortyFour = path.join(root, 'acetrack-44k.wav')
  const fortyEight = path.join(root, 'sting-48k.wav')
  writeWav(fortyFour, 44100)
  writeWav(fortyEight, 48000)

  const wlab = path.join(root, 'Rate Show.wlab')
  fs.writeFileSync(
    wlab,
    JSON.stringify({
      version: 1,
      id: 'w-rates',
      name: 'Rate Show',
      createdAt: '2026-01-01T00:00:00.000Z',
      audioSettings: { outputDeviceId: 'default' },
      midiSettings: { outputPortName: '' },
      cues: [
        audioCue('a1', '1', 'Acetrack', fortyFour),
        audioCue('a2', '2', 'Sting', fortyEight)
      ]
    })
  )

  // Its own user-data directory, so the recent list this spec writes cannot leak into
  // the instances the rest of the suite is running.
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([wlab]))
  ;({ app, page } = await launchApp({ userDataDir }))
})

test.afterAll(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

test('a cue at another rate says so on the cue, and only on that cue', async () => {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Rate Show.wlab' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Acetrack' })).toBeVisible()

  // The notice lives on the Audio tab, with the file it describes; the panel opens on
  // Basics, so the spec opens the tab the way the operator would.
  await page.locator('.cue-row', { hasText: 'Acetrack' }).click()
  await page.locator('.inspector-tab', { hasText: 'Audio' }).click()
  await expect(page.locator('.audio-file-name')).toHaveValue('acetrack-44k.wav')
  await expect(page.locator('.audio-file-rate')).toBeVisible()
  await expect(page.locator('.audio-file-rate')).toHaveText('44.1 kHz file — resampled to 48 kHz')

  // The 48 kHz file is at the rig's rate, so there is nothing to say about it. The file
  // row is asserted first, so a panel that fell back to another tab cannot pass this by
  // showing no notice for the wrong reason.
  // The file row is checked first, so a panel that fell back to another tab cannot pass
  // the next assertion by showing no notice for the wrong reason. An input's value is not
  // text: `toHaveValue` is the assertion that reads it.
  await page.locator('.cue-row', { hasText: 'Sting' }).click()
  await page.locator('.inspector-tab', { hasText: 'Audio' }).click()
  await expect(page.locator('.audio-file-name')).toHaveValue('sting-48k.wav')
  await expect(page.locator('.audio-file-rate')).toHaveCount(0)

  // And back: the notice follows the cue, not the panel.
  await page.locator('.cue-row', { hasText: 'Acetrack' }).click()
  await expect(page.locator('.audio-file-rate')).toHaveText('44.1 kHz file — resampled to 48 kHz')
})
