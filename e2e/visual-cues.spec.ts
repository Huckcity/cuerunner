// Video, image and text cues on a video output, read where the audience reads them: the
// output window's own pixels.
//
// The output is a window main opens for the show's output — floating here, on this worker's
// Xvfb — drawing on the GPU path (Chromium's SwiftShader stands in for the GPU a venue
// machine has, switched on for this launch only) and, in its own launch below, on the 2D
// fallback a machine without WebGL gets. What is asserted is the composited frame: the
// video's own colours as it plays, an image over it, the exact mix half way through a
// crossfade, a fade cue taking a picture down — and, for the video, that its sound is an
// engine voice like any audio cue's, which the engine's own record says.
//
// The media are tiny files under e2e/fixtures/visual, made with FFmpeg's test sources:
// red-green.mp4 (64×36, 1 s red then 1 s green, AAC 440 Hz), blue.webm (VP8 + Opus),
// silent.mp4 (yellow, no sound) and magenta.png.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { addCueFromMoreMenu, closeApp, launchApp, openFromRecent, toolbarCueBtn } from './helpers'
import type { PlaybackDevHarness } from '../src/main/safety/devHarness'
import { defaultShowSettings } from '../src/shared/show'
import { createOutput } from '../src/shared/visual'
import type { OutputProbe } from '../src/shared/ipc/output'

declare global {
  interface Window {
    /** The output page's read-only probe (src/renderer/src/output/main.ts). */
    __cuerunnerOutput?: OutputProbe
  }
}

const FIXTURES = path.join(process.cwd(), 'e2e', 'fixtures', 'visual')
const RED_GREEN = path.join(FIXTURES, 'red-green.mp4')
const SILENT = path.join(FIXTURES, 'silent.mp4')
const MAGENTA = path.join(FIXTURES, 'magenta.png')

const BLACK: [number, number, number] = [0, 0, 0]
const RED: [number, number, number] = [255, 0, 0]
const GREEN: [number, number, number] = [0, 255, 0]
const YELLOW: [number, number, number] = [255, 255, 0]
const MAGENTA_RGB: [number, number, number] = [255, 0, 255]

/** Answers the next file dialog with `file`: the dialog is the OS's, and main shows it. */
async function pickNext(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, file)
}

function isOutput(url: string, role: 'output' | 'timer'): boolean {
  return url.includes('output.html') && url.includes(`role=${role}`)
}

/** An output window — or the floating timer — once it is up. */
async function outputWindow(app: ElectronApplication, role: 'output' | 'timer' = 'output'): Promise<Page> {
  await expect.poll(() => app.windows().some(win => isOutput(win.url(), role)), { timeout: 15_000 }).toBe(true)
  const output = app.windows().find(win => isOutput(win.url(), role))!
  if (role === 'output') {
    await expect.poll(() => output.evaluate(() => window.__cuerunnerOutput !== undefined), { timeout: 15_000 }).toBe(true)
  }
  return output
}

/** One pixel of the composed frame, in the output's own pixels. */
function pixel(output: Page, x: number, y: number): Promise<number[]> {
  return output.evaluate(([px, py]) => window.__cuerunnerOutput!.pixel(px, py), [x, y] as const)
}

async function size(output: Page): Promise<{ width: number; height: number }> {
  return output.evaluate(() => window.__cuerunnerOutput!.size())
}

/** The middle of the output's frame. */
async function centre(output: Page): Promise<number[]> {
  const { width, height } = await size(output)
  return pixel(output, Math.floor(width / 2), Math.floor(height / 2))
}

/** The brightest pixel in the middle third of the frame: text, wherever its strokes fall. */
async function brightestInMiddle(output: Page): Promise<number> {
  return output.evaluate(() => {
    const canvas = document.querySelector('canvas.output-canvas') as HTMLCanvasElement
    const probe = document.createElement('canvas')
    const w = Math.floor(canvas.width / 3)
    const h = Math.floor(canvas.height / 3)
    probe.width = w
    probe.height = h
    const context = probe.getContext('2d')!
    context.drawImage(canvas, w, h, w, h, 0, 0, w, h)
    const data = context.getImageData(0, 0, w, h).data
    let brightest = 0
    for (let i = 0; i < data.length; i += 4) brightest = Math.max(brightest, Math.min(data[i], data[i + 1], data[i + 2]))
    return brightest
  })
}

/** Whether a pixel is close to a colour: video is YUV and rounds, so a margin is allowed. */
function near(rgb: number[], target: readonly number[], margin = 60): boolean {
  return target.every((value, i) => Math.abs((rgb[i] ?? -1000) - value) <= margin)
}

