// A show on two output devices at once, against the engine's real output: the show's own
// device (the silent backend's, teed to a WAV) and one of the engine's test output devices
// (teed to a WAV of its own beside it). Two patches, one on each; a cue on each plays on its
// device and nowhere else, the mixer meters both, and pulling the test device takes only its
// own cue with it — the other plays on, the window says where the pulled device's patch plays
// now and why, and Settings reconnects it. A show opened on a machine that has not got a
// device its patches name says which patches fell back, and where to.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { closeApp } from './helpers'
import { audioCue, capturedChannelPeaks, openShow, writeSineWav } from './audioIo'
import type { PlaybackDevHarness } from '../src/main/safety/devHarness'
import type { AudioEngineEvent } from '../src/shared/audio'

let app: ElectronApplication | undefined
let page: Page
let root: string

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

/** Where the test device tees what it plays: beside the engine's own tee, named for it. */
const teeOf = (capturePath: string, device: string): string =>
  capturePath.replace(/\.wav$/, `.${device.replace(/[^A-Za-z0-9]/g, '-')}.wav`)

async function engineEvents(): Promise<AudioEngineEvent[]> {
  return app!.evaluate(() => globalThis.__cuerunnerDevHarness?.engineEvents() ?? [])
}

test('two patches on two devices: a cue on each, both metered, and a pulled device takes only its own cue', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const media = path.join(testInfo.outputDir, 'tone.wav')
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  writeSineWav(media, { seconds: 60, levelDb: -6 })
  let capturePath: string
  ;({ app, page, root, capturePath } = await openShow(testInfo, 'TwoDevices', {
    audioSettings: {
      outputPatches: [
        { id: 'mains', name: 'Mains', deviceId: '', channels: [0, 1], gainDb: 0, muted: false },
        { id: 'fold', name: 'Foldback', deviceId: 'test:out-b', channels: [0, 1], gainDb: 0, muted: false }
      ]
    },
    cues: [
      audioCue('a1', '1', 'Walk-in', media, { outputPatchId: 'mains' }),
      audioCue('a2', '2', 'Click track', media, { outputPatchId: 'fold', volume: 0.5 })
    ]
  }, { CUERUNNER_TEST_OUTPUTS: '1', CUERUNNER_AUDIO_CHANNELS: '2' }))
  const device = teeOf(capturePath, 'test:out-b')

  // The patch editor offers the test devices, and the patch is on the one it names.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="settings"]').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.locator('.settings-tab', { hasText: 'Audio' }).click()
  const fold = settings.locator('.patch-entry[data-patch="fold"]')
  await expect(fold.locator('select.patch-device option[value="test:out-a"]')).toHaveCount(1)
  await expect(fold.locator('select.patch-device')).toHaveValue('test:out-b')
  // The device is open and playing as soon as the show is: its first cue starts on a running stream.
  const row = settings.locator('.output-device[data-device="test:out-b"]')
  await expect(row).toHaveAttribute('data-state', 'playing')
  await expect(row.locator('.output-device-state')).toContainText('48,000 Hz')
  await expect(row.locator('.output-device-state')).toContainText(/clock [+−±]\d+\.\d ppm · \d+\.\d ms behind/)
  await expect(fold.locator('.patch-fallback')).toHaveCount(0)
  await settings.getByRole('button', { name: 'Close' }).click()

  // A cue on each device — the second once the first is heard, outside the trigger guard's
  // window that swallows a doubled key.
  await page.locator('.cue-row', { hasText: 'Walk-in' }).click()
  await page.keyboard.press('Space')
  await expect.poll(() => capturedChannelPeaks(capturePath, 200)[0] ?? 0, { timeout: 10_000 }).toBeGreaterThan(0.45)
  await page.waitForTimeout(400)
  await page.locator('.cue-row', { hasText: 'Click track' }).click()
  await page.keyboard.press('Space')

  // The show's device carries the walk-in at its level; the test device the click at half.
  await expect.poll(() => capturedChannelPeaks(device, 200)[0] ?? 0, { timeout: 10_000 }).toBeGreaterThan(0.2)
  expect(capturedChannelPeaks(capturePath, 200)[0]).toBeLessThan(0.55)
  expect(capturedChannelPeaks(device, 200)[0]).toBeLessThan(0.3)

  // The mixer meters both patches, each on its own device.
  await page.locator('.mixer-open').click()
  const mixer = page.getByRole('dialog', { name: 'Mixer' })
  const meter = (id: string) => mixer.locator(`.mixer-strip[data-strip="patch-${id}"] .mixer-meter-bar`).first()
  await expect.poll(async () => meter('mains').evaluate(node => parseFloat((node as HTMLElement).style.height)), { timeout: 5000 })
    .toBeGreaterThan(50)
  await expect.poll(async () => meter('fold').evaluate(node => parseFloat((node as HTMLElement).style.height)), { timeout: 5000 })
    .toBeGreaterThan(30)
  await expect(mixer.locator('.mixer-strip[data-strip="patch-fold"] .mixer-strip-detail')).toHaveText('1–2 · Test output B')
  await mixer.locator('.mixer-close').click()

  // The test device is pulled.
  await app!.evaluate(async () => {
    const harness: PlaybackDevHarness | undefined = globalThis.__cuerunnerDevHarness
    await harness?.simulateOutputLoss('test:out-b')
  })

  // Its cue ends as a lost device's cues do; the walk-in does not.
  await expect.poll(async () => (await engineEvents()).some(event =>
    event.type === 'ended' && event.cueId === 'a2' && event.reason === 'device-lost'), { timeout: 10_000 }).toBe(true)
  expect((await engineEvents()).some(event => event.type === 'ended' && event.cueId === 'a1')).toBe(false)
  expect((await engineEvents()).some(event => event.type === 'panic')).toBe(false)
  // The show's device plays on, and the test device has stopped.
  await page.waitForTimeout(500)
  expect(capturedChannelPeaks(capturePath, 300)[0]).toBeGreaterThan(0.45)
  const pulledAt = fs.statSync(device).size
  await page.waitForTimeout(500)
  expect(fs.statSync(device).size).toBe(pulledAt)

  // The window says where its patch plays now, and why.
  const bar = page.locator('.patch-fallback-bar')
  await expect(bar).toBeVisible({ timeout: 5000 })
  await expect(bar).toContainText(/Foldback plays on outputs 1–2 of .+: Test output B was lost \(.+\)/)

  // Settings shows it lost, and reconnects it.
  await bar.locator('.patch-fallback-settings').click()
  const lost = page.getByRole('dialog', { name: 'Settings' }).locator('.output-device[data-device="test:out-b"]')
  await expect(lost).toHaveAttribute('data-state', 'lost')
  await lost.locator('.output-reconnect').click()
  await expect(lost).toHaveAttribute('data-state', 'playing', { timeout: 10_000 })
  await expect(bar).toHaveCount(0, { timeout: 5000 })
})

