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

  const target = page.locator('#stop-target-mode')
  const fadeOut = page.locator('.field-row').filter({ hasText: 'Fade out' }).locator('input')
  const fadeDuration = page.locator('.field-row').filter({ hasText: 'Fade duration' }).locator('input')

  await expect(target).toHaveValue('all')
  // The duration is inert until a fade is requested
  await expect(fadeDuration).toBeDisabled()

  await fadeOut.check()
  await expect(fadeDuration).toBeEnabled()
  await fadeDuration.fill('2.5')
  // These cues, and then the one to stop.
  await target.selectOption('cues')
  await page.locator('#stop-target-add').selectOption({ index: 1 })
  await expect(page.locator('.target-row')).toHaveCount(1)

  // Values survive a tab switch
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.inspector-tab', { hasText: 'Stop' }).click()
  await expect(fadeDuration).toHaveValue('2.5')
  await expect(fadeOut).toBeChecked()
  await expect(target).toHaveValue('cues')
  await expect(page.locator('.target-row')).toHaveCount(1)
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

test('a Stop cue whose target was deleted says so, in its tab and when it runs', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await toolbarCueBtn(page, 'Stop').click()
  await page.locator('.inspector-tab', { hasText: 'Stop' }).click()
  await page.locator('#stop-target-mode').selectOption('cues')
  await page.locator('#stop-target-add').selectOption({ index: 1 })

  // The cue it stops is taken out of the show.
  await page.locator('.cue-row').first().click()
  await page.keyboard.press('Delete')
  await expect(page.locator('.cue-row')).toHaveCount(1)

  // The tab must not read this as "All cues", which is a stop-everything nobody asked for and
  // the cue does not do: the target stays in its list, said as gone.
  const stop = page.locator('.cue-row').first()
  await stop.click()
  await page.locator('.inspector-tab', { hasText: 'Stop' }).click()
  await expect(page.locator('#stop-target-mode')).toHaveValue('cues')
  await expect(page.locator('.target-row')).toHaveText(['— not in this show —✕'])

  // And fired, it reports what it reached: nothing.
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(stop.locator('.failed-pill')).toHaveAttribute('title', /the cue it stops is not in the show/)
})

test('a Fade cue is aimed at cues with a level only, and the list names them in full', async () => {
  // An audio cue with a name longer than the twenty characters the list used to cut at.
  await toolbarCueBtn(page, 'Audio').click()
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.field-row').filter({ hasText: 'Name' }).locator('input').fill('Act 2 Scene 3 underscore (long)')
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Fade').click()
  await page.locator('.inspector-tab', { hasText: 'Fade' }).click()

  const options = page.locator('#fade-target-add option')
  // The wait is in the show and not in the list: a fade moves a level, and it has none.
  await expect(options).toHaveText(['— add a cue —', '1 Act 2 Scene 3 underscore (long)'])
})
