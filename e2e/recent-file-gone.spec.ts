/**
 * A show that is gone is said to be gone.
 *
 * The Recent list goes on naming a show after it has been moved, renamed or deleted, and
 * picking it answered "that file is not a show … could not be read (ENOENT)" — the wrong
 * fact, with an error code for a sentence. A file that is not there is told apart from one
 * that is there and is not a show.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, openFromRecent } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeAll(async () => {
  ;({ app, page, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

test('a recent show that has been moved away is reported as no longer there', async () => {
  const gone = path.join(os.tmpdir(), `cuerunner-gone-${Date.now()}`, 'Moved Away.cuerunner')

  await openFromRecent(page, userDataDir, gone)

  const notice = page.locator('.app-notice[data-kind="error"]')
  await expect(notice).toContainText('that file is no longer there')
  await expect(notice).toContainText(gone)
  await expect(notice).not.toContainText('is not a show')
  await expect(notice).not.toContainText('ENOENT')
  // Nothing replaced the session it was asked from.
  await expect(page.locator('.workspace-name-text')).toHaveText('Untitled')
})
