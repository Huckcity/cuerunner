// The demo workspace ships inside the app's resources and copies its audio into the
// user-data folder when it opens. Both halves run in the real app here: the resource is
// resolved from out/main/index.js, and the cue the inspector shows must point at a file
// that exists on disk.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

async function openDemoFromFileMenu(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
}

test('the File menu opens the demo workspace', async () => {
  await openDemoFromFileMenu()

  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
  await expect(page.locator('.cue-row', { hasText: 'Act 1' })).toBeVisible()
  await expect(page.locator('.cue-row', { hasText: 'Count 8' })).toBeVisible()
  await expect(page.locator('.workspace-name-text')).toHaveText('Demo Show')
})

test('the empty cue list offers the demo', async () => {
  await expect(page.locator('.cue-list-empty')).toBeVisible()

  await page.locator('.cue-list-empty-demo').click()

  await expect(page.locator('.cue-list-empty')).toHaveCount(0)
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
})

test('the demo opens clean and does not join the Recent list', async () => {
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  const recentFile = `${userData}/recent.json`
  const readRecents = () => (fs.existsSync(recentFile) ? fs.readFileSync(recentFile, 'utf-8') : '')
  const before = readRecents()

  await openDemoFromFileMenu()
  await expect(page.locator('.cue-row', { hasText: 'Act 1' })).toBeVisible()

  // No path and no edits yet — saving it asks where to put the user's copy.
  await expect(page).toHaveTitle('Demo Show — Cuerunner')
  expect(readRecents()).toBe(before)
})

test('demo audio is copied out of the app and played from there', async () => {
  await openDemoFromFileMenu()

  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await page.locator('.inspector-tab', { hasText: 'Audio' }).click()

  // The field shows the file's name; the whole path rides on it for the tooltip.
  const field = page.locator('.audio-file-name')
  await expect(field).toHaveValue('walk-in.wav')
  const filePath = (await field.getAttribute('data-path')) ?? ''

  expect(filePath).toMatch(/walk-in\.wav$/)
  expect(fs.existsSync(filePath)).toBe(true)

  // Copied into the app's user-data folder rather than played from the bundle.
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  expect(filePath.startsWith(userData)).toBe(true)
})

test('the demo plays straight from the cue list, with no Audio tab ever opened', async () => {
  await openDemoFromFileMenu()

  // Straight from the cue list to GO. Nothing has drawn the cue's Audio inspector, so
  // the media has to have been prepared by the fire path itself — an engine that was
  // never asked to prepare it refuses the start.
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await page.getByRole('button', { name: /GO/ }).click()

  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toHaveAttribute('data-state', 'playing')
  await expect(page.locator('.running-badge')).toHaveText('1 running')
  // The engine's own answer: a voice really is playing, not just a cue marked running.
  // Polled, because a start is scheduled on the engine's clock with a lookahead — the
  // renderer marks the cue running a moment before the engine's voice exists, and a
  // loaded runner makes that gap longer than one read can cover.
  await expect
    .poll(
      async () =>
        app.evaluate(async () => (await globalThis.__cuerunnerDevHarness?.engineInfo())?.activeVoices ?? 0),
      { timeout: 5000, message: 'the engine should have a voice playing' }
    )
    .toBeGreaterThan(0)
})
