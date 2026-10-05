/**
 * A machine whose audio engine never starts can still run a show, and is told.
 *
 * The engine is a process of its own, and a build whose engine is missing — or was
 * quarantined, or will not launch — used to fail in two silent ways. The show clock stood
 * at zero until an engine gave it a reading, so every wait, pre-wait and advance hung for
 * ever, though none of them needs a device to count. And nothing on screen said the engine
 * was not there: the only sign was a line in a log panel nobody had open.
 *
 * The app is pointed at an engine binary that does not exist, which is the state itself
 * rather than a simulation of it.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp({
    audio: { binPath: path.join(os.tmpdir(), 'cuerunner-no-such-engine') }
  }))
})

test.afterAll(async () => {
  await closeApp(app)
})

test('a wait still counts and completes with no engine to tell it the time', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await page.locator('.field-row').filter({ hasText: 'Duration' }).locator('input').fill('300')
  const row = page.locator('.cue-row').first()
  await row.click()

  await page.getByRole('button', { name: /GO/ }).click()

  await expect(row).toHaveAttribute('data-running', 'true')
  // It ends, which is the whole of the claim: on a clock that never moved it never did.
  await expect(row).toHaveAttribute('data-running', 'false')
  await row.click()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await expect(page.locator('.last-run-badge')).toHaveText('ok')
})

test('the transport says the engine is not answering, and leads to the panel that can restart it', async () => {
  // Past a grace, so an engine that is merely still starting is not announced.
  const badge = page.locator('.audio-status')
  await expect(badge).toHaveText('Audio engine not answering', { timeout: 20_000 })

  await badge.click()

  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('The audio engine is not answering.')
  await expect(dialog.locator('#settings-audio-reconnect')).toBeEnabled()
})
