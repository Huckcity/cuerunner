/**
 * The window stays on the app.
 *
 * A file dropped on a page that does not take the drop is, to Chromium, a request to open
 * that file in place of the page. Only the cue list took drops, so a file let go over the
 * inspector — a few pixels from the list, and where the File field is — replaced the whole
 * window with the file: the show gone with the renderer that was drawing it, and a window
 * that could not be closed, because closing asks a page that is no longer there.
 *
 * Both halves are on trial. The page refuses a file dropped where nothing takes it, and the
 * main process refuses to let the window go anywhere else whatever the page does — which is
 * the half asked directly here, because a scripted drop never reaches Chromium's own
 * handling of one.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { closeApp, launchApp, readRecovered, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
  // A show with something in it, so there is something to lose.
  await toolbarCueBtn(page, 'Audio').click()
  await expect(page.locator('.cue-row')).toHaveCount(1)
})

test.afterAll(async () => {
  await closeApp(app)
})

test('a file dropped on the inspector is refused, and adds nothing', async () => {
  const taken = await page.evaluate(() => {
    const inspector = document.querySelector('.inspector')
    if (inspector === null) throw new Error('no inspector on screen')
    const data = new DataTransfer()
    data.items.add(new File(['RIFF'], 'walk-in.wav', { type: 'audio/wav' }))
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })
    inspector.dispatchEvent(over)
    inspector.dispatchEvent(drop)
    // Prevented is refused: the browser's own handling of the drop — opening the file in
    // place of the page — is what a prevented default takes away.
    return { over: over.defaultPrevented, drop: drop.defaultPrevented }
  })

  expect(taken).toEqual({ over: true, drop: true })
  await expect(page.locator('.cue-row')).toHaveCount(1)
})

test('the window cannot be sent to a file in place of the app', async () => {
  const before = page.url()
  const elsewhere = pathToFileURL(path.join(process.cwd(), 'package.json')).href

  // The attempt has an end either way — refused, or carried out — and the window says when:
  // loading stops. That is the artifact to wait on; a fixed pause would pass a slow machine
  // that had not got round to leaving yet.
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const seen = globalThis as unknown as { __navigationAttemptOver?: boolean }
    seen.__navigationAttemptOver = false
    contents.once('did-start-navigation', () => {
      contents.once('did-stop-loading', () => { seen.__navigationAttemptOver = true })
    })
  })

  await page.evaluate(url => { window.location.href = url }, elsewhere)
  await expect
    .poll(
      () => app.evaluate(() => (globalThis as unknown as { __navigationAttemptOver?: boolean }).__navigationAttemptOver),
      { message: 'the navigation attempt should have ended, one way or the other' }
    )
    .toBe(true)

  // The window is asked through its own webContents from here on. Playwright saw a
  // navigation begin and is still waiting for it to finish — it never will, it was refused —
  // so every locator on `page` would wait with it. That is the harness's picture of the
  // page, not the page: this is the last case in the file for that reason.
  const shown = await readRecovered(app, `({
    href: location.href,
    brand: document.querySelector('.toolbar-brand') !== null,
    cues: document.querySelectorAll('.cue-row').length
  })`)
  // Still the app, and the show that was on screen: nothing was reloaded to get back here.
  expect(shown).toEqual({ href: before, brand: true, cues: 1 })
})
