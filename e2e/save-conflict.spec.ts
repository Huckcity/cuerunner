// A show lives on a share, and a save replaces whatever is at the path it is given. When
// the bytes on disk are no longer the ones this session opened or last wrote, the operator
// is asked — Overwrite or Abandon — before anything is replaced; Abandon is a save that
// did not happen, so the file keeps the other person's edit and the dot stays up.
//
// The prompt is main's own dialog and belongs to the OS, so it is answered in the main
// process the way the bundle and merge specs answer theirs. Everything else runs for real:
// a real showfile, edited behind the app's back by the spec process.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, openFromRecent, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string
let root: string
let showPath: string

/** A wait cue, as a showfile carries one. */
function waitCue(id: string, name: string): Record<string, unknown> {
  return {
    id,
    number: id,
    name,
    type: 'wait',
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 1000,
    advance: 'none',
    isArmed: true,
    notes: ''
  }
}

function showFile(cues: unknown[] = []): string {
  return `${JSON.stringify({
    version: 1,
    id: 'w-conflict',
    name: 'Conflict Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues
  }, null, 2)}\n`
}

test.beforeEach(async () => {
  ;({ app, page, userDataDir } = await launchApp())
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-conflict-'))
  showPath = path.join(root, 'Conflict Show.cuerunner')
  fs.writeFileSync(showPath, showFile())
})

test.afterEach(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

/** Opens the show the way an operator does: the entry in the app's own recent list. */
async function openShow(): Promise<void> {
  await openFromRecent(page, userDataDir, showPath)
  await expect(page.locator('.workspace-name')).toContainText('Conflict Show')
}

/** Save, by the action it performs: "Save" as text also matches "Save As…". */
async function saveFromFileMenu(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save"]').click()
}

/**
 * Answers the save's own prompt without showing it, and records what it was asked: 0
 * overwrites, 1 abandons. The recorder clears itself, so a spec that answers twice gets
 * what it asked for both times.
 */
async function answerSavePrompt(response: 0 | 1): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    interface Asked { message?: string; buttons?: string[] }
    const gates = globalThis as unknown as { __savePromptCalls: Asked[] }
    gates.__savePromptCalls = []
    // The overloads on `showMessageBox` want a function that answers either call shape;
    // the options are the last argument whichever shape it is.
    dialog.showMessageBox = (async (...args: unknown[]) => {
      gates.__savePromptCalls.push(args[args.length - 1] as Asked)
      return { response: answer, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, response)
}

/** What the save's prompt has been asked so far. */
function savePrompts(): Promise<Array<{ message?: string; buttons?: string[] }>> {
  return app.evaluate(() => {
    const gates = globalThis as unknown as {
      __savePromptCalls?: Array<{ message?: string; buttons?: string[] }>
    }
    return gates.__savePromptCalls ?? []
  })
}

/** Whether the file on disk is still the version the spec wrote behind the app's back. */
function cuesOnDisk(): string[] {
  return (JSON.parse(fs.readFileSync(showPath, 'utf-8')) as { cues: Array<{ name: string }> })
    .cues.map(cue => cue.name)
}

test('an edit on disk is offered Overwrite or Abandon, and Abandon leaves it alone', async () => {
  await openShow()
  // An edit in the session, so there is something to save and the dot says so.
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.workspace-name')).toContainText('●')

  // Somebody else saves over the file while this session holds the show.
  const theirs = showFile([waitCue('t1', 'Their Encore')])
  fs.writeFileSync(showPath, theirs)

  await answerSavePrompt(1)
  await saveFromFileMenu()
  await expect.poll(async () => (await savePrompts()).length).toBe(1)

  const prompts = await savePrompts()
  // The prompt names the file, and asks the two questions the save can act on.
  expect(prompts[0].message).toContain('Conflict Show.cuerunner')
  expect(prompts[0].buttons).toEqual(['Overwrite', 'Abandon'])
  // Abandon is a save that did not happen: their bytes are untouched and the session is
  // still unsaved, with the dot as the standing signal rather than an error.
  expect(fs.readFileSync(showPath, 'utf-8')).toBe(theirs)
  expect(cuesOnDisk()).toEqual(['Their Encore'])
  await expect(page.locator('.workspace-name')).toContainText('●')
  await expect(page.locator('.app-notice[data-kind="error"]')).toHaveCount(0)
})

test('Overwrite writes the show, and the next save asks nothing', async () => {
  await openShow()
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.workspace-name')).toContainText('●')

  fs.writeFileSync(showPath, showFile([waitCue('t1', 'Their Encore')]))

  await answerSavePrompt(0)
  await saveFromFileMenu()
  await expect(page.locator('.workspace-name')).not.toContainText('●')

  expect(await savePrompts()).toHaveLength(1)
  expect(cuesOnDisk()).toEqual(['Wait'])

  // The bytes this save wrote are the file this session is built from now: saving again
  // replaces nothing anybody else wrote.
  await toolbarCueBtn(page, 'Wait').click()
  await saveFromFileMenu()
  await expect(page.locator('.workspace-name')).not.toContainText('●')
  expect(await savePrompts()).toHaveLength(1)
})

test('a save that is not replacing somebody else’s edit asks nothing', async () => {
  await openShow()
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.workspace-name')).toContainText('●')

  await answerSavePrompt(1)
  await saveFromFileMenu()
  await expect(page.locator('.workspace-name')).not.toContainText('●')

  // Nothing was asked, so an answer of Abandon never came up: the save went through.
  expect(await savePrompts()).toHaveLength(0)
  expect(cuesOnDisk()).toEqual(['Wait'])
})
