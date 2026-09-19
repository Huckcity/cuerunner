// A save builds its payload before it awaits the disk, so an edit that lands while the
// write is out is not in the bytes. The round trip's witness is what keeps it unsaved:
// the dot stays up and the next save writes it. This spec holds the save's file dialog
// on a promise, changes the show's guard window while the write is out, and watches both
// the file and the dot.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, setGuardWindow, toolbarCueBtn } from './helpers'
import { DEFAULT_TRIGGER_GUARD } from '../src/shared/workspace'

let app: ElectronApplication
let page: Page
let root: string
let showPath: string

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-witness-'))
  showPath = path.join(root, 'Witness.cuerunner')
})

test.afterEach(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

/**
 * Answers the save's file dialog with `showPath`, but not until the test releases it:
 * the write stays in flight for as long as the test needs the window it opens. The
 * resolver clears itself as it fires, so a second hold in one test cannot pass on the
 * first release.
 */
async function holdSaveDialog(): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    const gates = globalThis as unknown as {
      __witnessSaveTarget: string
      __witnessReleaseSave?: () => void
    }
    gates.__witnessSaveTarget = target
    gates.__witnessReleaseSave = undefined
    dialog.showSaveDialog = async () => {
      const gate = Promise.withResolvers<void>()
      gates.__witnessReleaseSave = () => {
        gates.__witnessReleaseSave = undefined
        gate.resolve()
      }
      await gate.promise
      return { canceled: false, filePath: gates.__witnessSaveTarget }
    }
  }, showPath)
}

/** Waits until the save is out and its dialog is being held. */
async function waitForHeldSave(): Promise<void> {
  await expect.poll(
    () => app.evaluate(() => {
      const gates = globalThis as unknown as { __witnessReleaseSave?: () => void }
      return typeof gates.__witnessReleaseSave === 'function'
    }),
    { message: 'the save dialog to be held open' }
  ).toBe(true)
}

/** Lets the held dialog answer, so the write can finish. */
async function releaseSaveDialog(): Promise<void> {
  await waitForHeldSave()
  await app.evaluate(() => {
    const gates = globalThis as unknown as { __witnessReleaseSave?: () => void }
    gates.__witnessReleaseSave?.()
  })
}

/** Save, by the action it performs: "Save" as text also matches "Save As…". */
async function saveFromFileMenu(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save"]').click()
}

function writtenShow(): { triggerGuard?: { windowMs: number }; cues: unknown[] } {
  return JSON.parse(fs.readFileSync(showPath, 'utf-8'))
}

test('an edit that lands while the write is out is reported, and the next save writes it', async () => {
  test.setTimeout(60_000)
  await holdSaveDialog()

  // The first save of a fresh session: the file dialog is the only thing between the
  // payload and the disk.
  await saveFromFileMenu()
  await waitForHeldSave()
  // The write is out and the payload is built; this edit cannot be in it.
  await setGuardWindow(page, 900)

  await releaseSaveDialog()
  // The save answered — the session adopted the file's path — and the witness put the
  // dot back: the file carries the window the payload was built with, not the edit.
  await expect(page.locator('.workspace-name')).toContainText('Witness')
  await expect(page.locator('.workspace-name')).toContainText('●')
  expect(writtenShow().triggerGuard).toEqual(DEFAULT_TRIGGER_GUARD)

  // The next save writes the edit, and only then does the dot clear.
  await saveFromFileMenu()
  await expect(page.locator('.workspace-name')).not.toContainText('●')
  expect(writtenShow().triggerGuard).toEqual({ windowMs: 900 })
})

test('a held round trip nothing changed under leaves the session clean', async () => {
  test.setTimeout(60_000)
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.workspace-name')).toContainText('●')

  await holdSaveDialog()
  await saveFromFileMenu()
  await releaseSaveDialog()

  // Nothing landed while the write was out, so the save's own bookkeeping — the path,
  // the name, the file's history — must not read as an edit.
  await expect(page.locator('.workspace-name')).toContainText('Witness')
  await expect(page.locator('.workspace-name')).not.toContainText('●')
  expect(writtenShow().cues).toHaveLength(1)
})
