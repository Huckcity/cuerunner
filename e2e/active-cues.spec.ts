// The Active tab: what is running, each with its own stop, and an audio cue's bar that can be
// dragged to move the playhead of the cue that is actually playing.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page
let root: string

/** Twenty seconds of quiet tone: long enough that a drag across it is a jump worth seeing. */
function writeWav(filePath: string, seconds = 20): void {
  const sampleRate = 48000
  const frames = sampleRate * seconds
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 30) * 4000), 44 + i * 2)
  fs.writeFileSync(filePath, buffer)
}

test.beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-parity-sweep-active-'))
  const media = path.join(root, 'bed.wav')
  writeWav(media)
  const showPath = path.join(root, 'Active.cuerunner')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1,
    id: 'w-active',
    name: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [{
      id: 'a1', number: '1', name: 'Bed', type: 'audio',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
      duration: 0, advance: 'none', isArmed: true, notes: '',
      filePath: media,
      startTime: 0, endTime: null, fadeInDuration: 0,
      volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
    }]
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  ;({ app, page } = await launchApp({ userDataDir }))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Active.cuerunner' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Bed' }).locator('.col-dur')).toHaveText('20.0s')
})

test.afterEach(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

/** The time left on the active row, in seconds, read off its "−m:ss.t". */
async function remainingSeconds(): Promise<number> {
  const text = (await page.locator('.active-row[data-type="audio"] .active-time').textContent()) ?? ''
  const match = /−(\d+):(\d+(?:\.\d)?)/.exec(text)
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN
}

test('lists what is running, and dragging an audio cue’s bar moves its playhead', async () => {
  await page.locator('.dock-tab.btn-active').click()
  await expect(page.locator('.active-panel')).toContainText('Nothing is running')

  // A wait beside the music, so the panel is shown holding more than one thing.
  await toolbarCueBtn(page, 'Wait').click()
  // Long enough to outlast the test, so the row that is left at the end is still running.
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await page.locator('.field-row', { hasText: 'Duration (s)' }).locator('input').fill('60')
  await page.locator('.cue-row', { hasText: 'Bed' }).click()
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(page.locator('.active-row')).toHaveCount(1)
  // Past the repeat guard's window, so the second press is a press of its own.
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /GO/ }).click()

  await expect(page.locator('.active-row')).toHaveCount(2)
  await expect(page.locator('.active-count')).toHaveText('2 running')
  await expect.poll(remainingSeconds).toBeGreaterThan(15)

  // Take hold of the bar near its start and let go most of the way along.
  const bar = page.locator('.active-row[data-type="audio"] .active-bar')
  await expect(bar).toHaveAttribute('data-scrubbable', 'true')
  const box = (await bar.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()

  // The cue plays on from about 17 s into its 20: three or so left, not fifteen.
  await expect.poll(remainingSeconds).toBeLessThan(5)
  await expect(page.locator('.cue-row', { hasText: 'Bed' })).toHaveAttribute('data-running', 'true')

  // Its own stop takes that cue away and leaves the other running.
  await page.locator('.active-row[data-type="audio"] .active-stop').click()
  await expect(page.locator('.active-row')).toHaveCount(1)
  await expect(page.locator('.active-row')).toHaveAttribute('data-type', 'wait')
  await expect(page.locator('.cue-row', { hasText: 'Bed' })).toHaveAttribute('data-running', 'false')
})
