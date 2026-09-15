import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, closeApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
  // Start each file with two Wait cues
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
})

test.afterAll(async () => {
  await closeApp(app)
})

test('right-click opens context menu', async () => {
  await page.locator('.cue-row').first().click({ button: 'right' })
  await expect(page.locator('.cue-context-menu')).toBeVisible()
})

test('clicking outside closes the context menu', async () => {
  await page.locator('.cue-row').first().click({ button: 'right' })
  await expect(page.locator('.cue-context-menu')).toBeVisible()
  // Click somewhere outside the menu
  await page.locator('.cue-list-header').click()
  await expect(page.locator('.cue-context-menu')).not.toBeVisible()
})

test('Escape closes the context menu', async () => {
  await page.locator('.cue-row').first().click({ button: 'right' })
  await expect(page.locator('.cue-context-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cue-context-menu')).not.toBeVisible()
})

test('right-click selects the target cue', async () => {
  const secondRow = page.locator('.cue-row').nth(1)
  await secondRow.click({ button: 'right' })
  await expect(secondRow).toHaveAttribute('data-selected', 'true')
  // Close menu
  await page.keyboard.press('Escape')
})

test('Duplicate creates a copy after the original', async () => {
  const before = await page.locator('.cue-row').count()
  await page.locator('.cue-row').first().click({ button: 'right' })
  await page.locator('.cue-context-menu-item', { hasText: 'Duplicate' }).click()
  await expect(page.locator('.cue-row')).toHaveCount(before + 1)
  await expect(page.locator('.cue-context-menu')).not.toBeVisible()
})

test('Rename enters inline edit mode', async () => {
  await page.locator('.cue-row').first().click({ button: 'right' })
  await page.locator('.cue-context-menu-item', { hasText: 'Rename' }).click()
  await expect(page.locator('.name-edit')).toBeVisible()
  // Press Escape to cancel the edit (blur the input)
  await page.keyboard.press('Escape')
})

test('Delete removes the cue', async () => {
  const before = await page.locator('.cue-row').count()
  await page.locator('.cue-row').first().click({ button: 'right' })
  await page.locator('.cue-context-menu-item', { hasText: 'Delete' }).click()
  await expect(page.locator('.cue-row')).toHaveCount(before - 1)
  await expect(page.locator('.cue-context-menu')).not.toBeVisible()
})

test('Arm/Disarm toggle updates the cue', async () => {
  // First row is currently armed by default
  await page.locator('.cue-row').first().click({ button: 'right' })
  const armBtn = page.locator('.cue-context-menu-item', { hasText: /Arm|Disarm/ })
  const initialLabel = await armBtn.textContent()
  await armBtn.click()
  // Re-open and verify label flipped
  await page.locator('.cue-row').first().click({ button: 'right' })
  const newLabel = await page.locator('.cue-context-menu-item', { hasText: /Arm|Disarm/ }).textContent()
  expect(newLabel?.trim()).not.toBe(initialLabel?.trim())
  await page.keyboard.press('Escape')
})

test('the menu can be worked from the keyboard', async () => {
  // Every item in it is an edit an operator makes mid-run, and on a desk without a mouse
  // none of them was reachable: the menu never took focus, so its own Mod+D hint did not
  // work while it was up either.
  await page.locator('.cue-row').first().click({ button: 'right' })
  await expect(page.locator('.cue-context-menu')).toBeVisible()

  // It opens on the first item, and the arrows walk it.
  await expect(page.locator('.cue-context-menu-item').first()).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.cue-context-menu-item', { hasText: 'Duplicate' })).toBeFocused()

  // Enter arms the cue the keyboard is standing on, exactly as the press would. The menu
  // acts on the selection, and the right-click that opened it did not move the selection —
  // so the row to watch is the one the menu is over. Which way it flips depends on how the
  // earlier tests left it, so the expectation is read from the row rather than assumed.
  const row = page.locator('.cue-row').first()
  const wasArmed = await row.getAttribute('data-armed') === 'true'
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.cue-context-menu-item', { hasText: wasArmed ? 'Disarm' : 'Arm' })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.locator('.cue-context-menu')).not.toBeVisible()
  await expect(row).toHaveAttribute('data-armed', String(!wasArmed))

  // And back where it was.
  await row.click({ button: 'right' })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.cue-context-menu-item', { hasText: wasArmed ? 'Arm' : 'Disarm' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(row).toHaveAttribute('data-armed', String(wasArmed))
})

