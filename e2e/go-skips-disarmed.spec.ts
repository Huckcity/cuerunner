/**
 * A disarmed cue is skipped by GO.
 *
 * The bar above the list says so — "Disarmed — GO skips it" — and so does the guide, but
 * the runner used to return on a disarmed cue without moving: the press fired nothing, the
 * selection stayed where it was, and every press after it landed on the same cue. What is
 * on trial here is both halves of "skipped": after a GO the selection comes to rest on the
 * next cue that can be fired, and a GO pressed while standing on a disarmed cue fires the
 * next armed one instead of nothing.
 */
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { launchApp, closeApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
  // Three waits, each added after the one before it, and the middle one taken out of
  // tonight's show.
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row')).toHaveCount(3)
  await row(1).click()
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.inspector input[type="checkbox"]').uncheck()
  await expect(row(1)).toHaveAttribute('data-armed', 'false')
})

test.afterAll(async () => {
  await closeApp(app)
})

function row(index: number): Locator {
  return page.locator('.cue-row').nth(index)
}

test('after a GO the selection rests on the next armed cue, past the disarmed one', async () => {
  await row(0).click()
  await page.locator('.btn-go').click()

  await expect(row(0)).toHaveAttribute('data-running', 'true')
  await expect(row(2)).toHaveAttribute('data-selected', 'true')
  await expect(row(1)).toHaveAttribute('data-selected', 'false')
})

test('a GO pressed on a disarmed cue fires the next armed one', async () => {
  // The last press is still inside the repeat guard's window, which is what the window is
  // for; an operator's next press is not.
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /STOP/ }).click()
  await expect(row(0)).toHaveAttribute('data-running', 'false')

  await row(1).click()
  await expect(page.locator('.ctx-disarmed')).toHaveText('Disarmed — GO skips it')
  await page.locator('.btn-go').click()

  await expect(row(2)).toHaveAttribute('data-running', 'true')
  await expect(row(1)).toHaveAttribute('data-running', 'false')
})
