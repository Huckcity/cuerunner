// A show and its audio as one file, out of the app and back into it.
//
// The two dialogs belong to the OS and cannot be driven, so they are answered in the main
// process — the bundle that gets written, the zip inside it, the unpacked folder and the
// show the app then opens are all real. What this proves is the thing the feature exists
// for: a show that plays on a machine that has never seen its media.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, mintLicense, type TestLicense } from './helpers'
// The app's own reader, used here to say *what* differs if two bundles ever do: a bare
// `Buffer.equals` failing says only "not the same file", and this assertion is the one
// that would have to explain itself on a runner nobody can log into.
import { readZip, readZipEntry } from '../src/main/workspace/zip'

let app: ElectronApplication | undefined
let root: string
let showPath: string
let bundled: string
let unpacked: string

function audioCue(id: string, number: string, name: string, filePath: string): unknown {
  return {
    id,
    number,
    name,
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 500,
    advance: 'none',
    isArmed: true,
    notes: '',
    type: 'audio',
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 0
  }
}

function writeWav(filePath: string, tone: number): void {
  const sampleRate = 48000
  const frames = sampleRate / 2
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  buffer.fill(tone, 44)
  fs.writeFileSync(filePath, buffer)
}

async function start(options: { license?: TestLicense } = {}): Promise<Page> {
  const userDataDir = path.join(root, `userdata-${options.license ? 'pro' : 'free'}`)
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))
  const launched = await launchApp({ ...options, userDataDir })
  app = launched.app
  return launched.page
}

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-bundle-'))
  fs.mkdirSync(path.join(root, 'music'))
  writeWav(path.join(root, 'music', 'walk-in.wav'), 11)
  writeWav(path.join(root, 'music', 'bows.wav'), 22)

  showPath = path.join(root, 'Press Night.wlab')
  fs.writeFileSync(
    showPath,
    `${JSON.stringify(
      {
        version: 1,
        id: 'w-press-night',
        name: 'Press Night',
        createdAt: '2026-01-01T00:00:00.000Z',
        audioSettings: { outputDeviceId: 'default' },
        midiSettings: { outputPortName: '' },
        cues: [
          audioCue('a1', '1', 'Walk-in Music', path.join(root, 'music', 'walk-in.wav')),
          audioCue('a2', '2', 'Bows', path.join(root, 'music', 'bows.wav'))
        ]
      },
      null,
      2
    )}\n`
  )

  bundled = path.join(root, 'Press Night.wlabx')
  unpacked = path.join(root, 'handover')
})

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

async function openShow(page: Page): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Press Night.wlab' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
}

/** An archive as content rather than as bytes: its entries, and the show it carries. */
async function archiveContent(file: string): Promise<{ entries: string[]; show: string }> {
  const entries = await readZip(file)
  const show = entries.find(entry => entry.name === 'show.wlab')
  return {
    entries: entries.map(entry => `${entry.name} ${entry.size} ${entry.crc}`),
    show: show ? (await readZipEntry(file, show)).toString('latin1') : ''
  }
}

/**
 * A bundle is finished when its own end record is in the file — the writer creates the
 * file before it writes anything into it, so "the file exists" says nothing about whether
 * there is an archive in it yet, and a spec that reads too early reads half of one. This
 * app writes no archive comment, so the record is the last twenty-two bytes.
 */
async function waitForBundle(file: string): Promise<void> {
  await expect.poll(() => {
    if (!fs.existsSync(file)) return 'not yet'
    const size = fs.statSync(file).size
    if (size < 22) return 'being written'
    const end = Buffer.alloc(4)
    const handle = fs.openSync(file, 'r')
    try {
      fs.readSync(handle, end, 0, 4, size - 22)
    } finally {
      fs.closeSync(handle)
    }
    return end.toString('latin1') === 'PK\u0005\u0006' ? 'done' : 'being written'
  }, { message: 'the bundle to be finished' }).toBe('done')
}

async function exportTo(page: Page, target: string): Promise<void> {
  await app!.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="export-bundle"]').click()
}

test('a show and its audio leave as one file and come back playable', async () => {
  test.setTimeout(120_000)
  const page = await start({ license: mintLicense() })
  await openShow(page)

  await exportTo(page, bundled)
  await waitForBundle(bundled)
  // It is a zip, which is what an operator's laptop can open without this app.
  expect(fs.readFileSync(bundled).subarray(0, 2).toString()).toBe('PK')

  // The same show can be bundled again — a second export over the same show is the
  // operator pressing the menu item twice, not a new artifact. That the two files are
  // byte-identical given the *same* show is `src/main/workspace/bundle.test.ts`, where the
  // workspace is a fixed value; asserting it here would be asserting that a running app
  // stops measuring its own media, which is not a promise it can make — the length and
  // silence scans land in the cues when they finish.
  // The same show bundled twice is the same file: a bundle can be kept, compared, hashed.
  // The content is compared first, so a failure says which entry differs and by how much
  // rather than only that the two files are not equal.
  const again = path.join(root, 'Press Night again.wlabx')
  await exportTo(page, again)
  await waitForBundle(again)
  expect(await archiveContent(again)).toEqual(await archiveContent(bundled))
  expect(fs.readFileSync(again).equals(fs.readFileSync(bundled))).toBe(true)

  // Now the handover: unpack the bundle into a folder, and open what comes out.
  fs.mkdirSync(unpacked, { recursive: true })
  await app!.evaluate(async ({ dialog }, [bundlePath, folder]) => {
    let call = 0
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [call++ === 0 ? bundlePath : folder]
    })
  }, [bundled, unpacked])
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="import-bundle"]').click()

  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
  await expect(page.locator('.cue-row', { hasText: 'Bows' })).toBeVisible()
  // Nothing is missing, so the app says nothing about missing media.
  await expect(page.locator('.missing-media-bar')).toHaveCount(0)

  // The show arrived with its audio, and the paths in it point at what was unpacked.
  const unpackedShow = path.join(unpacked, 'Press Night.wlab')
  expect(fs.existsSync(unpackedShow)).toBe(true)
  expect(fs.existsSync(path.join(unpacked, 'media', 'walk-in.wav'))).toBe(true)
  expect(fs.existsSync(path.join(unpacked, 'media', 'bows.wav'))).toBe(true)
  const stored = JSON.parse(fs.readFileSync(unpackedShow, 'utf-8')) as {
    cues: Array<{ media: { path: string } }>
  }
  expect(stored.cues.map(cue => cue.media.path)).toEqual(['media/walk-in.wav', 'media/bows.wav'])
})

test('a machine with no key is told what a bundle is for, and bundles nothing', async () => {
  const page = await start()
  await openShow(page)

  await page.locator('.toolbar-brand').click()
  await expect(page.locator('.file-menu button[data-action="export-bundle"] .pro-mark')).toHaveCount(1)
  await page.locator('.file-menu button[data-action="export-bundle"]').click()

  await expect(page.locator('.app-notice')).toContainText('WinsLab Pro is required')
  expect(fs.existsSync(bundled)).toBe(false)
})
