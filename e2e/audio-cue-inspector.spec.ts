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
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()

  await expect(page.locator('.inspector')).not.toContainText('Fade out')
  await expect(page.locator('.field-row').filter({ hasText: 'Fade in' })).toBeVisible()
  await expect(page.locator('.inspector')).toContainText('0 = play once, -1 = forever')

  // The loop hint sits under its field rather than beside it: sharing the row squeezed
  // the input to a couple of characters once the reset arrow joined the row too.
  const fadeIn = await page.locator('.field-row').filter({ hasText: 'Fade in' }).locator('input').boundingBox()
  const loop = await page.locator('.field-row').filter({ hasText: 'Loop count' }).locator('input').boundingBox()
  expect(loop!.width).toBeGreaterThan(fadeIn!.width - 2)

  // And directly under it: the vamp button used to come between the field and the line
  // that explains it, so "0 = play once, -1 = forever" read as a note about the button.
  const hint = await page.locator('.inspector-hint', { hasText: '0 = play once' }).boundingBox()
  const vamp = await page.locator('.vamp-toggle').boundingBox()
  expect(hint!.y).toBeGreaterThan(loop!.y)
  expect(hint!.y).toBeLessThan(vamp!.y)
})
