// Round two of the pictures, read where the audience reads them: the output window's own pixels.
//
// Blend modes — every one of the fourteen, over the same backdrop, at three quarters' opacity —
// on the GPU and on the 2D fallback, each pixel held to the formula in src/shared/visualBlend.ts.
// A fade cue moving a picture and a cue's own keyframes carrying it. The next GO taking down what
// is set to go. One output mirroring another, and a mask. And the Camera cue: Chromium's fake
// capture device (switched on for these launches only, by a development build's test switch)
// playing a clip of one colour as if it were a webcam, a device that is not connected said
// across the output, and a network stream — MJPEG and progressive video — served from a port of
// this run's own.
//
// The pictures are written by the spec itself (pictureFiles.ts), so the colours a case reads
// back are the colours in the case.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import type { AddressInfo } from 'net'
import path from 'path'
import { addCueFromMoreMenu, closeApp, launchApp, openFromRecent } from './helpers'
import { writePng, writeSolidPng, writeSolidY4m } from './pictureFiles'
import { defaultShowSettings } from '../src/shared/show'
import { createOutput, defaultGeometry, type VideoOutput } from '../src/shared/visual'
import { BLEND_MODES, blendPixel } from '../src/shared/visualBlend'
import type { OutputProbe } from '../src/shared/ipc/output'

declare global {
  interface Window {
    __cuerunnerOutput?: OutputProbe
  }
}

const RED_GREEN = path.join(process.cwd(), 'e2e', 'fixtures', 'visual', 'red-green.mp4')
/** The same clip cut into an HLS playlist of two one-second segments (FFmpeg, `-f hls`). */
const HLS = path.join(process.cwd(), 'e2e', 'fixtures', 'visual', 'hls')
/** Everything this spec writes, under a directory named for the branch it was written on. */
const ROOT = path.join(process.cwd(), 'test-results', 'visual-2')

const BACKDROP = [200, 100, 50]
const SOURCE = [60, 160, 230]
const RED = [255, 0, 0]
const MAGENTA = [255, 0, 255]
const BLACK = [0, 0, 0]

function near(rgb: readonly number[], target: readonly number[], margin: number): boolean {
  return target.every((value, i) => Math.abs((rgb[i] ?? -1000) - value) <= margin)
}

async function until(check: () => Promise<boolean>, timeoutMs = 10_000, everyMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error(`not seen within ${timeoutMs} ms: ${check.toString()}`)
    await new Promise(resolve => setTimeout(resolve, everyMs))
  }
}

// ─── Shows ────────────────────────────────────────────────────────────────────

const cueBase = {
  colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
  advance: 'none', isArmed: true, notes: ''
}
const pictureBase = { outputId: '', layer: 1, opacity: 1, fadeInDuration: 0, fadeOutDuration: 0, crossfade: false, geometry: defaultGeometry() }

function imageCue(id: string, filePath: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...cueBase, ...pictureBase, id, number: id, name: id, type: 'image', filePath, ...patch }
}

function textCue(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...cueBase, ...pictureBase, id, number: id, name: id, type: 'text', text: id.toUpperCase(), fontFamily: 'IBM Plex Sans',
    fontSize: 60, color: '#ffffff', bold: true, italic: false, position: 'center', ...patch
  }
}

function waitCue(id: string): Record<string, unknown> {
  return { ...cueBase, id, number: id, name: id, type: 'wait', duration: 100 }
}

function output(id: string, name: string, width: number, height: number, patch: Partial<VideoOutput> = {}): VideoOutput {
  return { ...createOutput(id, name), width, height, ...patch }
}

function writeShow(dir: string, name: string, outputs: VideoOutput[], cues: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): string {
  const file = path.join(dir, `${name}.cuerunner`)
  writeFileSync(file, `${JSON.stringify({
    version: 1,
    id: `w-${name}`,
    name,
    createdAt: '2026-10-08T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: defaultShowSettings(),
    videoOutputs: outputs,
    ...extra,
    cues
  }, null, 2)}\n`)
  return file
}

