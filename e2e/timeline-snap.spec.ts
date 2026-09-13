import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, closeApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

// ── Helpers ────────────────────────────────────────────────────────────────────

async function clearAllCues(p: Page) {
  let count = await p.locator('.cue-row').count()
  while (count > 0) {
    await p.locator('.cue-row').first().click({ button: 'right' })
    await p.locator('.cue-context-menu-item', { hasText: 'Delete' }).click()
    count = await p.locator('.cue-row').count()
  }
}

async function setWaitDuration(p: Page, ms: number) {
  await p.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await p.locator('.field-row').filter({ hasText: 'Duration' }).locator('input').fill(String(ms))
}

async function setTimelineOffset(p: Page, ms: number) {
  await p.locator('.inspector-tab', { hasText: 'Basics' }).click()
  // The field is in seconds, like every other time on the tab.
  await p.locator('.field-row').filter({ hasText: 'Timeline offset' }).locator('input').fill(String(ms / 1000))
}

/** Reads a child's stored offset from the Basics tab — the value snapping writes. */
async function storedOffset(p: Page, childIndex: number): Promise<number> {
  await p.locator('.cue-row[data-depth="1"]').nth(childIndex).click()
  await p.locator('.inspector-tab', { hasText: 'Basics' }).click()
  const value = await p
    .locator('.field-row').filter({ hasText: 'Timeline offset' }).locator('input').inputValue()
  return Math.round(Number(value) * 1000)
}

async function zoomTo(p: Page, pxPerSecond: number) {
  for (let i = 0; i < 10; i++) {
    const label = await p.locator('.tl-zoom-label').textContent()
    if (parseInt(label ?? '0') >= pxPerSecond) return
    await p.locator('.tl-zoom-btn', { hasText: '+' }).click()
  }
  throw new Error(`zoom control never reached ${pxPerSecond}px/s`)
}

/**
 * A timeline group of Wait children, selected so the timeline panel is visible and
 * zoomed to 100 px/s. At that zoom a 2000ms cue is 200px wide and the 8px snap
 * threshold is 80ms.
 */
async function setupTimelineGroup(
  p: Page,
  waits: Array<{ duration: number; offsetMs?: number }>
) {
  await clearAllCues(p)
  await toolbarCueBtn(p, 'Group').click()
  const groupRow = p.locator('.cue-row[data-depth="0"]')
  await groupRow.click()
  await p.locator('.inspector-tab', { hasText: 'Group' }).click()
  await p.locator('.inspector select').selectOption('timeline')

  for (const wait of waits) {
    await toolbarCueBtn(p, 'Wait').click()
    await setWaitDuration(p, wait.duration)
    if (wait.offsetMs) await setTimelineOffset(p, wait.offsetMs)
  }

  await groupRow.click()
  await zoomTo(p, 100)
  return groupRow
}

/** Presses on a block, drags it `dx` px to the right, and holds it there. */
async function dragBlockTo(p: Page, blockIndex: number, dx: number) {
  const box = (await p.locator('.tl-block').nth(blockIndex).boundingBox())!
  const y = box.y + box.height / 2
  await p.mouse.move(box.x + 4, y)
  await p.mouse.down()
  await p.mouse.move(box.x + 4 + dx, y, { steps: 8 })
}

// ── Snap behaviour ─────────────────────────────────────────────────────────────

test('a block dropped near the end of the one before it lands flush against it', async () => {
  await setupTimelineGroup(page, [{ duration: 2000 }, { duration: 2000 }])

  // 1940ms is a 60ms gap — inside the 80ms pull at 100px/s
  await dragBlockTo(page, 1, 194)

  const guide = page.locator('.tl-snap-guide')
  await expect(guide).toBeVisible()
  // the guide is centred on the 2000ms edge the block locked onto
  const tracks = (await page.locator('.tl-tracks-inner').boundingBox())!
  const guideBox = (await guide.boundingBox())!
  expect(Math.round(guideBox.x + guideBox.width / 2 - tracks.x)).toBe(200)

  await page.mouse.up()
  await expect(guide).not.toBeVisible()

  expect(await storedOffset(page, 1)).toBe(2000)
})

test('a block dropped near the start of the one after it snaps to end there', async () => {
  await setupTimelineGroup(page, [
    { duration: 2000 },
    { duration: 1000, offsetMs: 4000 },
  ])

  // block 0 is 2000ms long, so 2030ms leaves its trailing edge 30ms past the
  // 4000ms start of block 1
  await dragBlockTo(page, 0, 203)
  await expect(page.locator('.tl-snap-guide')).toBeVisible()
  await page.mouse.up()

  expect(await storedOffset(page, 0)).toBe(2000)
})

test('a block dropped away from every edge is left where it was put', async () => {
  await setupTimelineGroup(page, [{ duration: 500 }, { duration: 500 }, { duration: 500 }])

  // 1500ms is 1000ms clear of the furthest edge in the group
  await dragBlockTo(page, 2, 150)
  await expect(page.locator('.tl-snap-guide')).not.toBeVisible()
  await page.mouse.up()

  expect(await storedOffset(page, 2)).toBe(1500)
})
