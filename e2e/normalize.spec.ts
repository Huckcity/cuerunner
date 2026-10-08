// Normalize: a cue's file measured by the engine (EBU R128) and its trim set to the show's
// target, the reading shown on the cue; a selection normalised as one edit, which one undo
// takes back whole.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { closeApp } from './helpers'
import { audioCue, openShow, writeSineWav } from './audioIo'

let app: ElectronApplication | undefined
let page: Page
let root: string

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

/** Edit → Undo, as the menu runs it. */
async function undo(): Promise<void> {
  await app!.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()?.getMenuItemById('edit-undo')?.click(undefined, BrowserWindow.getAllWindows()[0])
  })
}

const trimReadout = () => page.locator('.inspector .field-row', { hasText: /^Trim/ }).locator('.inspector-readout')

test('a cue is normalised to the target, and a selection as one undo step', async ({}, testInfo) => {
  test.setTimeout(90_000)
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  // A 1 kHz sine at −20 dBFS in both channels reads −20 LUFS; one at −14 reads −14.
  const quiet = path.join(testInfo.outputDir, 'quiet.wav')
  const loud = path.join(testInfo.outputDir, 'loud.wav')
  writeSineWav(quiet, { seconds: 6, levelDb: -20, hz: 1000 })
  writeSineWav(loud, { seconds: 6, levelDb: -14, hz: 1000 })
  ;({ app, page, root } = await openShow(testInfo, 'Loudness', {
    cues: [audioCue('a1', '1', 'Quiet', quiet), audioCue('a2', '2', 'Loud', loud)]
  }))

  await page.locator('.cue-row', { hasText: 'Quiet' }).click()
  await page.locator('.inspector-tab', { hasText: /^Audio$/ }).click()
  await expect(page.locator('.loudness-readout')).toHaveText('not measured')
  await page.locator('.normalize-btn').click()
  // −20 to −23 is −3 dB: a trim of 71%.
  await expect(page.locator('.loudness-readout')).toContainText('−20.0 LUFS')
  await expect(page.locator('.loudness-readout')).toContainText('→ −23.0 LUFS with the trim')
  await expect(trimReadout()).toHaveText('71%')

  // Both selected, from the right-click menu: one edit for the two.
  await undo()
  await expect(trimReadout()).toHaveText('100%')
  await page.locator('.cue-row', { hasText: 'Loud' }).click({ modifiers: ['Shift'] })
  await page.locator('.cue-row', { hasText: 'Quiet' }).click({ button: 'right' })
  await page.locator('.cue-context-menu-item[data-action="normalize"]').click()
  await page.locator('.cue-row', { hasText: 'Loud' }).click()
  await page.locator('.inspector-tab', { hasText: /^Audio$/ }).click()
  // −14 to −23 is −9 dB: 35%.
  await expect(trimReadout()).toHaveText('35%')
  await page.locator('.cue-row', { hasText: 'Quiet' }).click()
  await expect(trimReadout()).toHaveText('71%')

  // One undo takes the whole batch back.
  await undo()
  await expect(trimReadout()).toHaveText('100%')
  await page.locator('.cue-row', { hasText: 'Loud' }).click()
  await expect(trimReadout()).toHaveText('100%')
})

test('the target is the show\'s, set in Settings → Audio', async ({}, testInfo) => {
  test.setTimeout(60_000)
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  const quiet = path.join(testInfo.outputDir, 'quiet.wav')
  writeSineWav(quiet, { seconds: 6, levelDb: -20, hz: 1000 })
  ;({ app, page, root } = await openShow(testInfo, 'Target', {
    audioSettings: { loudnessTargetLufs: -16 },
    cues: [audioCue('a1', '1', 'Quiet', quiet)]
  }))
  await page.locator('.cue-row', { hasText: 'Quiet' }).click()
  await page.locator('.inspector-tab', { hasText: /^Audio$/ }).click()
  await expect(page.locator('.normalize-btn')).toHaveText('Normalize to −16.0 LUFS')
  await page.locator('.normalize-btn').click()
  // +4 dB is a trim of 158%.
  await expect(trimReadout()).toHaveText('158%')
})
