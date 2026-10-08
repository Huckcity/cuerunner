// Basics is what every cue shares and nothing else: triggers have their own tab, a reset
// arrow appears only where the cue has been changed, and a timeline offset only where
// there is a timeline.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, mintLicense, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp({ license: mintLicense() }))
})

test.afterEach(async () => {
  await closeApp(app)
})

test('Basics carries no triggers form, and Triggers counts what the cue answers to', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.inspector .triggers')).toHaveCount(0)

  await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
  await page.locator('#trigger-osc-address').fill('/eos/cue/12/fire')
  await page.locator('.trigger-section[data-kind="osc"] .trigger-add').click()

  await expect(page.locator('.inspector-tab', { hasText: 'Triggers' }).locator('.inspector-tab-count'))
    .toHaveText('1')
})

test('a reset arrow shows only on a field that has been changed', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  const preWait = page.locator('.field-row', { hasText: 'Pre-wait' })
  await expect(preWait.locator('.inspector-reset-btn')).toBeHidden()

  await preWait.locator('input').fill('1.5')
  await expect(preWait.locator('.inspector-reset-btn')).toBeVisible()
  await expect(page.locator('.field-row', { hasText: 'Post-wait' }).locator('.inspector-reset-btn')).toBeHidden()
})

test('the timeline offset is asked for only in a timeline group', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.field-row', { hasText: 'Timeline offset' })).toHaveCount(0)

  await toolbarCueBtn(page, 'Group').click()
  await page.locator('.inspector-tab', { hasText: 'Group' }).click()
  await page.locator('.inspector select').selectOption('timeline')
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row[data-depth="1"]')).toHaveCount(1)

  await expect(page.locator('.field-row', { hasText: 'Timeline offset (s)' })).toBeVisible()
})

test('an audio cue has one thing called Timing', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await expect(page.locator('.inspector-tab')).toHaveText(['Basics', 'Audio', 'Time & Loops', 'Slices', 'Triggers'])
})
