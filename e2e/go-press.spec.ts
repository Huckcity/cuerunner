/**
 * What a GO press may land on.
 *
 * GO is the one control an operator presses without looking, so the press has to land on
 * whatever is in front of them — including the surfaces that hold focus: an open menu, the
 * context menu over the cue list, the settings dialog, Show Settings, the missing-media
 * list that opened by itself when the show loaded. Each of those is on trial here, and the
 * rule it is tried against depends on the surface: a menu passes the press through to the
 * show, while a modal panel stands the transport keys down — the operator is setting
 * something up, not running it, and a Space typed into a name must not fire the next cue
 * behind it. Closing the panel hands the keyboard back either way.
 *
 * A text field keeps the space it is given: the rule is about surfaces taking a press
 * they were not asked for, not about typing.
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
  // An operator presses GO when they mean it, and the previous test's press is still
  // inside the firing window — that is what the window is for. Thirty milliseconds is
  // not long enough to be a second press of the same hand.
  await page.waitForTimeout(400)
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

test('the settings dialog stands the transport down', async () => {
  await standOnTheFirstCue()
  await page.keyboard.press('Control+,')
  await expect(page.locator('.settings-dialog')).toBeVisible()

  // The press comes from inside the dialog, with focus on the control that closes it —
  // the one place a stolen space bar would be least forgivable: the operator would get a
  // fired cue and a closed dialog. The modal owns the keyboard, so neither happens.
  await page.locator('.settings-close').focus()
  await page.keyboard.press('Space')

  await expect(page.locator('.cue-row').first()).not.toHaveAttribute('data-running', 'true')
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-selected', 'true')

  // Closing it hands the keyboard back to the show.
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-dialog')).toHaveCount(0)
  await page.keyboard.press('Space')
  await expectTheFirstCueFired()
})

test('the panel’s Escape closes the panel and nothing else', async () => {
  await standOnTheFirstCue()
  // A cue that is still running when the panel is closed: a post-wait far longer than
  // this test gives the cue that, on the tab the selection already opens on. What the
  // test holds is that the panel's Escape never reaches the transport.
  await page.locator('.field-row').filter({ hasText: 'Post-wait' }).locator('input').fill('30')
  await page.locator('.cue-row').first().click()
  await page.keyboard.press('Space')
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-running', 'true')

  await page.keyboard.press('Control+,')
  await expect(page.locator('.settings-dialog')).toBeVisible()
  await page.keyboard.press('Escape')

  // One press, one thing: the panel closes, and the cue behind it is still running. An
  // Escape that also stopped the show would cut a cue nobody asked to cut.
  await expect(page.locator('.settings-dialog')).toHaveCount(0)
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-running', 'true')

  await page.getByRole('button', { name: /STOP/ }).click()
})

test('the changes dialog stands the transport down', async () => {
  await standOnTheFirstCue()
  // This machine is unlicensed, so what the dialog draws is the lock rather than a list of
  // saves — the frame and the modal registration are the same either way, and those are
  // what this rule is about.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="history"]').click()
  await expect(page.getByRole('dialog', { name: 'Changes' })).toBeVisible()

  await page.locator('.changes-dialog .settings-close').focus()
  await page.keyboard.press('Space')
  await expect(page.locator('.cue-row').first()).not.toHaveAttribute('data-running', 'true')

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Changes' })).toHaveCount(0)
  await page.keyboard.press('Space')
  await expectTheFirstCueFired()
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

test('the missing-media dialog stands the transport down', async () => {
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
    // moment it opens the pointer belongs to it.
    const rows = second.page.locator('.cue-row')
    await rows.nth(1).click()
    await second.page.locator('.missing-media-bar-review').click()
    await expect(second.page.locator('.missing-media-dialog')).toBeVisible()
    await second.page.locator('.missing-media-dismiss').focus()
    await second.page.keyboard.press('Space')

    // The modal owns the keyboard: the cue the selection was standing on has not moved.
    await expect(rows.nth(1)).not.toHaveAttribute('data-running', 'true')
    await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true')

    // Dismissing it hands the keyboard back to the show.
    await second.page.keyboard.press('Escape')
    await expect(second.page.locator('.missing-media-dialog')).toHaveCount(0)
    await second.page.keyboard.press('Space')
    await expect(rows.nth(1)).toHaveAttribute('data-running', 'true')
    await expect(rows.nth(2)).toHaveAttribute('data-selected', 'true')
  } finally {
    if (second !== null) await closeApp(second.app)
    fs.rmSync(showDir, { recursive: true, force: true })
  }
})

test('the Show Settings dialog stands the transport down', async () => {
  // The plot is the licensed half of the app, and its own instance: the editor is a tab
  // of Show Settings now, reachable from the RF panel with a rack to patch.
  const licensed = await launchApp({ license: mintLicense() })
  try {
    await toolbarCueBtn(licensed.page, 'Wait').click()
    await toolbarCueBtn(licensed.page, 'Wait').click()
    // The selection is made while the list is still reachable: the dialog is modal.
    await licensed.page.locator('.cue-row').first().click()
    await licensed.page.locator('.btn-rf').click()
    await licensed.page.locator('.rf-demo-btn').click()
    await licensed.page.locator('.rf-edit').click()
    const dialog = licensed.page.locator('.show-settings-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.show-settings-tab', { hasText: 'Mic plot' }))
      .toHaveAttribute('data-active', 'true')

    await licensed.page.locator('.show-settings-close').focus()
    await licensed.page.keyboard.press('Space')

    // The modal owns the keyboard: the cue the selection was standing on has not moved.
    await expect(licensed.page.locator('.cue-row').first())
      .not.toHaveAttribute('data-running', 'true')

    // And once it is closed the keyboard is the show's again.
    await licensed.page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await licensed.page.keyboard.press('Space')
    await expect(licensed.page.locator('.cue-row').first()).toHaveAttribute('data-running', 'true')
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

test('Escape closes the context menu without stopping the show', async () => {
  // The menu's own Escape and the transport's Escape are the same key: put the menu
  // down is what the operator meant, and the cue behind it keeps playing.
  await standOnTheFirstCue()
  await page.locator('.field-row').filter({ hasText: 'Post-wait' }).locator('input').fill('30')
  await page.locator('.cue-row').first().click()
  await page.keyboard.press('Space')
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-running', 'true')

  await page.locator('.cue-row').first().click({ button: 'right' })
  await expect(page.locator('.cue-context-menu')).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(page.locator('.cue-context-menu')).toHaveCount(0)
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-running', 'true')

  await page.getByRole('button', { name: /STOP/ }).click()
})