test('a show whose patch names a device this machine has not got says which patch fell back, and where to', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const media = path.join(testInfo.outputDir, 'tone.wav')
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  writeSineWav(media, { seconds: 30, levelDb: -6 })
  let capturePath: string
  ;({ app, page, root, capturePath } = await openShow(testInfo, 'Travelled', {
    audioSettings: {
      outputPatches: [
        { id: 'fold', name: 'Foldback', deviceId: 'usb-interface-on-the-other-desk', channels: [2, 3], gainDb: 0, muted: false }
      ]
    },
    cues: [audioCue('a1', '1', 'Monitor mix', media, { outputPatchId: 'fold' })]
  }, { CUERUNNER_TEST_OUTPUTS: '1', CUERUNNER_AUDIO_CHANNELS: '4' }))

  const bar = page.locator('.patch-fallback-bar')
  await expect(bar).toBeVisible({ timeout: 10_000 })
  await expect(bar).toContainText(
    /Foldback plays on outputs 3–4 of .+: usb-interface-on-the-other-desk is not connected to this machine/)

  // And so it does: outputs 3 and 4 of the show's device.
  await page.locator('.cue-row', { hasText: 'Monitor mix' }).click()
  await page.keyboard.press('Space')
  await expect.poll(() => capturedChannelPeaks(capturePath, 200), { timeout: 10_000 })
    .toEqual([0, 0, expect.any(Number), expect.any(Number)])
  await expect.poll(() => capturedChannelPeaks(capturePath, 200)[2], { timeout: 5000 }).toBeGreaterThan(0.4)

  // Settings says it beside the patch, and keeps the device the show names.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="settings"]').click()
  const fold = page.getByRole('dialog', { name: 'Settings' }).locator('.patch-entry[data-patch="fold"]')
  await page.getByRole('dialog', { name: 'Settings' }).locator('.settings-tab', { hasText: 'Audio' }).click()
  await expect(fold.locator('select.patch-device')).toHaveValue('usb-interface-on-the-other-desk')
  await expect(fold.locator('.patch-fallback')).toContainText('usb-interface-on-the-other-desk is not connected to this machine')
})
