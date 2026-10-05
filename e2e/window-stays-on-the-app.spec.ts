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
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

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

  await page.evaluate(url => { window.location.href = url }, elsewhere)
  // A navigation that was going to happen has happened well inside this; one that was
  // refused never will, so there is no artifact to wait on but the window still being here.
  await page.waitForTimeout(500)

  expect(page.url()).toBe(before)
  await expect(page.locator('.toolbar-brand')).toBeVisible()
  // The show is the one that was on screen: nothing was reloaded to get back here.
  await expect(page.locator('.cue-row')).toHaveCount(1)
})
