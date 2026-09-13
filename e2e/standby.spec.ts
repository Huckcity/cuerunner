// The standby line: what GO fires next, and what is already running with the time it
// has left. It answers for GO, so it says the same thing in every view.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, mintLicense } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp({ license: mintLicense() }))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).waitFor()
})

test.afterEach(async () => {
  await closeApp(app)
})

const standby = (page: Page) => page.locator('.standby-bar')

test('standby follows the selection, and GO moves it on', async () => {
  await page.locator('.cue-row', { hasText: 'House Lights' }).click()
  await expect(standby(page).locator('.standby-number')).toHaveText('9')
  await expect(standby(page).locator('.standby-name')).toHaveText('House Lights')

  await page.getByRole('button', { name: /GO/ }).click()

  await expect(standby(page).locator('.standby-name')).toHaveText('Interval')
})

test('a running cue counts down, on the standby line and in its Duration cell', async () => {
  // Interval is a 15 s wait: long enough to read a countdown off.
  const row = page.locator('.cue-row', { hasText: 'Interval' })
  await row.click()
  await page.getByRole('button', { name: /GO/ }).click()

  const run = standby(page).locator('.standby-run', { hasText: 'Interval' })
  await expect(run).toBeVisible()
  await expect(run.locator('.standby-run-remaining')).toHaveText(/^−0:1[0-4]\.\d$/)
  await expect(row.locator('.col-dur-remaining')).toHaveText(/^−0:1[0-4]\.\d$/)

  // Stopped, the cell goes back to saying how long the cue is.
  await page.getByRole('button', { name: /STOP/ }).click()
  await expect(run).toHaveCount(0)
  await expect(row.locator('.col-dur')).toHaveText('15.0s')
})

test('in the Scenes view the line still says what GO fires', async () => {
  await page.locator('.cue-row', { hasText: 'Fade Walk-in' }).click()
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await expect(page.locator('.scenes-view')).toBeVisible()

  await expect(standby(page).locator('.standby-name')).toHaveText('Fade Walk-in')
})