/** The dock's Outputs panel, on screen: a second press on its tab would put the cue back. */
async function openOutputsPanel(page: Page): Promise<void> {
  const outputsTab = page.locator('.dock-tab.btn-outputs')
  if ((await outputsTab.getAttribute('aria-selected')) !== 'true') await outputsTab.click()
  await expect(page.locator('.outputs-panel')).toBeVisible()
}

async function addOutput(page: Page): Promise<void> {
  await openOutputsPanel(page)
  await page.locator('.outputs-add').click()
  await expect(page.locator('.output-card')).toHaveCount(1)
}

async function fire(page: Page, row: number): Promise<void> {
  await page.locator('.cue-row').nth(row).click()
  // A press the firing guard could read as the last one bounced.
  await page.waitForTimeout(350)
  await page.locator('.btn-go').click()
}

async function stopEverything(page: Page): Promise<void> {
  await page.locator('.btn-stop').click()
  await expect(page.locator('.cue-row[data-running="true"]')).toHaveCount(0)
}

async function engineCues(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(async () => {
    const harness: PlaybackDevHarness | undefined = globalThis.__cuerunnerDevHarness
    if (!harness) return []
    return (await harness.engineInfo()).activeCues.map(cue => cue.cueId)
  })
}

/** One of the selected cue's fields, by the label the operator reads it under. */
function field(page: Page, label: string) {
  return page.locator('.field-row').filter({ has: page.locator('label', { hasText: label }) })
}

async function tab(page: Page, name: string): Promise<void> {
  await page.locator('.inspector-tab', { hasText: name }).click()
}

