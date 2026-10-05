// A file the engine cannot read says so, once.
//
// The engine refuses a file it cannot open with a code — `decode` — and the window
// branches on that code: a file that cannot be read is an answer, and an engine that is
// not there is a question to ask again. The code is set in the preload and read in the
// window, and between the two is the context bridge, which copies a thrown Error by its
// message and nothing else. So the code never arrived: a cue pointed at a file that is
// not audio read "measuring" for as long as the show was open, and the pass that measures
// a show's files asked the engine about it again on every write to the store.
//
// Only a real window has a context bridge — the unit suite's `window.cuerunner` is a mock
// that hands a rejection over untouched — so this is the spec that holds it: the refusal
// is read through the bridge itself, and then off the row an operator would be looking at.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

test.describe('A file the engine cannot read', () => {
  let app: ElectronApplication
  let page: Page
  let dir: string
  /** Named like audio, and not audio: what a renamed download or a truncated copy is. */
  let notAudio: string

  test.beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-unreadable-'))
    notAudio = path.join(dir, 'notes.wav')
    fs.writeFileSync(notAudio, 'these are the notes from the production meeting\n'.repeat(40))
    ;({ app, page } = await launchApp())
  })

  test.afterEach(async () => {
    await closeApp(app)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('the engine’s refusal reaches the window with its code', async () => {
    const caught = await page.evaluate(async filePath => {
      // The page's own bridge, which the spec's tsconfig has no declaration for.
      const { audio } = (window as unknown as {
        cuerunner: { audio: { probe(filePath: string): Promise<unknown> } }
      }).cuerunner
      try {
        await audio.probe(filePath)
        return null
      } catch (thrown) {
        // Whatever arrived, as plain data: the bridge is what is being read here.
        const refusal = thrown as { ok?: unknown; code?: unknown; message?: unknown }
        return { ok: refusal.ok, code: refusal.code, message: refusal.message }
      }
    }, notAudio)

    expect(caught).not.toBeNull()
    expect(caught?.ok).toBe(false)
    expect(caught?.code).toBe('decode')
    expect(String(caught?.message)).toContain('unrecognised media format')
  })

  test('its row stops measuring and says the file could not be read', async () => {
    await toolbarCueBtn(page, 'Audio').click()
    await page.locator('.inspector-tab', { hasText: 'Audio' }).click()

    // The file dialog belongs to the OS; it is answered in the main process, and the
    // pick, the measurement and the row are the app's own.
    await app.evaluate(async ({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
    }, notAudio)
    await page.locator('.inspector-btn', { hasText: 'Browse' }).click()
    await expect(page.locator('.audio-file-name')).toHaveValue('notes.wav')
    // Under the file, in the engine's words: the pick is taken, and the cue says what is
    // wrong with it rather than leaving the operator to find out on GO.
    await expect(page.locator('.audio-file-fault')).toContainText('This file cannot be played')
    await expect(page.locator('.audio-file-fault')).toContainText('unrecognised media format')

    // The cue took its file's name when the file was picked.
    const row = page.locator('.cue-row', { hasText: 'notes' })
    // The settled answer, not the one before it: `measuring` is what the row read for
    // good while the refusal's code was being lost on the way to the window.
    await expect(row.locator('.col-dur-media')).toHaveAttribute('data-media', 'missing')
    await expect(row.locator('.col-dur-media')).toHaveText('missing')

    // An edit that has nothing to do with the file does not put the question back: the
    // answer is the session's, and the row keeps it.
    await toolbarCueBtn(page, 'Wait').click()
    await expect(page.locator('.cue-row', { hasText: 'Wait' })).toBeVisible()
    await expect(row.locator('.col-dur-media')).toHaveAttribute('data-media', 'missing')
  })
})