function isOutput(url: string): boolean {
  return url.includes('output.html') && url.includes('role=output')
}

/**
 * Every output window that is up, by the name its title carries. An output that is made again
 * (a mirror chosen, a display found) closes a window and opens another: what is read is the set
 * that has settled, all of them loaded.
 */
async function outputWindows(app: ElectronApplication, count: number): Promise<Map<string, Page>> {
  let windows = new Map<string, Page>()
  await expect.poll(async () => {
    const open = app.windows().filter(win => !win.isClosed() && isOutput(win.url()))
    if (open.length !== count) return false
    const found = new Map<string, Page>()
    for (const win of open) {
      const ready = await win.evaluate(() => window.__cuerunnerOutput !== undefined && document.title.endsWith('— Cuerunner')).catch(() => false)
      if (!ready) return false
      found.set((await win.title()).replace(' — Cuerunner', ''), win)
    }
    windows = found
    return found.size === count
  }, { timeout: 20_000 }).toBe(true)
  return windows
}

function pixel(output: Page, x: number, y: number): Promise<number[]> {
  return output.evaluate(([px, py]) => window.__cuerunnerOutput!.pixel(px, py), [x, y] as const)
}

async function fire(page: Page, row: number): Promise<void> {
  await page.locator('.cue-row').nth(row).click()
  // A press the firing guard could read as the last one bounced.
  await page.waitForTimeout(350)
  await page.locator('.btn-go').click()
}

async function showing(output: Page): Promise<string[]> {
  return output.evaluate(() => window.__cuerunnerOutput!.showing().map(entry => entry.cueId))
}

async function tab(page: Page, name: string): Promise<void> {
  await page.locator('.inspector-tab', { hasText: name }).click()
}

async function openOutputsPanel(page: Page): Promise<void> {
  const outputsTab = page.locator('.dock-tab.btn-outputs')
  if ((await outputsTab.getAttribute('aria-selected')) !== 'true') await outputsTab.click()
  await expect(page.locator('.outputs-panel')).toBeVisible()
}

/** A launch with a show of its own open: the app, its window, and where it keeps its files. */
async function launchShow(
  name: string,
  outputs: VideoOutput[],
  cues: (dir: string) => Array<Record<string, unknown>>,
  options: { env?: Record<string, string>; extra?: Record<string, unknown> } = {}
): Promise<{ app: ElectronApplication; page: Page; dir: string; userDataDir: string }> {
  mkdirSync(ROOT, { recursive: true })
  const dir = mkdtempSync(path.join(ROOT, `${name}-`))
  const list = cues(dir)
  const show = writeShow(dir, name, outputs, list, options.extra)
  const userDataDir = mkdtempSync(path.join(ROOT, 'userdata-'))
  const { app, page } = await launchApp({ userDataDir, args: ['--enable-unsafe-swiftshader'], env: options.env })
  await openFromRecent(page, userDataDir, show)
  await expect(page.locator('.cue-row')).toHaveCount(list.length)
  return { app, page, dir, userDataDir }
}

// ─── Blend modes ──────────────────────────────────────────────────────────────

/** One cell per mode across a strip: a 100-pixel square of the source over the backdrop. */
const CELL = 100
const STRIP = { width: CELL * BLEND_MODES.length, height: CELL }

function blendCues(dir: string): Array<Record<string, unknown>> {
  const backdrop = path.join(dir, 'backdrop.png')
  const source = path.join(dir, 'source.png')
  writeSolidPng(backdrop, BACKDROP, 10)
  writeSolidPng(source, SOURCE, 10)
  // One GO puts them all up: each starts the next as it starts.
  return [
    imageCue('back', backdrop, { advance: 'on-start', geometry: { ...defaultGeometry(), fit: 'stretch' } }),
    ...BLEND_MODES.map((mode, index) => imageCue(`m${index}`, source, {
      advance: index === BLEND_MODES.length - 1 ? 'none' : 'on-start',
      layer: 2,
      opacity: 0.75,
      blendMode: mode,
      // A 10-pixel image at ten times its size, in its own cell of the strip.
      geometry: { ...defaultGeometry(), fit: 'native', scale: 10, x: (index * CELL + CELL / 2 - STRIP.width / 2) / STRIP.width }
    }))
  ]
}

