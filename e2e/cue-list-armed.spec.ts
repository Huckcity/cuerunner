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

// The group row is the only row carrying a collapse toggle.
function groupRow(page: Page): Locator {
  return page.locator('.cue-row:has(.group-toggle)')
}

test('a disarmed cue row shows the disarmed marker and a dimmed name', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  const row = page.locator('.cue-row').first()
  await expect(row).toHaveAttribute('data-armed', 'true')
  await expect(row.locator('.disarmed-pill')).toHaveCount(0)

  // The new cue is auto-selected; disarm it from the Basics tab. The dimming is asserted
  // against the rendered colour, not a hard-coded hex value.
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  const readNameColor = () =>
    row.locator('.name-text').evaluate(el => getComputedStyle(el as HTMLElement).color)
  const armedColor = await readNameColor()
  await page.locator('.inspector input[type="checkbox"]').uncheck()

  await expect(row).toHaveAttribute('data-armed', 'false')
  await expect(row.locator('.disarmed-pill')).toHaveText('disarmed')
  expect(await readNameColor()).not.toBe(armedColor)
})

test('re-arming a cue row clears the disarmed marker', async () => {
  await page.locator('.inspector input[type="checkbox"]').check()
  const row = page.locator('.cue-row').first()
  await expect(row).toHaveAttribute('data-armed', 'true')
  await expect(row.locator('.disarmed-pill')).toHaveCount(0)
})

test('a group row is marked the same way when disarmed', async () => {
  // The Wait cue is selected, so the new group lands beside it at the top level.
  await toolbarCueBtn(page, 'Group').click()
  const row = groupRow(page)
  await expect(row).toHaveAttribute('data-armed', 'true')

  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.inspector input[type="checkbox"]').uncheck()

  await expect(row).toHaveAttribute('data-armed', 'false')
  await expect(row.locator('.disarmed-pill')).toHaveText('disarmed')

  // A group with no children has no knowable length.
  await expect(row.locator('.col-dur')).toHaveText('–')

  await page.locator('.inspector input[type="checkbox"]').check()
  await expect(row).toHaveAttribute('data-armed', 'true')
})

test('a timeline group row shows the duration computed from its children', async () => {
  await groupRow(page).click()
  await page.locator('.inspector-tab', { hasText: 'Group' }).click()
  await page.locator('.inspector select').selectOption('timeline')

  // First child: 2000ms at offset 0 (the default 2s Wait duration)
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row[data-depth="1"]')).toHaveCount(1)

  // Second child: 3000ms at offset 5000 → the group ends at 8000ms
  await groupRow(page).click()
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row[data-depth="1"]')).toHaveCount(2)
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await page.locator('.inspector input[type="number"]').fill('3000')
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.field-row', { hasText: 'Timeline offset' }).locator('input').fill('5000')

  await groupRow(page).click()
  await expect(groupRow(page).locator('.col-dur')).toHaveText('8.0s')
})
