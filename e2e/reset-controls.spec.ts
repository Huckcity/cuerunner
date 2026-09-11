// Every field an inspector can set carries a reset arrow (↻) that puts back what a new
// cue of that type would have. It is inert while the field already holds that value, so
// a live arrow is also the "this cue has been changed here" marker.
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

test('the playback and output sliders reset to their new-cue defaults', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await page.locator('.inspector-tab', { hasText: 'Audio' }).click()

  const rate = page.locator('.field-row').filter({ hasText: 'Rate' })
  const rateReset = rate.locator('.inspector-reset-btn')
  await expect(rateReset).toBeDisabled()

  await rate.locator('input[type=range]').fill('2')
  await expect(rate.locator('.inspector-readout')).toHaveText('2.00x')
  await expect(rateReset).toBeEnabled()

  await rateReset.click()
  await expect(rate.locator('.inspector-readout')).toHaveText('1.00x')
  await expect(rateReset).toBeDisabled()

  const volume = page.locator('.field-row').filter({ hasText: 'Volume' })
  const volumeReset = volume.locator('.inspector-reset-btn')
  await volume.locator('input[type=range]').fill('0.3')
  await expect(volume.locator('.inspector-readout')).toHaveText('30%')
  await volumeReset.click()
  await expect(volume.locator('.inspector-readout')).toHaveText('100%')

  const pan = page.locator('.field-row').filter({ hasText: 'Pan' })
  await pan.locator('input[type=range]').fill('-0.5')
  await expect(pan.locator('.inspector-readout')).toHaveText('L50')
  await pan.locator('.inspector-reset-btn').click()
  await expect(pan.locator('.inspector-readout')).toHaveText('C')
})

test('the Timing tab number fields reset', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await page.locator('.inspector-tab', { hasText: 'Timing' }).click()

  const fadeIn = page.locator('.field-row').filter({ hasText: 'Fade in' })
  await expect(fadeIn.locator('.inspector-reset-btn')).toBeDisabled()

  await fadeIn.locator('input[type=number]').fill('1.5')
  await expect(fadeIn.locator('.inspector-reset-btn')).toBeEnabled()

  await fadeIn.locator('.inspector-reset-btn').click()
  await expect(fadeIn.locator('input[type=number]')).toHaveValue('0')
  await expect(fadeIn.locator('.inspector-reset-btn')).toBeDisabled()
})

test('the Basics tab gets the same arrows, checkboxes included', async () => {
  await toolbarCueBtn(page, 'Audio').click()

  const armed = page.locator('.field-row').filter({ hasText: 'Armed' })
  await expect(armed.locator('.inspector-reset-btn')).toBeDisabled()

  await armed.locator('input[type=checkbox]').uncheck()
  await expect(armed.locator('.inspector-reset-btn')).toBeEnabled()

  await armed.locator('.inspector-reset-btn').click()
  await expect(armed.locator('input[type=checkbox]')).toBeChecked()
  await expect(armed.locator('.inspector-reset-btn')).toBeDisabled()
})
