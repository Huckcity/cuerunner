// The context bar: what is playing on the left, what GO fires on the right, each with the
// cue's own notes. It answers for GO, so it says the same thing in every view.
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

const next = (page: Page) => page.locator('.context-bar .ctx-next')
const live = (page: Page) => page.locator('.context-bar .ctx-live')

test('the next half follows the selection, and GO moves it on', async () => {
  await page.locator('.cue-row', { hasText: 'House Lights' }).click()
  await expect(next(page).locator('.ctx-number')).toHaveText('9')
  await expect(next(page).locator('.ctx-name')).toHaveText('House Lights')

  await page.getByRole('button', { name: /GO/ }).click()

  await expect(next(page).locator('.ctx-name')).toHaveText('Interval')
})

test('the next half carries the cue’s own note, which is what it is written for', async () => {
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  // The demo's first cue has a note on it; the bar shows its first line.
  await expect(next(page).locator('.ctx-note')).toContainText('Fires on GO')
})

test('a running cue counts down, on the live half and in its Duration cell', async () => {
  // Interval is a 15 s wait: long enough to read a countdown off.
  const row = page.locator('.cue-row', { hasText: 'Interval' })
  await row.click()
  await page.getByRole('button', { name: /GO/ }).click()

  await expect(live(page).locator('.ctx-name')).toHaveText('Interval')
  await expect(live(page).locator('.ctx-clock')).toHaveText(/−0:1[0-4]\.\d$/)
  await expect(row.locator('.col-dur-remaining')).toHaveText(/^−0:1[0-4]\.\d$/)

  // Stopped, the half says so and the cell goes back to how long the cue is.
  await page.getByRole('button', { name: /STOP/ }).click()
  await expect(live(page).locator('.ctx-tag')).toHaveText('Nothing playing')
  await expect(row.locator('.col-dur')).toHaveText('15.0s')
})

test('in the Scenes view the bar still says what GO fires', async () => {
  await page.locator('.cue-row', { hasText: 'Fade Walk-in' }).click()
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await expect(page.locator('.scenes-view')).toBeVisible()

  await expect(next(page).locator('.ctx-name')).toHaveText('Fade Walk-in')
})
