/**
 * A length is never written with a sixtieth second.
 *
 * The Duration cell split a length into minutes and seconds and then rounded the seconds
 * on their own, so 59.96 s read "60.0s" and 1:59.97 read "1:60.0". The tenth that is shown
 * is rounded first now, and the minutes are taken from that.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
})

test.afterAll(async () => {
  await closeApp(app)
})

for (const [ms, shown] of [['59960', '1:00.0'], ['119970', '2:00.0'], ['59940', '59.9s']] as const) {
  test(`a wait of ${ms} ms reads ${shown} in the list`, async () => {
    await page.locator('.field-row').filter({ hasText: 'Duration' }).locator('input').fill(ms)
    await expect(page.locator('.cue-row').first().locator('.col-dur')).toHaveText(shown)
  })
}
