// The Timing tab dropped the audio Fade out field (dedicated Fade and Stop cues cover
// it) and now states what the loop count range means.
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

test('Audio Timing tab has no Fade out field and states the loop range', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await page.locator('.inspector-tab', { hasText: 'Timing' }).click()

  await expect(page.locator('.inspector')).not.toContainText('Fade out')
  await expect(page.locator('.field-row').filter({ hasText: 'Fade in' })).toBeVisible()
  await expect(page.locator('.inspector')).toContainText('0 = play once, -1 = forever')
})
