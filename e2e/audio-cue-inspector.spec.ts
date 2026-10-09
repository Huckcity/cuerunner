// The Timing tab once dropped the audio Fade out field because it never reached the audio
// graph; it is back now that it does — the engine lands it on the cue's end (see
// audio-fade-out.spec.ts) — and the tab states what the loop count range means.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, openLogPanel, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

test('Audio Timing tab has Fade in and Fade out beside each other and states the loop range', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()

  await expect(page.locator('.field-row').filter({ hasText: 'Fade in' })).toBeVisible()
  await expect(page.locator('.field-row').filter({ hasText: 'Fade out' }).locator('input')).toHaveValue('0')
  await expect(page.locator('.inspector')).toContainText('0 = play once, -1 = forever')

  // The loop hint sits under its field rather than beside it: sharing the row squeezed
  // the input to a couple of characters once the reset arrow joined the row too.
  const fadeIn = await page.locator('.field-row').filter({ hasText: 'Fade in' }).locator('input').boundingBox()
  const loop = await page.locator('.field-row').filter({ hasText: 'Loop count' }).locator('input').boundingBox()
  expect(loop!.width).toBeGreaterThan(fadeIn!.width - 2)

  // And directly under it: the vamp button used to come between the field and the line
  // that explains it, so "0 = play once, -1 = forever" read as a note about the button.
  const hint = await page.locator('.inspector-hint', { hasText: '0 = play once' }).boundingBox()
  const vamp = await page.locator('.vamp-toggle').boundingBox()
  expect(hint!.y).toBeGreaterThan(loop!.y)
  expect(hint!.y).toBeLessThan(vamp!.y)
})

// The toolbar's Audio button makes a cue with no file. Its row read `–` where a length
// goes and a GO on it logged "completed in 0ms": nothing on screen said the cue could not
// make a sound, before the press or after it.
test('an audio cue with no file says so on its row, and says it played nothing when fired', async () => {
  await toolbarCueBtn(page, 'Audio').click()
  const row = page.locator('.cue-row', { hasText: 'Audio Cue' })
  await expect(row.locator('.col-dur-media')).toHaveText('no file')

  await page.locator('.btn-go').click()

  await expect(row.locator('.failed-pill')).toHaveAttribute('title', /no file selected — nothing played/)
  await openLogPanel(page)
  await expect(page.locator('.log-row[data-level="error"]', { hasText: 'no file selected' })).toBeVisible()
  await expect(page.locator('.log-panel')).not.toContainText('completed in 0ms')
})

// A dropped file names its cue; a file picked with Browse did not, so a show built with
// the toolbar was a column of "Audio Cue".
test('a file picked with Browse names a cue nobody has named, and leaves a typed name alone', async () => {
  const walkIn = path.join(process.cwd(), 'resources/demo/walk-in.wav')
  // The file dialog belongs to the OS; it is answered in the main process.
  await app.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, walkIn)

  await toolbarCueBtn(page, 'Audio').click()
  await page.locator('.inspector-tab', { hasText: 'Audio' }).click()
  await page.locator('.inspector-btn', { hasText: 'Browse' }).click()

  const first = page.locator('.cue-row').nth(0)
  await expect(first.locator('.name-text')).toHaveText('walk-in')
  // And the row has the file's length rather than the word for having no file.
  await expect(first.locator('.col-dur-media')).toHaveCount(0)
  await expect(first.locator('.col-dur')).toHaveText('4.0s')

  await toolbarCueBtn(page, 'Audio').click()
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  const name = page.locator('.inspector .field-row', { hasText: 'Name' }).locator('input').first()
  await name.fill('Curtain up')
  await name.press('Enter')
  await page.locator('.inspector-tab', { hasText: 'Audio' }).click()
  await page.locator('.inspector-btn', { hasText: 'Browse' }).click()

  const second = page.locator('.cue-row').nth(1)
  await expect(second.locator('.col-dur')).toHaveText('4.0s')
  await expect(second.locator('.name-text')).toHaveText('Curtain up')
})

// A path reaches the engine as UTF-8, and on Windows the engine's C runtime read it in the
// machine's ANSI code page: any character outside ASCII named a file that was not there.
// That is a show kept under "Théâtre" — and the demo's own audio, which is copied into the
// profile, for anybody whose Windows user name has an accent in it. This runs on every
// lane; the Windows one is where it was broken.
test('a file whose folder and name are not ASCII is read and played like any other', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-Théâtre — séance 音-'))
  const accented = path.join(dir, 'Entrée café.wav')
  fs.copyFileSync(path.join(process.cwd(), 'resources/demo/walk-in.wav'), accented)
  try {
    await app.evaluate(async ({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
    }, accented)

    await toolbarCueBtn(page, 'Audio').click()
    await page.locator('.inspector-tab', { hasText: 'Audio' }).click()
    await page.locator('.inspector-btn', { hasText: 'Browse' }).click()

    const row = page.locator('.cue-row').first()
    await expect(row.locator('.name-text')).toHaveText('Entrée café')
    // Measured by the engine: a file it could not open reads `missing` here, and says why
    // under the file.
    await expect(row.locator('.col-dur')).toHaveText('4.0s')
    await expect(page.locator('.audio-file-fault')).toHaveCount(0)

    // And it plays: the run is the engine's, with its own position, not a cue that failed.
    await row.click()
    await page.locator('.btn-go').click()
    await expect(row).toHaveAttribute('data-state', 'playing')
    await expect(row.locator('.failed-pill')).toHaveCount(0)
    await page.locator('.btn-stop').click()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