async function typeInto(page: Page, label: string, value: string, nth = 0): Promise<void> {
  const input = field(page, label).locator('input').nth(nth)
  await input.fill(value)
  await input.press('Tab')
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
    expect(near(await centre(output), BLACK, 8)).toBe(true)
    await expect(page.locator('.output-card .output-state')).toContainText('GPU')
    // The output's own preview reaches the panel.
    await expect(page.locator('.output-preview img')).toHaveCount(1, { timeout: 10_000 })
  })

  test('plays a video on the output, its picture moving and its sound an engine voice', async () => {
    test.setTimeout(40_000)
    await pickNext(app, RED_GREEN)
    await addCueFromMoreMenu(page, 'Video')
    await tab(page, 'Video')
    await page.locator('.inspector-btn', { hasText: 'Browse' }).click()
    await expect(page.locator('.cue-row').nth(0).locator('.name-text')).toHaveText('red-green')

    await fire(page, 0)
    // The first second of the file is red, the second green: the picture is up, and it moves.
    await expect.poll(async () => near(await centre(output), RED), { timeout: 10_000 }).toBe(true)
    // The sound is the engine's: a voice, like any audio cue's — and the show has no other.
    await expect.poll(async () => (await engineCues(app)).length, { timeout: 5_000 }).toBe(1)
    await expect.poll(async () => near(await centre(output), GREEN), { timeout: 10_000 }).toBe(true)
    // And it goes when the video does, the cue with it.
    await expect.poll(async () => near(await centre(output), BLACK, 8), { timeout: 10_000 }).toBe(true)
    await expect(page.locator('.cue-row').nth(0)).toHaveAttribute('data-running', 'false')
    expect(await engineCues(app)).toEqual([])
  })

  test('pauses a video on the frame it is on, its sound taken away, and resumes it from there', async () => {
    test.setTimeout(40_000)
    await fire(page, 0)
    await expect.poll(async () => near(await centre(output), RED), { timeout: 10_000 }).toBe(true)
    await page.locator('.cue-row').nth(0).click()
    await tab(page, 'Video')
    await page.locator('.visual-pause', { hasText: 'Pause' }).click()
    await expect.poll(async () => (await engineCues(app)).length, { timeout: 5_000 }).toBe(0)
    // Past the second the file turns green at, still red: the picture stood still.
    await page.waitForTimeout(1500)
    expect(near(await centre(output), RED)).toBe(true)
    await expect(page.locator('.cue-row').nth(0)).toHaveAttribute('data-running', 'true')

    await page.locator('.visual-pause', { hasText: 'Resume' }).click()
    await expect.poll(async () => (await engineCues(app)).length, { timeout: 5_000 }).toBe(1)
    await expect.poll(async () => near(await centre(output), GREEN), { timeout: 10_000 }).toBe(true)
    await expect.poll(async () => near(await centre(output), BLACK, 8), { timeout: 10_000 }).toBe(true)
    await expect(page.locator('.cue-row').nth(0)).toHaveAttribute('data-running', 'false')
  })

  test('takes GO from the keyboard while the floating output has the focus', async () => {
    await page.locator('.cue-row').nth(0).click()
    await page.waitForTimeout(350)
    // A key pressed on the output window, through the window's own input path — the one a
    // keyboard drives, and the one Playwright's synthetic keys go round.
    await app.evaluate(({ BrowserWindow }) => {
      const output = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('role=output'))!
      output.focus()
      output.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
      output.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
    })
    await expect.poll(async () => near(await centre(output), RED), { timeout: 10_000 }).toBe(true)
    await stopEverything(page)
  })

  test('plays a video with no sound as a picture alone, and ends with it', async () => {
    test.setTimeout(40_000)
    await pickNext(app, SILENT)
    await addCueFromMoreMenu(page, 'Video')
    await tab(page, 'Video')
    await page.locator('.inspector-btn', { hasText: 'Browse' }).click()
    await expect(page.locator('.cue-row').nth(1).locator('.name-text')).toHaveText('silent')
    await fire(page, 1)
    await expect.poll(async () => near(await centre(output), YELLOW), { timeout: 10_000 }).toBe(true)
    expect(await engineCues(app)).toEqual([])
    await expect.poll(async () => near(await centre(output), BLACK, 8), { timeout: 10_000 }).toBe(true)
    await expect(page.locator('.cue-row').nth(1)).toHaveAttribute('data-running', 'false')
    await expect(page.locator('.cue-row').nth(1)).toHaveAttribute('data-failed', 'false')
  })

  test('puts an image up, sized by its geometry, and moves it while it is up', async () => {
    await pickNext(app, MAGENTA)
    await addCueFromMoreMenu(page, 'Image')
    await tab(page, 'Image')
    await page.locator('.inspector-btn', { hasText: 'Browse' }).click()
    await tab(page, 'Picture')
    await typeInto(page, 'Scale (%)', '50')
    await fire(page, 2)
    await expect.poll(async () => near(await centre(output), MAGENTA_RGB, 8), { timeout: 10_000 }).toBe(true)
    // Half the size: the corner of the output is still black.
    const { width, height } = await size(output)
    expect(near(await pixel(output, Math.floor(width * 0.1), Math.floor(height * 0.1)), BLACK, 8)).toBe(true)
    // An edit while it is up lands on the next frame: full size, and the corner is covered.
    await page.locator('.cue-row').nth(2).click()
    await tab(page, 'Picture')
    await typeInto(page, 'Scale (%)', '100')
    await expect.poll(async () => near(await pixel(output, Math.floor(width * 0.1), Math.floor(height * 0.1)), MAGENTA_RGB, 8), {
      timeout: 5_000
    }).toBe(true)
    // It holds until it is stopped: no display time was given.
    await expect(page.locator('.cue-row').nth(2)).toHaveAttribute('data-running', 'true')
    await stopEverything(page)
    await expect.poll(async () => near(await centre(output), BLACK, 8), { timeout: 5_000 }).toBe(true)
  })

  test('dissolves into a video exactly: the old frame and the new mixed, never a dip through black', async () => {
    test.setTimeout(40_000)
    // The red-green video dissolves in over two seconds from the magenta image under it.
    await page.locator('.cue-row').nth(0).click()
    await tab(page, 'Picture')
    await page.locator('#inspector-crossfade').check()
    await typeInto(page, 'Fade in (s)', '2')

    await fire(page, 2)
    await expect.poll(async () => near(await centre(output), MAGENTA_RGB, 8), { timeout: 10_000 }).toBe(true)
    await fire(page, 0)

    // Magenta (255, 0, 255) to red (255, 0, 0) while the video is in its red second: blue
    // falls as the dissolve goes, and red — which both pictures have — stays where it is.
    // Two layers fading against each other would dip it to three quarters half way through.
    const samples: number[][] = []
    const started = Date.now()
    while (Date.now() - started < 2600) {
      samples.push(await centre(output))
      await page.waitForTimeout(40)
    }
    const midway = samples.filter(rgb => rgb[2] > 40 && rgb[2] < 215 && rgb[1] < 40)
    expect(midway.length, `samples: ${JSON.stringify(samples)}`).toBeGreaterThan(0)
    for (const rgb of midway) expect(rgb[0], `a dip in red at ${JSON.stringify(rgb)}`).toBeGreaterThan(215)
    // Once it has landed the image is down and its cue stopped: the dissolve took it.
    await expect(page.locator('.cue-row').nth(2)).toHaveAttribute('data-running', 'false', { timeout: 5_000 })
    await stopEverything(page)
    await page.locator('.cue-row').nth(0).click()
    await tab(page, 'Picture')
    await page.locator('#inspector-crossfade').uncheck()
    await typeInto(page, 'Fade in (s)', '0')
  })

  test('draws text, and a fade cue takes its opacity down', async () => {
    // A new cue goes after the one selected: the end of the list, so the rows stay put.
    await page.locator('.cue-row').last().click()
    await addCueFromMoreMenu(page, 'Text')
    await tab(page, 'Text')
    await page.locator('#inspector-text-body').fill('CUERUNNER')
    await typeInto(page, 'Size (px)', '200')
    // A fade cue aimed at the text, taking it to nothing over half a second.
    await toolbarCueBtn(page, 'Fade').click()
    await tab(page, 'Fade')
    const target = field(page, 'Target cue').locator('select')
    const textCue = await target.locator('option', { hasText: 'Text Cue' }).getAttribute('value')
    await target.selectOption(textCue ?? '')
    await expect(field(page, 'Property').locator('select')).toHaveValue('opacity')
    await typeInto(page, 'Duration (s)', '0.5')

    await fire(page, 3)
    await expect.poll(() => brightestInMiddle(output), { timeout: 5_000 }).toBeGreaterThan(200)
    await fire(page, 4)
    await expect.poll(() => brightestInMiddle(output), { timeout: 5_000 }).toBeLessThan(10)
    await stopEverything(page)
  })

  test('opens the floating timer, always on top, counting the cue that is playing', async () => {
    test.setTimeout(30_000)
    await openOutputsPanel(page)
    await page.locator('.outputs-timer-window select').selectOption('remaining')
    const timer = await outputWindow(app, 'timer')
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(win => win.webContents.getURL().includes('role=timer') && win.isAlwaysOnTop()))).toBe(true)
    await fire(page, 0)
    await expect.poll(() => timer.locator('.timer-digits').textContent(), { timeout: 10_000 }).toMatch(/−00:0[12]/)
    await stopEverything(page)
  })
})

