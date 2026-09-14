// A vamp and its devamp: a cue loops a section of its file until a devamp cue lets it
// go, and then it plays out to the end — with the show moving on while it does.
//
// What is asserted is what the operator sees: the row says the cue is vamping rather
// than counting down, it is still going long after the file would have ended, and the
// devamp leaves the music playing while the cue that released it is already finished.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addCueFromMoreMenu, closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let root: string

/** One second of tone at a quarter amplitude: short, so a loop is quick to see. */
function writeWav(filePath: string, seconds = 1): void {
  const sampleRate = 48000
  const frames = sampleRate * seconds
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) {
    buffer.writeInt16LE(Math.round(Math.sin(i / 40) * 8000), 44 + i * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

const cue = (filePath: string): unknown => ({
  id: 'a1', number: '1', name: 'Playoff', type: 'audio',
  colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
  duration: 0, advance: 'none', isArmed: true, notes: '',
  filePath,
  startTime: 0, endTime: null, fadeInDuration: 0,
  volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
})

test.beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-vamp-'))
  const media = path.join(root, 'playoff.wav')
  writeWav(media)
  const showPath = path.join(root, 'Vamp.wlab')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1,
    id: 'w-vamp',
    name: 'Vamp',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [cue(media)]
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  ;({ app, page } = await launchApp({ userDataDir }))

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Vamp.wlab' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Playoff' })).toBeVisible()
})

test.afterEach(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

/** Makes the selected audio cue a vamp of its own region, from the inspector. */
async function makeItAVamp(): Promise<void> {
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  await expect(page.locator('.vamp-toggle')).toBeVisible()
  await page.locator('.vamp-toggle').click()
  await expect(page.locator('.vamp-toggle')).toHaveAttribute('data-active', 'true')
  // The toggle and the field are one state: -1 is what "forever" is written as.
  await expect(page.locator('.field-row', { hasText: 'Loop count' }).locator('input')).toHaveValue('-1')
}

/** A devamp cue, pointed at the audio cue it releases. */
async function addDevamp(targetName: string): Promise<void> {
  await addCueFromMoreMenu(page, 'Devamp')
  await page.locator('.inspector-tab', { hasText: 'Devamp' }).click()
  await page.locator('.field-row', { hasText: 'Release' }).locator('select')
    .selectOption({ label: `1 ${targetName}` })
}

test('a vamp loops forever, and a devamp plays it out', async () => {
  test.setTimeout(60_000)

  await page.locator('.cue-row', { hasText: 'Playoff' }).click()
  await makeItAVamp()
  await page.getByRole('button', { name: /GO/ }).click()

  // Reading as vamping rather than as playing-with-a-countdown is the point: there is no
  // end to count down to.
  await expect(page.locator('.cue-row').first().locator('.state-pill', { hasText: 'vamping' })).toBeVisible()

  // The file is one second long. Three seconds later the cue is still going, which a
  // cue that played once could not be — the engine would have reported the end.
  await page.waitForTimeout(3000)
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-running', 'true')
  await expect(page.locator('.running-badge')).toContainText('1 running')

  await addDevamp('Playoff')
  const devampRow = page.locator('.cue-row', { hasText: 'Devamp' })
  await devampRow.click()

  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /GO/ }).click()

  // The devamp is done the moment it has asked, and it says so.
  await devampRow.click()
  await page.locator('.inspector-tab', { hasText: 'Devamp' }).click()
  await expect(page.locator('.last-run-badge')).toHaveText('ok')

  // And the music it released plays on to the end of the file and stops, rather than
  // looping for the rest of the night.
  await expect(page.locator('.cue-row').first()).not.toHaveAttribute('data-running', 'true', { timeout: 5000 })
  await expect(page.locator('.running-badge')).toHaveText('idle')
})

test('a devamp aimed at a cue that is not vamping says so', async () => {
  // The cue plays once and is over before the devamp can be fired, so there is nothing
  // to release — and that is reported rather than passed off as a release.
  await addDevamp('Playoff')
  // Adding it selected it; firing goes through the row, so the inspector follows the
  // show rather than the other way round.
  const devampRow = page.locator('.cue-row', { hasText: 'Devamp' })
  await devampRow.click()
  await page.getByRole('button', { name: /GO/ }).click()

  await devampRow.click()
  await page.locator('.inspector-tab', { hasText: 'Devamp' }).click()
  await expect(page.locator('.last-run-badge')).toHaveText('failed')
  await expect(page.locator('.last-run-error')).toContainText('not looping')
})