for (const renderer of ['webgl', 'canvas'] as const) {
  test.describe(`blend modes on the ${renderer === 'webgl' ? 'GPU' : '2D fallback'}`, () => {
    test('draws each of the fourteen modes to the formula, at the layer\'s opacity', async () => {
      test.setTimeout(60_000)
      const { app, page } = await launchShow(`blend-${renderer}`, [output('strip', 'Strip', STRIP.width, STRIP.height)], blendCues,
        { env: renderer === 'canvas' ? { CUERUNNER_TEST_OUTPUT_RENDERER: 'canvas' } : {} })
      try {
        const out = (await outputWindows(app, 1)).get('Strip')!
        expect(await out.evaluate(() => window.__cuerunnerOutput!.renderer())).toBe(renderer)
        await fire(page, 0)
        await expect.poll(async () => (await showing(out)).length, { timeout: 10_000 }).toBe(BLEND_MODES.length + 1)
        // The frame after every picture is up.
        await page.waitForTimeout(300)
        const misses: string[] = []
        for (const [index, mode] of BLEND_MODES.entries()) {
          const got = await pixel(out, index * CELL + CELL / 2, CELL / 2)
          const want = blendPixel(mode, BACKDROP, SOURCE, 0.75).map(Math.round)
          if (!near(got, want, 4)) misses.push(`${mode}: got ${got.slice(0, 3).join(',')} want ${want.join(',')}`)
        }
        expect(misses).toEqual([])
      } finally {
        await closeApp(app)
      }
    })
  })
}

// ─── Masks and mirrors ────────────────────────────────────────────────────────