test.describe('on the 2D fallback', () => {
  test('draws the same picture where the machine gives the output no WebGL', async () => {
    const { app, page } = await launchApp()
    try {
      await addOutput(page)
      const output = await outputWindow(app)
      expect(await output.evaluate(() => window.__cuerunnerOutput!.renderer())).toBe('canvas')
      await pickNext(app, MAGENTA)
      await addCueFromMoreMenu(page, 'Image')
      await tab(page, 'Image')
      await page.locator('.inspector-btn', { hasText: 'Browse' }).click()
      await fire(page, 0)
      await expect.poll(async () => near(await centre(output), MAGENTA_RGB, 8), { timeout: 10_000 }).toBe(true)
      await expect(page.locator('.output-card .output-state')).toContainText('2D fallback')
    } finally {
      await closeApp(app)
    }
  })
})

test.describe('a display that is not there', () => {
  test('opens the output as a window with a banner saying which display it was meant for', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cuerunner-visual-cues-'))
    try {
      mkdirSync('test-results', { recursive: true })
      const userDataDir = mkdtempSync(path.join('test-results', 'userdata-'))
      // This machine once put the output fullscreen on a projector that is not plugged in now.
      writeFileSync(path.join(userDataDir, 'video-outputs.json'), JSON.stringify({
        outputs: { 'out-stage': { displayId: 424242, displayLabel: 'Stage projector', fullscreen: true, bounds: null } },
        timerWindow: { open: false, mode: 'remaining' }
      }))
      const show = path.join(root, 'Projected.cuerunner')
      writeFileSync(show, `${JSON.stringify({
        version: 1,
        id: 'w-visual-missing',
        name: 'Projected',
        createdAt: '2026-10-01T00:00:00.000Z',
        audioSettings: { outputDeviceId: 'default' },
        midiSettings: { outputPortName: '' },
        showSettings: defaultShowSettings(),
        videoOutputs: [createOutput('out-stage', 'Stage')],
        cues: []
      }, null, 2)}\n`)
      const { app, page } = await launchApp({ userDataDir })
      try {
        await openFromRecent(page, userDataDir, show)
        const output = await outputWindow(app)
        await expect(output.locator('.output-banner')).toContainText('Stage projector is not connected')
        await openOutputsPanel(page)
        await expect(page.locator('.output-card .output-missing')).toContainText('Stage projector is not connected')
        await expect(page.locator('.output-card .output-name')).toHaveValue('Stage')
      } finally {
        await closeApp(app)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
