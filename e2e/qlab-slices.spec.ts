// A QLab rehearsal track, brought across with its slices and devamps, and played: the count-in
// vamps until its devamp, and the devamp moves the music on past the bar QLab set to play 0
// times. The workspace is the import's own fixture (`rehearsalTrackWorkspace`), cut the way a
// real QLab 5 show cuts its tracks; where the music is comes from the engine itself, read
// through the bridge the window uses for a cue's progress.
//
//   0–1 s once · 1–2 s vamps · 2–3 s skipped · 3–5 s once · 5–6 s vamps · 6–7 s skipped · 7–8 s once
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'
import { writeSineWav } from './audioIo'
import { rehearsalTrackWorkspace } from '../src/main/import/archiveFixture'

let app: ElectronApplication | undefined
let root: string

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-qlab-slices-'))
})

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

/** Where the engine is in the track's file, ms, or null when nothing plays it. */
async function position(page: Page): Promise<number | null> {
  const reading = await page.evaluate(async () => {
    const bridge = (window as unknown as {
      cuerunner: { audio: { progress: (id: string) => Promise<{ elapsedMs: number } | null> } }
    }).cuerunner
    return bridge.audio.progress('RT1')
  })
  return reading === null ? null : Math.round(reading.elapsedMs)
}

/** Where the engine was, read every few ms for `ms`. */
async function positionsFor(page: Page, ms: number): Promise<number[]> {
  const seen: number[] = []
  const until = Date.now() + ms
  while (Date.now() < until) {
    const at = await position(page)
    if (at !== null) seen.push(at)
    await page.waitForTimeout(20)
  }
  return seen
}

test('a QLab track’s vamp holds until its devamp, which moves on past the slice QLab set to play 0 times', async () => {
  test.setTimeout(90_000)
  const show = path.join(root, 'Rehearsal Tracks')
  fs.mkdirSync(path.join(show, 'audio'), { recursive: true })
  writeSineWav(path.join(show, 'audio', 'track.wav'), { seconds: 8 })
  const workspaceFile = path.join(show, 'Rehearsal Tracks.qlab5')
  fs.writeFileSync(workspaceFile, rehearsalTrackWorkspace())

  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  const launched = await launchApp({ userDataDir })
  app = launched.app
  const page = launched.page

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="import-qlab"]').click()
  await app.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, workspaceFile)
  await page.locator('[data-action="qlab-file"]').click()

  const report = page.getByRole('dialog', { name: 'QLab import report' })
  await expect(report.getByTestId('qlab-summary')).toContainText('4 cues in 1 cue list came across from Rehearsal Tracks.qlab5')
  const row = (type: string, became: string) => report.locator(`tr[data-qlab-type="${type}"][data-became="${became}"] .qlab-count`)
  await expect(row('Devamp', 'devamp')).toHaveText('2')
  await expect(row('Memo', 'memo')).toHaveText('1')
  // The 0 counts are a reading of QLab's data, and the report says so.
  await expect(report).toContainText('QLab does not document a count of 0')
  await expect(report.getByTestId('qlab-media-ok')).toBeVisible()
  await report.locator('[data-action="qlab-done"]').click()
  await expect(report).toHaveCount(0)

  // The list is QLab's running order, not a group wrapping it.
  const rows = page.locator('.cue-row')
  await expect(rows).toHaveCount(4)
  const track = rows.nth(0)
  await expect(track).toContainText('track')

  // The slices as the inspector draws them: the skipped bars on the bar, struck through.
  await track.click()
  await page.locator('.inspector-tab', { hasText: 'Slices' }).click()
  await expect(page.locator('.slice-piece')).toHaveText(['×1', '∞', 'skip', '×1', '∞', 'skip', '×1'])
  await expect(page.locator('.slice-piece[data-skip="true"]')).toHaveCount(2)

  await track.click()
  await page.keyboard.press('Space')
  await expect(track).toHaveAttribute('data-running', 'true')
  // Past the count-in and into its vamp, the engine stays in the vamp's bar, pass after pass.
  await expect.poll(() => position(page), { timeout: 5000 }).toBeGreaterThanOrEqual(1000)
  await page.waitForTimeout(1500)
  const holding = await positionsFor(page, 1500)
  expect(holding.length).toBeGreaterThan(10)
  expect(holding.every(at => at >= 1000 && at <= 2000), `the vamp held: ${holding.join(', ')}`).toBe(true)

  // The devamp: the vamp finishes its pass, and the music goes on from 3 s — the bar from 2 s
  // to 3 s is never played.
  await rows.nth(1).click()
  await page.keyboard.press('Space')
  const after = await positionsFor(page, 3000)
  expect(after.some(at => at >= 3100), `it moved on: ${after.join(', ')}`).toBe(true)
  expect(after.filter(at => at > 2050 && at < 2950), `the skipped bar was not heard: ${after.join(', ')}`).toEqual([])
  // And it holds again at the next vamp, 5–6 s, until the next devamp.
  await expect.poll(() => position(page), { timeout: 5000 }).toBeGreaterThanOrEqual(5000)
  const second = await positionsFor(page, 1200)
  expect(second.every(at => at >= 5000 && at <= 6000), `the second vamp held: ${second.join(', ')}`).toBe(true)
  await expect(track).toHaveAttribute('data-running', 'true')
})
