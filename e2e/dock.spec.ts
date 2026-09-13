// The bottom of the window is one dock at one height: walking the cue list changes what
// it shows, never where the list ends, and the show's panels are tabs of the same place.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).waitFor()
})

test.afterEach(async () => {
  await closeApp(app)
})

async function listBottom(page: Page): Promise<number> {
  const box = await page.locator('.cue-list-container').boundingBox()
  return Math.round(box!.y + box!.height)
}

/**
 * The geometry the assertions below are about, as one line. A layout failure that only
 * says "513 vs 423" costs a CI round trip to explain; this is what explains it.
 */
async function geometry(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rect = (selector: string): { top: number; bottom: number; height: number } | null => {
      const element = document.querySelector(selector)
      if (element === null) return null
      const box = element.getBoundingClientRect()
      return { top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height) }
    }
    const dock = document.querySelector('.dock')
    const panel = document.querySelector('.dock-body > *')
    return JSON.stringify({
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio,
      dock: rect('.dock'),
      dockStyle: dock?.getAttribute('style') ?? null,
      dockState: { tab: dock?.getAttribute('data-tab'), collapsed: dock?.getAttribute('data-collapsed') },
      body: rect('.dock-body'),
      panel: panel?.className ?? null,
      panelBox: rect('.dock-body > *'),
      main: rect('.app-main'),
      list: rect('.cue-list-container'),
      transport: rect('.transport-bar')
    })
  })
}

/** The list must still end where it did; if it does not, say what the layout was. */
async function expectSameBottom(page: Page, expected: number): Promise<void> {
  const bottom = await listBottom(page)
  if (bottom !== expected) {
    throw new Error(`the cue list ends at ${bottom}, not ${expected}\n${await geometry(page)}`)
  }
}

test('walking the list changes what the dock shows, never where the list ends', async () => {
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await expect(page.locator('.dock .waveform-panel')).toBeVisible()
  const bottom = await listBottom(page)

  // A sequence group has no waveform; it used to take the waveform's 110px back.
  await page.locator('.cue-row', { hasText: 'Act 1' }).first().click()
  await expect(page.locator('.dock .dock-summary')).toContainText('Act 1')
  await expectSameBottom(page, bottom)

  // A timeline group draws its timeline in the same space.
  await page.locator('.cue-row', { hasText: 'Walk-out' }).first().click()
  await expect(page.locator('.dock .timeline-panel')).toBeVisible()
  await expectSameBottom(page, bottom)

  // And so does a panel.
  await page.locator('.btn-log').click()
  await expect(page.locator('.dock .log-panel')).toBeVisible()
  await expectSameBottom(page, bottom)
})

test('a window too short for the list: the list still ends where it did', async () => {
  // The Windows and macOS runners open a window whose content is ~650px tall, and the
  // demo's cue list wants ~420px of that. It used to grow past its container there, be
  // clipped, and then scroll when a cue near the end was selected — the list's own box
  // moved under the operator, and rows past the clip could not be reached at all.
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 620) })
  await expect.poll(async () => Math.round((await page.locator('.app-main').boundingBox())!.height))
    .toBeLessThan(400)

  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  const bottom = await listBottom(page)

  await page.locator('.cue-row').last().click()
  await expectSameBottom(page, bottom)

  // And the list is the height of the space it was given, not of its contents.
  const list = await page.locator('.cue-list-container').boundingBox()
  const main = await page.locator('.app-main').boundingBox()
  expect(Math.round(list!.height)).toBe(Math.round(main!.height))
})

test('the dock folds away to its tabs and gives the list the room', async () => {
  const bottom = await listBottom(page)
  await page.locator('.dock-collapse').click()
  await expect(page.locator('.dock')).toHaveAttribute('data-collapsed', 'true')
  const collapsed = await listBottom(page)
  if (collapsed <= bottom + 100) {
    throw new Error(`folding the dock moved the list's end from ${bottom} to ${collapsed}\n${await geometry(page)}`)
  }

  await page.locator('.btn-cue').click()
  await expect(page.locator('.dock')).toHaveAttribute('data-collapsed', 'false')
  await expectSameBottom(page, bottom)
})

test('the dock is as tall as the operator drags it', async () => {
  const handle = await page.locator('.dock-resize').boundingBox()
  const before = await page.locator('.dock').boundingBox()
  const grip = handle!.y + handle!.height / 2
  await page.mouse.move(handle!.x + 200, grip)
  await page.mouse.down()
  await page.mouse.move(handle!.x + 200, grip - 80, { steps: 5 })
  await page.mouse.up()

  const after = await page.locator('.dock').boundingBox()
  const grew = Math.round(after!.height - before!.height)
  if (grew !== 80) throw new Error(`dragging the dock 80px changed it by ${grew}\n${await geometry(page)}`)
})

test('the dock keeps its 60% of a window that shrinks under it', async () => {
  // Take the dock as tall as the window allows.
  const handle = await page.locator('.dock-resize').boundingBox()
  const grip = handle!.y + handle!.height / 2
  await page.mouse.move(handle!.x + 200, grip)
  await page.mouse.down()
  await page.mouse.move(handle!.x + 200, grip - 400, { steps: 5 })
  await page.mouse.up()
  // Dragged as far up as the window allows: the dock takes the share it is allowed and
  // no more. Asserted against the window it is in rather than a pixel count, because the
  // runners' windows are not all the same height (the macOS and Windows ones are about
  // 120px shorter than the Linux one).
  const innerHeight = await page.evaluate(() => window.innerHeight)
  const allowed = Math.max(110, Math.round(innerHeight * 0.6))
  const tall = Math.round((await page.locator('.dock').boundingBox())!.height)
  if (tall !== allowed) {
    throw new Error(`a dock dragged to the top reached ${tall}, not the ${allowed} this ${innerHeight}px window allows\n${await geometry(page)}`)
  }

  // A window the operator drags smaller: the dock gives the room back rather than
  // sitting on the cue list at a height the window no longer has.
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 560) })
  await expect.poll(async () => Math.round((await page.locator('.dock').boundingBox())!.height))
    .toBeLessThan(tall)

  const fitted = Math.round((await page.locator('.dock').boundingBox())!.height)
  const limit = Math.max(110, Math.round(innerHeight * 0.6))
  if (fitted > limit) throw new Error(`the dock fitted a ${innerHeight}px window at ${fitted}, over ${limit}\n${await geometry(page)}`)

  // And the handle still works there: the dock moves with the pointer from the height it
  // is drawn at, not from the taller one the window is refusing it.
  const grip2 = (await page.locator('.dock-resize').boundingBox())!
  await page.mouse.move(grip2.x + 200, grip2.y + grip2.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip2.x + 200, grip2.y + grip2.height / 2 + 50, { steps: 3 })
  await page.mouse.up()
  const draggedDown = Math.round((await page.locator('.dock').boundingBox())!.height)
  if (draggedDown !== fitted - 50) {
    throw new Error(`dragging the fitted dock down 50px left it at ${draggedDown}, not ${fitted - 50}\n${await geometry(page)}`)
  }
})

test('the transport carries the show and nothing else', async () => {
  await expect(page.locator('.transport-bar .btn-log')).toHaveCount(0)
  await expect(page.locator('.dock .btn-log')).toBeVisible()
})
