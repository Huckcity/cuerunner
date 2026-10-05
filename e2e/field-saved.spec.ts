// A field tells you it saved (ROADMAP R3).
//
// A value typed into a field and then left — by clicking away or by pressing Enter — gives
// no sign that anything took: the toolbar's dirty dot is the only save signal in the app,
// and it answers a different question. So the field itself answers: on blur, if what it is
// showing is not what it was showing when it was focused, it flashes once. Nothing when
// nothing changed, and nothing when a value typed away is typed back.
//
// Read off a real field on each side of the app — the inspector's and Settings' — because
// that is where the operator meets it.
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { launchApp, closeApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

/** The flash is a moment, not a state: it goes out on its own. */
async function expectToFlash(field: Locator): Promise<void> {
  await expect(field).toHaveAttribute('data-saved', 'true')
  await expect(field).not.toHaveAttribute('data-saved', 'true')
}

test('an inspector field confirms the value that was typed into it', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()

  const duration = page.locator('.field-row').filter({ hasText: 'Duration' }).locator('input')
  await expect(duration).toHaveValue('2')

  await duration.click()
  await duration.fill('4.5')
  await duration.blur()

  await expect(duration).toHaveValue('4.5')
  await expectToFlash(duration)

  // Typed back to what it was: the field ends saying what it started saying, so there is
  // nothing to confirm.
  await duration.click()
  await duration.fill('2')
  await duration.blur()
  await page.waitForTimeout(300)
  await expect(duration).not.toHaveAttribute('data-saved', 'true')
})

test('a Settings field confirms the value that was typed into it', async () => {
  await page.keyboard.press('Control+,')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Wireless', exact: true }).click()

  const quiet = dialog.locator('#settings-rf-gone')
  await expect(quiet).toHaveValue('6')

  await quiet.click()
  await quiet.fill('30')
  // Settings numbers are written when the field is left rather than as they are typed:
  // binding "3" on the way to "30" would misfire an alarm.
  await expect(dialog.locator('#settings-rf-gone')).toHaveValue('30')
  await quiet.blur()

  await expectToFlash(quiet)

  // The value took, which is the whole point of the flash.
  await dialog.getByRole('button', { name: 'Audio', exact: true }).click()
  await dialog.getByRole('button', { name: 'Wireless', exact: true }).click()
  await expect(dialog.locator('#settings-rf-gone')).toHaveValue('30')

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).not.toBeVisible()
})