for (const renderer of ['webgl', 'canvas'] as const) {
  test(`masks an output's pictures by an image on the ${renderer === 'webgl' ? 'GPU' : '2D fallback'}, and mirrors them on another output`, async () => {
    test.setTimeout(60_000)
    const { app, page, dir } = await launchShow(`mask-${renderer}`, [], scratch => {
      const magenta = path.join(scratch, 'magenta.png')
      writeSolidPng(magenta, MAGENTA)
      return [imageCue('wash', magenta, { geometry: { ...defaultGeometry(), fit: 'stretch' } })]
    }, { env: renderer === 'canvas' ? { CUERUNNER_TEST_OUTPUT_RENDERER: 'canvas' } : {} })
    try {
      // The outputs are set up as an operator does: the mask chosen with its dialog, the mirror
      // picked from the list.
      const mask = path.join(dir, 'half.png')
      writePng(mask, 20, 10, x => (x < 10 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
      await openOutputsPanel(page)
      await page.locator('.outputs-add').click()
      await page.locator('.outputs-add').click()
      await expect(page.locator('.output-card')).toHaveCount(2)
      await page.locator('.output-card').nth(0).locator('.output-name').fill('Stage')
      await page.locator('.output-card').nth(0).locator('.output-name').press('Tab')
      await page.locator('.output-card').nth(1).locator('.output-name').fill('Desk')
      await page.locator('.output-card').nth(1).locator('.output-name').press('Tab')
      await app.evaluate(async ({ dialog }, picked) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
      }, mask)
      await page.locator('.output-card').nth(0).locator('.output-mask-browse').click()
      await expect(page.locator('.output-card').nth(0).locator('.output-mask-file')).toHaveValue('half.png')
      await page.locator('.output-card').nth(1).locator('.output-mirror').selectOption({ label: 'The same as Stage' })
      const windows = await outputWindows(app, 2)
      const stage = windows.get('Stage')!
      const desk = windows.get('Desk')!
      const size = await stage.evaluate(() => window.__cuerunnerOutput!.size())
      // A mirror composes at its source's size: the two are one picture.
      expect(await desk.evaluate(() => window.__cuerunnerOutput!.size())).toEqual(size)

      await fire(page, 0)
      const left = { x: Math.floor(size.width * 0.25), y: Math.floor(size.height / 2) }
      const right = { x: Math.floor(size.width * 0.75), y: Math.floor(size.height / 2) }
      await until(async () => near(await pixel(stage, left.x, left.y), MAGENTA, 6))
      expect(near(await pixel(stage, right.x, right.y), BLACK, 6)).toBe(true)
      // The mirror shows the same pictures, and the source's mask with them.
      await until(async () => near(await pixel(desk, left.x, left.y), MAGENTA, 6))
      expect(near(await pixel(desk, right.x, right.y), BLACK, 6)).toBe(true)
      // Inverted, the other half shows.
      await page.locator('.output-card').nth(0).locator('.output-mask-invert').check()
      await until(async () => near(await pixel(stage, right.x, right.y), MAGENTA, 6) && near(await pixel(stage, left.x, left.y), BLACK, 6))
      // Its status names what it shows; a stop takes the picture off both.
      await expect(page.locator('.output-card').nth(1).locator('.output-showing')).toContainText('wash')
      await page.locator('.btn-stop').click()
      await until(async () => near(await pixel(desk, right.x, right.y), BLACK, 6) && near(await pixel(stage, right.x, right.y), BLACK, 6))
    } finally {
      await closeApp(app)
    }
  })
}

// ─── Geometry over time ───────────────────────────────────────────────────────

test('carries a picture along its keyframes, and a fade cue moves it from wherever it is', async () => {
  test.setTimeout(60_000)
  const width = 400
  const height = 200
  const { app, page } = await launchShow('motion', [output('stage', 'Stage', width, height)], dir => {
    const red = path.join(dir, 'red.png')
    writeSolidPng(red, RED, 10)
    return [
      imageCue('travel', red, {
        // 40 pixels square, from the left of the output to the right over 600 ms of its own play.
        geometry: { ...defaultGeometry(), fit: 'native', scale: 4, x: -0.4 },
        keyframes: [{ atMs: 600, x: 0.4, y: 0, scale: 4, rotation: 0, crop: { top: 0, right: 0, bottom: 0, left: 0 }, easing: 'ease-in-out' }]
      }),
      { ...cueBase, id: 'lift', number: 'lift', name: 'lift', type: 'fade', duration: 300, targetCueId: 'travel', fadeProperty: 'geometry',
        targetValue: 0, geometryTarget: { y: -0.3 }, curve: 'linear', stopTargetWhenDone: false }
    ]
  })
  try {
    const stage = (await outputWindows(app, 1)).get('Stage')!
    await fire(page, 0)
    await until(async () => near(await pixel(stage, 40, 100), RED, 6) || near(await pixel(stage, 360, 100), RED, 6))
    // It lands on its last keyframe and stays there.
    await expect.poll(() => stage.evaluate(() => window.__cuerunnerOutput!.geometry('travel')?.x), { timeout: 5_000 }).toBeCloseTo(0.4, 3)
    await until(async () => near(await pixel(stage, 360, 100), RED, 6))
    expect(near(await pixel(stage, 40, 100), BLACK, 6)).toBe(true)

    // The fade cue lifts it from where it is now — on the right — not from where it began.
    await fire(page, 1)
    await until(async () => near(await pixel(stage, 360, 40), RED, 6))
    expect(near(await pixel(stage, 360, 100), BLACK, 6)).toBe(true)
    await expect.poll(() => stage.evaluate(() => window.__cuerunnerOutput!.geometry('travel')?.y), { timeout: 5_000 }).toBeCloseTo(-0.3, 3)
    expect(await stage.evaluate(() => window.__cuerunnerOutput!.geometry('travel')?.x)).toBeCloseTo(0.4, 3)
  } finally {
    await closeApp(app)
  }
})

test('the Fade cue\'s panel moves a picture\'s geometry, property by property', async () => {
  test.setTimeout(40_000)
  const { app, page } = await launchShow('fade-panel', [output('stage', 'Stage', 400, 200)], dir => {
    const red = path.join(dir, 'red.png')
    writeSolidPng(red, RED, 10)
    return [
      imageCue('still', red, { geometry: { ...defaultGeometry(), fit: 'native', scale: 4 } }),
      { ...cueBase, id: 'move', number: 'move', name: 'move', type: 'fade', duration: 200, targetCueId: 'still', fadeProperty: 'opacity',
        targetValue: 1, curve: 'linear', stopTargetWhenDone: false }
    ]
  })
  try {
    const stage = (await outputWindows(app, 1)).get('Stage')!
    await page.locator('.cue-row').nth(1).click()
    await tab(page, 'Fade')
    await page.locator('.field-row').filter({ has: page.locator('label', { hasText: 'Property' }) }).locator('select').selectOption('geometry')
    await page.locator('#fade-move-position').check()
    const across = page.getByLabel('Move across')
    await across.fill('-40')
    await across.press('Tab')
    await fire(page, 0)
    await until(async () => near(await pixel(stage, 200, 100), RED, 6))
    await fire(page, 1)
    await until(async () => near(await pixel(stage, 40, 100), RED, 6))
    expect(near(await pixel(stage, 200, 100), BLACK, 6)).toBe(true)
  } finally {
    await closeApp(app)
  }
})

// ─── Stop on next GO ──────────────────────────────────────────────────────────

test('takes down on the next GO the pictures set to go, by the cue or by the show, and leaves the rest', async () => {
  test.setTimeout(60_000)
  const { app, page } = await launchShow('next-go', [output('stage', 'Stage', 400, 200)], () => [
    textCue('caption', { stopOnNextGo: true }),
    textCue('title', { position: 'top' }),
    waitCue('w1'),
    textCue('credit', { position: 'bottom' }),
    waitCue('w2')
  ])
  try {
    const stage = (await outputWindows(app, 1)).get('Stage')!
    await fire(page, 0)
    await expect.poll(() => showing(stage)).toEqual(['caption'])
    // The next GO — whatever it fires — takes the caption down; the title it puts up stays.
    await fire(page, 1)
    await expect.poll(() => showing(stage), { timeout: 5_000 }).toEqual(['title'])
    await expect(page.locator('.cue-row').nth(0)).toHaveAttribute('data-running', 'false')
    await fire(page, 2)
    await page.waitForTimeout(400)
    expect(await showing(stage)).toEqual(['title'])

    // The show's default, set in the Outputs panel: now every picture that leaves it goes.
    await openOutputsPanel(page)
    await page.locator('#outputs-stop-on-next-go').check()
    // A cue that says otherwise keeps its own answer.
    await page.locator('.cue-row').nth(3).click()
    await tab(page, 'Picture')
    await page.locator('#inspector-next-go').selectOption('no')
    await fire(page, 3)
    await expect.poll(() => showing(stage), { timeout: 5_000 }).toEqual(['credit'])
    await fire(page, 4)
    await page.waitForTimeout(400)
    expect(await showing(stage)).toEqual(['credit'])
  } finally {
    await closeApp(app)
  }
})

// ─── Camera ───────────────────────────────────────────────────────────────────

test.describe('the Camera cue', () => {
  test('lists this machine\'s capture devices, puts the chosen one live on the output, and remembers it here', async () => {
    test.setTimeout(60_000)
    mkdirSync(ROOT, { recursive: true })
    const clipDir = mkdtempSync(path.join(ROOT, 'camera-'))
    const clip = path.join(clipDir, 'red.y4m')
    // Red, in 4:2:0: what the fake device plays as its picture.
    writeSolidY4m(clip, [81, 90, 240])
    const { app, page, userDataDir } = await launchApp({ args: ['--enable-unsafe-swiftshader'], env: { CUERUNNER_TEST_FAKE_CAMERA: clip } })
    try {
      await openOutputsPanel(page)
      await page.locator('.outputs-add').click()
      const out = [...(await outputWindows(app, 1)).values()][0]
      await addCueFromMoreMenu(page, 'Camera')
      await tab(page, 'Camera')
      const devices = page.locator('.camera-device option')
      await expect.poll(() => devices.count(), { timeout: 10_000 }).toBeGreaterThan(1)
      const device = (await devices.nth(1).textContent()) ?? ''
      await page.locator('.camera-device').selectOption({ index: 1 })
      // The cue is named after its camera, and this machine keeps its own id for the device.
      await expect(page.locator('.cue-row').nth(0).locator('.name-text')).toHaveText(device)
      await expect.poll(() => {
        try {
          return Object.keys(JSON.parse(readFileSync(path.join(userDataDir, 'camera-devices.json'), 'utf8')).cues).length
        } catch {
          return 0
        }
      }).toBe(1)
      await fire(page, 0)
      const { width, height } = await out.evaluate(() => window.__cuerunnerOutput!.size())
      await until(async () => near(await pixel(out, Math.floor(width / 2), Math.floor(height / 2)), RED, 60), 15_000)
      expect(await out.evaluate(() => window.__cuerunnerOutput!.cameras())).toEqual([expect.objectContaining({ state: 'live' })])
      // It runs until it is stopped, and lets the device go with it.
      await page.waitForTimeout(500)
      await expect(page.locator('.cue-row').nth(0)).toHaveAttribute('data-running', 'true')
      await page.locator('.btn-stop').click()
      await until(async () => near(await pixel(out, Math.floor(width / 2), Math.floor(height / 2)), BLACK, 8))
      expect(await out.evaluate(() => window.__cuerunnerOutput!.cameras())).toEqual([])
    } finally {
      await closeApp(app)
      rmSync(clipDir, { recursive: true, force: true })
    }
  })

  test('says across the output, and in the panel, when the camera a cue names is not connected', async () => {
    test.setTimeout(40_000)
    const { app, page } = await launchShow('camera-missing', [output('stage', 'Stage', 400, 200)], () => [
      { ...cueBase, ...pictureBase, id: 'cam', number: '1', name: 'Studio cam', type: 'camera', source: 'device', deviceName: 'Studio Camera 9', url: '' }
    ], { env: { CUERUNNER_TEST_FAKE_CAMERA: '1' } })
    try {
      const stage = (await outputWindows(app, 1)).get('Stage')!
      await fire(page, 0)
      await expect.poll(() => stage.evaluate(() => window.__cuerunnerOutput!.banner()), { timeout: 10_000 })
        .toContain('Camera Studio Camera 9 is not connected')
      await expect(stage.locator('.output-banner')).toBeVisible()
      // The cue is still running: plug the camera in and it comes up by itself.
      await expect(page.locator('.cue-row').nth(0)).toHaveAttribute('data-running', 'true')
      await openOutputsPanel(page)
      await expect(page.locator('.output-card .output-camera-problem')).toContainText('Studio Camera 9 is not connected')
      await page.locator('.cue-row').nth(0).click()
      await tab(page, 'Camera')
      await expect(page.locator('.camera-device')).toContainText('Studio Camera 9 — not connected')
    } finally {
      await closeApp(app)
    }
  })

  test('shows a network stream through main — MJPEG, progressive video and HLS — and refuses RTSP', async () => {
    test.setTimeout(60_000)
    mkdirSync(ROOT, { recursive: true })
    const frameDir = mkdtempSync(path.join(ROOT, 'stream-'))
    const frame = path.join(frameDir, 'frame.png')
    writeSolidPng(frame, MAGENTA, 16)
    const png = readFileSync(frame)
    const video = readFileSync(RED_GREEN)
    const timers = new Set<ReturnType<typeof setInterval>>()
    const server: Server = createServer((request, response) => {
      if (request.url === '/cam.mjpg') {
        response.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store' })
        const send = (): void => {
          response.write(`--frame\r\nContent-Type: image/png\r\nContent-Length: ${png.length}\r\n\r\n`)
          response.write(png)
          response.write('\r\n')
        }
        send()
        const timer = setInterval(send, 100)
        timers.add(timer)
        request.on('close', () => { clearInterval(timer); timers.delete(timer) })
        return
      }
      if (request.url === '/clip.mp4') {
        response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length })
        response.end(video)
        return
      }
      const hls = /^\/live\/(red-green(?:-\d)?\.(?:m3u8|m2ts))$/.exec(request.url ?? '')
      if (hls !== null) {
        const body = readFileSync(path.join(HLS, hls[1]))
        response.writeHead(200, { 'Content-Type': hls[1].endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Content-Length': body.length })
        response.end(body)
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const { app, page } = await launchShow('camera-stream', [output('stage', 'Stage', 400, 200)], () => [
      { ...cueBase, ...pictureBase, id: 'mjpeg', number: '1', name: 'IP cam', type: 'camera', source: 'url', deviceName: '', url: `http://127.0.0.1:${port}/cam.mjpg`,
        geometry: { ...defaultGeometry(), fit: 'stretch' } },
      { ...cueBase, ...pictureBase, id: 'progressive', number: '2', name: 'Feed', type: 'camera', source: 'url', deviceName: '', url: `http://127.0.0.1:${port}/clip.mp4`,
        geometry: { ...defaultGeometry(), fit: 'stretch' } },
      { ...cueBase, ...pictureBase, id: 'rtsp', number: '3', name: 'RTSP', type: 'camera', source: 'url', deviceName: '', url: 'rtsp://127.0.0.1/stream' },
      // A playlist whose segments are named relative to it: they resolve through main's scheme too.
      { ...cueBase, ...pictureBase, id: 'hls', number: '4', name: 'HLS', type: 'camera', source: 'url', deviceName: '', url: `http://127.0.0.1:${port}/live/red-green.m3u8`,
        geometry: { ...defaultGeometry(), fit: 'stretch' } }
    ])
    try {
      const stage = (await outputWindows(app, 1)).get('Stage')!
      await fire(page, 0)
      await until(async () => near(await pixel(stage, 200, 100), MAGENTA, 8), 15_000)
      await page.locator('.btn-stop').click()
      await until(async () => near(await pixel(stage, 200, 100), BLACK, 8))
      await fire(page, 1)
      await until(async () => near(await pixel(stage, 200, 100), RED, 60) || near(await pixel(stage, 200, 100), [0, 255, 0], 60), 15_000)
      await page.locator('.btn-stop').click()
      // An RTSP address is said, not drawn as black.
      await fire(page, 2)
      await expect(page.locator('.cue-row').nth(2)).toHaveAttribute('data-failed', 'true', { timeout: 5_000 })
      // HLS, which this build's Chromium plays itself.
      await fire(page, 3)
      await until(async () => near(await pixel(stage, 200, 100), RED, 60) || near(await pixel(stage, 200, 100), [0, 255, 0], 60), 15_000)
      expect(await stage.evaluate(() => window.__cuerunnerOutput!.cameras())).toEqual([expect.objectContaining({ cueId: 'hls', state: 'live' })])
    } finally {
      await closeApp(app)
      for (const timer of timers) clearInterval(timer)
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      rmSync(frameDir, { recursive: true, force: true })
    }
  })
})
