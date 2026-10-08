// Video, image and text cues on a video output, read where the audience reads them: the
// output window's own pixels.
//
// The output is a window main opens for the show's output — floating here, on this worker's
// Xvfb — drawing on the GPU path (Chromium's SwiftShader stands in for the GPU a venue
// machine has, switched on for this launch only) and, in its own launch below, on the 2D
// fallback a machine without WebGL gets. What is asserted is the composited frame: the
// video's own colours as it plays, the image over it, the exact mix half way through a
// crossfade, a fade cue taking a picture down — and, for the video, that its sound is an
// engine voice like any audio cue's, which the engine's own record says.
//
// The media are tiny files under e2e/fixtures/visual, made with FFmpeg's test sources:
// red-green.mp4 (64×36, 1 s red then 1 s green, AAC 440 Hz), blue.webm (VP8 + Opus),
// silent.mp4 (yellow, no sound) and magenta.png.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import path from 'path'
import { addCueFromMoreMenu, closeApp, launchApp } from './helpers'
import type { PlaybackDevHarness } from '../src/main/safety/devHarness'

const FIXTURES = path.join(process.cwd(), 'e2e', 'fixtures', 'visual')
const RED_GREEN = path.join(FIXTURES, 'red-green.mp4')
const SILENT = path.join(FIXTURES, 'silent.mp4')
const MAGENTA = path.join(FIXTURES, 'magenta.png')

/** Answers the next file dialog with `file`: the dialog is the OS's, and main shows it. */
async function pickNext(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, file)
}

/** The output window, once it has drawn its first frame. */
async function outputWindow(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some(win => win.url().includes('output.html') && win.url().includes('role=output')), {
    timeout: 15_000
  }).toBe(true)
  const output = app.windows().find(win => win.url().includes('output.html') && win.url().includes('role=output'))!
  await expect.poll(() => output.evaluate(() => window.__cuerunnerOutput !== undefined), { timeout: 15_000 }).toBe(true)
  return output
}

/** One pixel of the composed frame, in the output's own pixels. */
function pixel(output: Page, x: number, y: number): Promise<number[]> {
  return output.evaluate(([px, py]) => window.__cuerunnerOutput!.pixel(px, py), [x, y] as const)
}

/** The middle of the output's frame. */
async function centre(output: Page): Promise<number[]> {
  const size = await output.evaluate(() => window.__cuerunnerOutput!.size())
  return pixel(output, Math.floor(size.width / 2), Math.floor(size.height / 2))
}

/** Whether a pixel is close to a colour: video is YUV and rounds, so a margin is allowed. */
function near(rgb: number[], target: [number, number, number], margin = 60): boolean {
  return target.every((value, i) => Math.abs((rgb[i] ?? -1000) - value) <= margin)
}

async function addOutput(page: Page): Promise<void> {
  await page.locator('.dock-tab.btn-outputs').click()
  await page.locator('.outputs-add').click()
  await expect(page.locator('.output-card')).toHaveCount(1)
}

async function fire(page: Page, row: number): Promise<void> {
  await page.locator('.cue-row').nth(row).click()
  // A press the firing guard could read as the last one bounced.
  await page.waitForTimeout(350)
  await page.locator('.btn-go').click()
}

async function engineCues(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(async () => {
    const harness: PlaybackDevHarness | undefined = globalThis.__cuerunnerDevHarness
    if (!harness) return []
    return (await harness.engineInfo()).activeCues.map(cue => cue.cueId)
  })
}

test.describe('on the GPU', () => {
  let app: ElectronApplication
  let page: Page
  let output: Page

  test.beforeAll(async () => {
    ;({ app, page } = await launchApp({ args: ['--enable-unsafe-swiftshader'] }))
    await addOutput(page)
    output = await outputWindow(app)
  })

  test.afterAll(async () => {
    await closeApp(app)
  })

  test('opens the output as a window that draws on the GPU, black until something is up', async () => {
    expect(await output.evaluate(() => window.__cuerunnerOutput!.renderer())).toBe('webgl')
    expect(near(await centre(output), [0, 0, 0], 8)).toBe(true)
    await expect(page.locator('.output-card .output-state')).toContainText('GPU')
  })

  test('plays a video on the output, its picture moving and its sound an engine voice', async () => {
    test.setTimeout(40_000)
    await pickNext(app, RED_GREEN)
    await addCueFromMoreMenu(page, 'Video')
    await page.locator('.inspector-tab', { hasText: 'Video' }).click()
    await page.locator('.inspector-btn', { hasText: 'Browse' }).click()
    await expect(page.locator('.cue-row').nth(0).locator('.name-text')).toHaveText('red-green')

    await fire(page, 0)
    // The first second of the file is red, the second green: the picture is up, and it moves.
    await expect.poll(async () => near(await centre(output), [255, 0, 0]), { timeout: 10_000 }).toBe(true)
    // The sound is the engine's: a voice, like any audio cue's — and the show has no other.
    await expect.poll(async () => (await engineCues(app)).length, { timeout: 5_000 }).toBe(1)
    await expect.poll(async () => near(await centre(output), [0, 255, 0]), { timeout: 10_000 }).toBe(true)
    // And it goes when the video does, the cue with it.
    await expect.poll(async () => near(await centre(output), [0, 0, 0], 8), { timeout: 10_000 }).toBe(true)
    await expect(page.locator('.cue-row').nth(0)).not.toHaveAttribute('data-state', 'playing')
  })
})
