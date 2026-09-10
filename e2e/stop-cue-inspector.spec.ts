// The Stop cue gained an inspector tab; these fields are consumed by the engine's
// executeStop, which previously had no way to be configured.
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

test('Stop cue configures its target and fade', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await toolbarCueBtn(page, 'Stop').click()

  await page.locator('.inspector-tab', { hasText: 'Stop' }).click()

  const target = page.locator('.field-row').filter({ hasText: 'Target' }).locator('select')
  const fadeOut = page.locator('.field-row').filter({ hasText: 'Fade out' }).locator('input')
  const fadeDuration = page.locator('.field-row').filter({ hasText: 'Fade duration' }).locator('input')

  await expect(target).toHaveValue('all')
  // The duration is inert until a fade is requested
  await expect(fadeDuration).toBeDisabled()

  await fadeOut.check()
  await expect(fadeDuration).toBeEnabled()
  await fadeDuration.fill('2.5')
  await target.selectOption({ index: 1 })

  // Values survive a tab switch
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.inspector-tab', { hasText: 'Stop' }).click()
  await expect(fadeDuration).toHaveValue('2.5')
  await expect(fadeOut).toBeChecked()
  await expect(target).not.toHaveValue('all')
})

test('Wait for fade is gated by Fade out and survives reselection', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await toolbarCueBtn(page, 'Stop').click()

  await page.locator('.inspector-tab', { hasText: 'Stop' }).click()

  const fadeOut = page.locator('.field-row').filter({ hasText: 'Fade out' }).locator('input')
  const waitForFade = page.locator('.field-row').filter({ hasText: 'Wait for fade' }).locator('input')

  // There is no fade to wait for until one is requested
  await expect(waitForFade).toBeDisabled()

  await fadeOut.check()
  await expect(waitForFade).toBeEnabled()
  await waitForFade.check()
  await expect(waitForFade).toBeChecked()

  // Values survive selecting another cue and coming back
  await page.locator('.cue-row').first().click()
  await page.locator('.cue-row').last().click()
  await page.locator('.inspector-tab', { hasText: 'Stop' }).click()
  await expect(waitForFade).toBeChecked()
})
