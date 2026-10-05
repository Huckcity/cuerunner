/**
 * A dropped file the engine cannot play is refused out loud, not turned into a cue.
 *
 * A drop on the cue list took `.opus`, `.wma` and raw `.aac` — kinds the engine has no
 * decoder for — and made a cue for each that could never sound, marked "missing" as though
 * the file were gone. The window offers what the engine plays, from one list, and says
 * which of the dropped files it left out and why.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

test('files of a kind the engine has no decoder for add no cue, and are named in the notice', async () => {
  await page.evaluate(() => {
    const list = document.querySelector('.cue-list-container')
    if (list === null) throw new Error('no cue list on screen')
    const data = new DataTransfer()
    data.items.add(new File(['OggS'], 'voice.opus', { type: 'audio/ogg' }))
    data.items.add(new File(['0&'], 'jingle.wma', { type: 'audio/x-ms-wma' }))
    list.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  })

  const notice = page.locator('.app-notice')
  await expect(notice).toContainText('Not added — Cuerunner plays WAV, AIFF, FLAC, MP3, M4A and OGG')
  await expect(notice).toContainText('voice.opus')
  await expect(notice).toContainText('jingle.wma')
  await expect(page.locator('.cue-row')).toHaveCount(0)
  await expect(page.locator('.cue-list-empty')).toBeVisible()
})
