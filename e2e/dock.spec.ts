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

test('walking the list changes what the dock shows, never where the list ends', async () => {
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await expect(page.locator('.dock .waveform-panel')).toBeVisible()
  const bottom = await listBottom(page)

  // A sequence group has no waveform; it used to take the waveform's 110px back.
  await page.locator('.cue-row', { hasText: 'Act 1' }).first().click()
  await expect(page.locator('.dock .dock-summary')).toContainText('Act 1')
  expect(await listBottom(page)).toBe(bottom)

  // A timeline group draws its timeline in the same space.
  await page.locator('.cue-row', { hasText: 'Walk-out' }).first().click()
  await expect(page.locator('.dock .timeline-panel')).toBeVisible()
  expect(await listBottom(page)).toBe(bottom)

  // And so does a panel.
  await page.locator('.btn-log').click()
  await expect(page.locator('.dock .log-panel')).toBeVisible()
  expect(await listBottom(page)).toBe(bottom)
})

test('the dock folds away to its tabs and gives the list the room', async () => {
  const bottom = await listBottom(page)
  await page.locator('.dock-collapse').click()
  await expect(page.locator('.dock')).toHaveAttribute('data-collapsed', 'true')
  expect(await listBottom(page)).toBeGreaterThan(bottom + 100)

  await page.locator('.btn-cue').click()
  await expect(page.locator('.dock')).toHaveAttribute('data-collapsed', 'false')
  expect(await listBottom(page)).toBe(bottom)
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
  expect(Math.round(after!.height - before!.height)).toBe(80)
})

test('the transport carries the show and nothing else', async () => {
  await expect(page.locator('.transport-bar .btn-log')).toHaveCount(0)
  await expect(page.locator('.dock .btn-log')).toBeVisible()
})
