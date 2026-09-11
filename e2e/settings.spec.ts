import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

async function openSettings(p: Page) {
  await p.locator('.toolbar-brand').click()
  await p.getByRole('button', { name: /Settings/ }).click()
  await expect(p.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}

async function closeSettings(p: Page) {
  const dialog = p.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).not.toBeVisible()
}

test('settings dialog opens via WinsLab file menu', async () => {
  await openSettings(page)
  await closeSettings(page)
})

test('settings dialog has Audio and MIDI tabs', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByRole('button', { name: 'Audio', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'MIDI', exact: true })).toBeVisible()
  await closeSettings(page)
})

test('Audio tab reports the live sample rate and base latency', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  const sampleRate = dialog.locator('.field-row', { hasText: 'Sample rate' }).locator('.settings-info')
  const baseLatency = dialog.locator('.field-row', { hasText: 'Base latency' }).locator('.settings-info')
  await expect(sampleRate).toHaveText(/^[\d,]+ Hz$/)
  await expect(baseLatency).toHaveText(/^\d+(\.\d+)? ms$/)
  await closeSettings(page)
})

test('MIDI tab offers a default output port select', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'MIDI', exact: true }).click()
  const row = dialog.locator('.field-row', { hasText: 'Default output' })
  await expect(row.locator('select')).toBeVisible()
  await closeSettings(page)
})

test('the Show tab sets the wireless alarms, and refuses a value that would misfire', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Show', exact: true }).click()

  const quiet = dialog.locator('#settings-rf-gone')
  await expect(quiet).toHaveValue('6')

  // Six seconds is the default; a show whose packs are switched off between scenes wants
  // a longer window, and that is a setting rather than an edit to the workspace file.
  await quiet.fill('30')
  await quiet.blur()
  await expect(quiet).toHaveValue('30')

  // Zero would alarm on every poll. An out-of-range value is dropped, not written.
  await quiet.fill('0')
  await quiet.blur()
  await expect(quiet).toHaveValue('30')

  await dialog.locator('#settings-rf-battery-critical').fill('15')
  await dialog.locator('#settings-rf-battery-critical').blur()
  await expect(dialog.locator('#settings-rf-battery-critical')).toHaveValue('15')

  await closeSettings(page)
  // It is workspace state, not dialog state, so it is still there next time.
  await openSettings(page)
  await page.getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Show', exact: true }).click()
  await expect(page.locator('#settings-rf-gone')).toHaveValue('30')
  await closeSettings(page)
})

test('settings dialog closes with Escape key', async () => {
  await openSettings(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings' })).not.toBeVisible()
})

test('settings dialog opens via Ctrl+, keyboard shortcut', async () => {
  await page.keyboard.press('Control+,')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await closeSettings(page)
})
