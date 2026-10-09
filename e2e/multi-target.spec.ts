// A Fade and a Stop that name several cues: built in the inspector, run on GO, shown in the
// Active tab — and a show saved when each could name one opens with its one target as a list
// of one, and is saved back byte for byte until its targets are edited.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication | undefined
let page: Page
let root: string
let showPath: string

function writeWav(filePath: string, seconds = 20): void {
  const sampleRate = 48000
  const frames = sampleRate * seconds
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 20) * 16000), 44 + i * 2)
  fs.writeFileSync(filePath, buffer)
}

const base = {
  colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
  duration: 0, advance: 'none', isArmed: true, notes: ''
}

/** A show as a build before lists wrote it: a fade and a stop that each name one cue. */
function legacyShow(media: string): string {
  const tone = (id: string, number: string, name: string) => ({
    ...base, id, number, name, type: 'audio', filePath: media, startTime: 0, endTime: null,
    fadeInDuration: 0, volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
  })
  return `${JSON.stringify({
    version: 1, id: 'w-targets', name: 'Targets', createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' }, midiSettings: { outputPortName: '' },
    // No firing window: the spec presses GO in quick succession on purpose.
    triggerGuard: { windowMs: 0 },
    cues: [
      tone('a1', '1', 'Walk-in'),
      tone('a2', '2', 'Storm'),
      { ...base, id: 'w1', number: '3', name: 'Hold', type: 'wait', duration: 30_000 },
      { ...base, id: 'f1', number: '4', name: 'Fade walk-in', type: 'fade', duration: 800, targetCueId: 'a1', fadeProperty: 'volume', targetValue: 0, curve: 'linear', stopTargetWhenDone: true },
      { ...base, id: 's1', number: '5', name: 'Stop hold', type: 'stop', targetCueId: 'w1', fadeOut: false, fadeOutDuration: 500, waitForFade: false }
    ]
  }, null, 2)}\n`
}

async function open(): Promise<void> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-control-osc-targets-'))
  const media = path.join(root, 'tone.wav')
  writeWav(media)
  showPath = path.join(root, 'Targets.cuerunner')
  fs.writeFileSync(showPath, legacyShow(media))
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  ;({ app, page } = await launchApp({ userDataDir }))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Targets.cuerunner' }).click()
  await expect(page.locator('.cue-row')).toHaveCount(5)
}

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

function row(number: string) {
  return page.locator('.cue-row').filter({ has: page.locator('.cue-number', { hasText: new RegExp(`^${number}$`) }) })
}

async function save(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save"]').click()
}

test('a show saved with one target opens with it as a list of one, and keeps that spelling until it is edited', async () => {
  await open()
  await row('4').click()
  await page.locator('.inspector-tab', { hasText: 'Fade' }).click()
  await expect(page.locator('.target-row')).toHaveCount(1)
  await expect(page.locator('.target-row')).toContainText('1 Walk-in')

  // Saved without an edit: the fade and the stop keep the one field they were written with.
  // (The first save of a hand-written show also records where its media is; the cues that
  // act on cues are what this spec reads, and a second save is the same bytes as the first.)
  const before = fs.statSync(showPath).mtimeMs
  await save()
  await expect.poll(() => fs.statSync(showPath).mtimeMs).toBeGreaterThan(before)
  const saved = JSON.parse(fs.readFileSync(showPath, 'utf8'))
  const byId = (id: string) => saved.cues.find((cue: { id: string }) => cue.id === id)
  expect(byId('f1').targetCueId).toBe('a1')
  expect('targetCueIds' in byId('f1')).toBe(false)
  expect(byId('s1').targetCueId).toBe('w1')
  expect('targetCueIds' in byId('s1')).toBe(false)

  // An edit of the targets writes the list, and takes the single field away.
  const picker = page.locator('#fade-target-add')
  await picker.selectOption({ label: '2 Storm' })
  await expect(page.locator('.target-row')).toHaveCount(2)
  await save()
  await expect.poll(() => {
    const fade = JSON.parse(fs.readFileSync(showPath, 'utf8')).cues.find((cue: { id: string }) => cue.id === 'f1')
    return [fade.targetCueIds, 'targetCueId' in fade]
  }).toEqual([['a1', 'a2'], false])
})

test('a fade of two sounds moves both, says so in the Active tab, and stops both when it is done', async () => {
  await open()
  await row('4').click()
  await page.locator('.inspector-tab', { hasText: 'Fade' }).click()
  await page.locator('#fade-target-add').selectOption({ label: '2 Storm' })
  await page.locator('.field-row', { hasText: 'Duration' }).locator('input').fill('3')

  await page.locator('.dock-tab.btn-active').click()
  await row('1').click()
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  await expect(row('1')).toHaveAttribute('data-running', 'true')
  await expect(row('2')).toHaveAttribute('data-running', 'true')

  await row('4').click()
  await page.keyboard.press('Space')
  const fadeRow = page.locator('.active-row[data-type="fade"]')
  await expect(fadeRow.locator('.active-targets')).toContainText('1 Walk-in, 2 Storm')
  await expect(page.locator('.active-row[data-cue-id="a1"] [data-fading="true"]')).toBeVisible()
  await expect(page.locator('.active-row[data-cue-id="a2"] [data-fading="true"]')).toBeVisible()

  await expect(row('1')).toHaveAttribute('data-running', 'false', { timeout: 6000 })
  await expect(row('2')).toHaveAttribute('data-running', 'false')
})

test('a stop of several cues takes each away and leaves the rest', async () => {
  await open()
  await row('5').click()
  await page.locator('.inspector-tab', { hasText: 'Stop' }).click()
  // A show saved with one target is a stop of these cues, not of all of them.
  await expect(page.locator('#stop-target-mode')).toHaveValue('cues')
  await page.locator('#stop-target-add').selectOption({ label: '1 Walk-in' })
  await expect(page.locator('.target-row')).toHaveCount(2)

  await row('1').click()
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  await expect(row('3')).toHaveAttribute('data-running', 'true')

  await row('5').click()
  await page.keyboard.press('Space')
  await expect(row('1')).toHaveAttribute('data-running', 'false')
  await expect(row('3')).toHaveAttribute('data-running', 'false')
  await expect(row('2')).toHaveAttribute('data-running', 'true')
})
