/**
 * Nothing may eat a GO press.
 *
 * GO is the one control an operator presses without looking, so the press has to land on
 * whatever is in front of them — including the surfaces that hold focus: an open menu, the
 * settings dialog somebody left up, the missing-media list that opened by itself when the
 * show loaded. Each of those is on trial here: with it open, the space bar still fires the
 * cue the selection is standing on, and the surface is still there afterwards. A dialog's
 * own button does not take the press either — the space bar belongs to the show, not to
 * whatever happens to be focused.
 *
 * A text field is the exception, and it is asserted here too: a space in a cue's name is a
 * space. The rule is about surfaces taking a press they were not asked for, not about
 * typing.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, mintLicense, openFromRecent, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
})

test.afterAll(async () => {
  await closeApp(app)
})

/** Nothing running, nothing open, and the first cue selected: GO fires it or nothing did. */
async function standOnTheFirstCue(): Promise<void> {
  await page.getByRole('button', { name: /STOP/ }).click()
  await page.keyboard.press('Escape')
  await page.locator('.cue-row').first().click()
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-selected', 'true')
}

/** GO fired: the cue the selection stood on is running, and the selection has advanced. */
async function expectTheFirstCueFired(): Promise<void> {
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-running', 'true')
  await expect(page.locator('.cue-row').nth(1)).toHaveAttribute('data-selected', 'true')
}

test('the space bar fires the cue the selection is standing on', async () => {
  await standOnTheFirstCue()
  await page.keyboard.press('Space')
  await expectTheFirstCueFired()
})

test('the settings dialog does not eat the press', async () => {
  await standOnTheFirstCue()
  await page.keyboard.press('Control+,')
  await expect(page.locator('.settings-dialog')).toBeVisible()

  // The press comes from inside the dialog, with focus on the control that closes it —
  // the one place a stolen space bar would be least forgivable: the operator gets a
  // closed dialog and no cue.
  await page.locator('.settings-close').focus()
  await page.keyboard.press('Space')

  await expectTheFirstCueFired()
  await expect(page.locator('.settings-dialog')).toBeVisible()
  await page.locator('.settings-close').click()
})

test('an open menu does not eat the press', async () => {
  await standOnTheFirstCue()
  await page.locator('.cue-row').first().click({ button: 'right' })
  await expect(page.locator('.cue-context-menu')).toBeVisible()

  await page.keyboard.press('Space')

  await expectTheFirstCueFired()
  await expect(page.locator('.cue-context-menu')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('the missing-media dialog does not eat the press', async () => {
  // A show whose one audio file is not on this machine: it opens with the bar, and the
  // list behind the bar is a dialog nobody asked for, over a show that is already running.
  const showDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-go-press-'))
  const wlab = path.join(showDir, 'Go Press.wlab')
  fs.writeFileSync(
    wlab,
    JSON.stringify(
      {
        version: 1,
        id: 'w-go-press',
        name: 'Go Press',
        createdAt: new Date().toISOString(),
        audioSettings: { outputDeviceId: 'default' },
        midiSettings: { outputPortName: '' },
        cues: [
          {
            id: 'a1',
            number: '1',
            name: 'Walk-in Music',
            type: 'audio',
            filePath: path.join(showDir, 'media', 'not-here.wav'),
            startTime: 0,
            endTime: null,
            fadeInDuration: 0,
            loopCount: 0,
            playbackRate: 1,
            trim: 1
          }
        ]
      },
      null,
      2
    )
  )

  let second: { app: ElectronApplication; page: Page; userDataDir: string } | null = null
  try {
    second = await launchApp()
    await openFromRecent(second.page, second.userDataDir, wlab)
    // Its own Wait cues: the cue under the selection has to be one that runs. What is
    // missing is the media the bar is reporting, not the cue list.
    await toolbarCueBtn(second.page, 'Wait').click()
    await toolbarCueBtn(second.page, 'Wait').click()

    // The selection is made before the list is covered: the dialog is modal, so from the
    // moment it opens the pointer belongs to it. The keyboard does not.
    const rows = second.page.locator('.cue-row')
    await rows.nth(1).click()
    await second.page.locator('.missing-media-bar-review').click()
    await expect(second.page.locator('.missing-media-dialog')).toBeVisible()
    await second.page.locator('.missing-media-dismiss').focus()
    await second.page.keyboard.press('Space')

    await expect(rows.nth(1)).toHaveAttribute('data-running', 'true')
    await expect(rows.nth(2)).toHaveAttribute('data-selected', 'true')
    await expect(second.page.locator('.missing-media-dialog')).toBeVisible()
  } finally {
    if (second !== null) await closeApp(second.app)
    fs.rmSync(showDir, { recursive: true, force: true })
  }
})

test('the mic plot dialog does not eat the press', async () => {
  // The plot is the licensed half of the app, and its own instance: the dialog is only
  // reachable from the RF panel with a rack to patch.
  const licensed = await launchApp({ license: mintLicense() })
  try {
    await toolbarCueBtn(licensed.page, 'Wait').click()
    await toolbarCueBtn(licensed.page, 'Wait').click()
    // The selection is made while the list is still reachable: the dialog is modal.
    await licensed.page.locator('.cue-row').first().click()
    await licensed.page.locator('.btn-rf').click()
    await licensed.page.locator('.rf-demo-btn').click()
    await licensed.page.locator('.rf-edit').click()
    await expect(licensed.page.locator('.plot-dialog')).toBeVisible()

    await licensed.page.locator('.plot-close').focus()
    await licensed.page.keyboard.press('Space')

    await expect(licensed.page.locator('.cue-row').first()).toHaveAttribute('data-running', 'true')
    await expect(licensed.page.locator('.plot-dialog')).toBeVisible()
  } finally {
    await closeApp(licensed.app)
  }
})

test('a text field keeps the space it is given', async () => {
  await standOnTheFirstCue()
  const name = page.locator('.field-row').filter({ hasText: 'Name' }).locator('input')
  await name.fill('Walk')
  await name.press('Space')

  // The space went into the name, and the show did not move: a field is the one surface
  // allowed to keep the press, because a space in a name is a space.
  await expect(name).toHaveValue('Walk ')
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-selected', 'true')
})
