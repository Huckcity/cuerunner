// A .cuerunner whose cue grouping is damaged — children scattered through the list, a
// cue naming a group that is not in the file — used to load as-is: the walk that orders
// the show mis-fires on a child where it does not sit, and the orphan never fires with
// the show. This is the journey the repair is for: open it the way an operator does, see
// the cue list reordered and the bar that says what changed, and find the file on disk
// exactly as it was — loading is not a save.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, openFromRecent } from './helpers'

let app: ElectronApplication
let page: Page
let root: string
let userDataDir: string
let showPath: string
let broken: string

function cue(id: string, over: Record<string, unknown> = {}): unknown {
  return {
    id,
    number: '',
    name: id,
    type: 'wait',
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 1000,
    advance: 'none',
    isArmed: true,
    notes: '',
    ...over
  }
}

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-grouping-'))
  showPath = path.join(root, 'Broken Grouping.cuerunner')
  broken = `${JSON.stringify(
    {
      version: 1,
      id: 'w-broken-grouping',
      name: 'Broken Grouping',
      createdAt: '2026-01-01T00:00:00.000Z',
      audioSettings: { outputDeviceId: 'default' },
      midiSettings: { outputPortName: '' },
      cues: [
        cue('g1', { type: 'group', mode: 'playlist', number: '1', name: 'Opening' }),
        cue('c1', { number: '2', name: 'Walk-in', parentId: 'g1' }),
        cue('o1', { number: '3', name: 'The stray', parentId: 'gone' }),
        cue('c2', { number: '4', name: 'Bows', parentId: 'g1' })
      ]
    },
    null,
    2
  )}\n`
  fs.writeFileSync(showPath, broken)

  userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  ;({ app, page } = await launchApp({ userDataDir }))
})

test.afterAll(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

test('a damaged grouping loads repaired, is reported, and leaves the file as it was', async () => {
  test.setTimeout(120_000)

  await openFromRecent(page, userDataDir, showPath)

  // The list the walks need: the group's children are one block behind it, and the cue
  // whose group is not in the file sits at the top level, where it fires with the show.
  await expect(page.locator('.cue-row')).toHaveCount(4)
  const labels = await page.locator('.cue-row').evaluateAll(rows =>
    rows.map(row => {
      const number = row.querySelector('.cue-number')?.textContent ?? ''
      const name = row.querySelector('.name-text')?.textContent ?? ''
      return `${number} ${name}`.trim()
    })
  )
  expect(labels).toEqual(['1 Opening', '2 Walk-in', '4 Bows', '3 The stray'])
  // Two top rows — the group and the orphan — and the group's two children between them.
  await expect(page.locator('.cue-row[data-depth="0"]')).toHaveCount(2)
  await expect(page.locator('.cue-row[data-depth="1"]')).toHaveCount(2)
  await expect(
    page.locator('.cue-row[data-depth="0"]').filter({ hasText: 'The stray' })
  ).toHaveCount(1)

  // The operator is told, with the count in the sentence.
  const bar = page.locator('.grouping-note-bar')
  await expect(bar).toBeVisible()
  await expect(bar).toContainText(
    'The cue grouping in this show was repaired on load (2 changes).'
  )

  await bar.locator('.grouping-note-review').click()
  const rows = page.locator('.grouping-note-row')
  await expect(rows).toHaveCount(2)
  // One note per repair, in pass order: the orphan first, then the gathered group.
  await expect(rows.nth(0)).toContainText('3 The stray')
  await expect(rows.nth(0)).toContainText('still fires with the show, at the top level')
  await expect(rows.nth(1)).toContainText('1 Opening')
  await expect(rows.nth(1)).toContainText('one block behind it')
  await expect(page.locator('.grouping-note-blurb')).toContainText('The file on disk is unchanged')

  await page.locator('.grouping-note-close').click()
  await expect(page.locator('.grouping-note-dialog')).toHaveCount(0)

  // The load did not write the file: the damage is in the session only, and the bytes on
  // disk are exactly what was written before the app ever opened it.
  expect(fs.readFileSync(showPath, 'utf-8')).toBe(broken)
})
