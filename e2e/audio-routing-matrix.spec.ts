// An audio cue's routing: automatic by default, a matrix of file channel → device
// channel crosspoints when asked for, and silent only when it is meant to be. The
// matrix belongs to the cue, so it survives the cue being deselected and re-selected.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

async function addAudioCue(): Promise<void> {
  await toolbarCueBtn(page, 'Audio').click()
  await page.locator('.inspector-tab', { hasText: 'Audio' }).click()
}

test('an audio cue routes automatically until the matrix is asked for', async () => {
  await addAudioCue()

  const routing = page.locator('#routing-mode')
  await expect(routing).toHaveValue('automatic')
  await expect(page.locator('.routing-row')).toHaveCount(0)
  await expect(page.locator('.inspector')).toContainText('play in order')

  await routing.selectOption('matrix')
  // The seed is the file's channels onto the device's: at least one row, whatever the
  // machine's device reports.
  const rows = page.locator('.routing-row')
  const seeded = await rows.count()
  expect(seeded).toBeGreaterThan(0)

  await page.getByRole('button', { name: '+ Add crosspoint' }).click()
  await expect(rows).toHaveCount(seeded + 1)

  await page.getByRole('button', { name: `Remove crosspoint ${seeded + 1}` }).click()
  await expect(rows).toHaveCount(seeded)
})

test('a crosspoint carries a gain and both channels', async () => {
  await addAudioCue()
  await page.locator('#routing-mode').selectOption('matrix')

  const row = page.locator('.routing-row').first()
  await expect(row.locator('select').first()).toHaveValue('0')
  await expect(row.locator('select').nth(1)).toHaveValue('0')

  await row.locator('select').nth(1).selectOption('1')
  await row.locator('input[type=range]').fill('0.5')

  await expect(row.locator('.inspector-readout')).toHaveText('50%')
})

test('the matrix is the cue’s own data, so reselecting the cue restores it', async () => {
  await addAudioCue()
  await page.locator('#routing-mode').selectOption('matrix')
  await page.getByRole('button', { name: '+ Add crosspoint' }).click()
  await page.locator('.routing-row').first().locator('input[type=range]').fill('0.5')

  // Another cue takes the inspector; the audio cue is then selected again.
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: 'Audio' }).click()

  await expect(page.locator('#routing-mode')).toHaveValue('matrix')
  await expect(page.locator('.routing-row')).toHaveCount(3)
  await expect(page.locator('.routing-row').first().locator('input[type=range]')).toHaveValue('0.5')
})

test('silent is a mode of its own, and switching back to automatic really is automatic', async () => {
  await addAudioCue()

  await page.locator('#routing-mode').selectOption('silent')
  await expect(page.locator('.routing-row')).toHaveCount(0)
  await expect(page.locator('.inspector')).toContainText('Deliberately silent')

  await page.locator('#routing-mode').selectOption('automatic')
  await expect(page.locator('.inspector')).toContainText('play in order')
  await expect(page.locator('.inspector')).not.toContainText('Deliberately silent')
})
