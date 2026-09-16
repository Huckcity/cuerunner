// A show is a folder that gets copied to whichever machine is running it. This is the
// whole journey in the real app: a saved show whose media sits beside it, the folder
// moved the way an operator moves one, the app saying exactly what it cannot find, one
// pick in the file dialog putting all of it back, and a save that survives the next
// reopen.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, openFromRecent } from './helpers'

// A real audio file, so everything downstream of the relink — reading metadata, drawing
// a waveform — deals with a file that is actually playable.
const DEMO_AUDIO = path.join(process.cwd(), 'resources/demo/walk-in.wav')

interface MovedShow {
  root: string
  wlab: string
  media: string[]
}

let tempDirs: string[] = []

function audioCue(id: string, number: string, name: string, filePath: string): unknown {
  return {
    id,
    number,
    name,
    type: 'audio',
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    loopCount: 0,
    playbackRate: 1,
    trim: 1
  }
}

/** A saved show with its media beside it, then the whole folder moved like a copied one. */
function movedShow(): MovedShow {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-missing-media-'))
  tempDirs.push(root)
  const before = path.join(root, 'old-machine')
  fs.mkdirSync(path.join(before, 'media'), { recursive: true })
  fs.copyFileSync(DEMO_AUDIO, path.join(before, 'media', 'walk-in.wav'))
  fs.copyFileSync(DEMO_AUDIO, path.join(before, 'media', 'sting.wav'))

  const workspace = {
    version: 1,
    id: 'w-moved',
    name: 'Tour Show',
    createdAt: new Date().toISOString(),
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [
      audioCue('a1', '1', 'Walk-in Music', path.join(before, 'media', 'walk-in.wav')),
      audioCue('a2', '2', 'Sting', path.join(before, 'media', 'sting.wav'))
    ]
  }
  fs.writeFileSync(path.join(before, 'Tour Show.wlab'), JSON.stringify(workspace, null, 2))

  // The copy that arrives on the other machine: no mount point from the old one, and the
  // files the workspace names are simply not there any more.
  const after = path.join(root, 'new-machine')
  fs.renameSync(before, after)
  return {
    root,
    wlab: path.join(after, 'Tour Show.wlab'),
    media: [path.join(after, 'media', 'walk-in.wav'), path.join(after, 'media', 'sting.wav')]
  }
}

test.afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

test('a moved show folder reports its missing media and one pick relinks it', async () => {
  const show = movedShow()
  let { app, page, userDataDir } = await launchApp()

  try {
    await openFromRecent(page, userDataDir, show.wlab)

    // Both files are named by the workspace and neither is where it says.
    const banner = page.locator('.missing-media-bar')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveText(/2 audio files/)

    await page.locator('.missing-media-bar-review').click()
    const rows = page.locator('.missing-media-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: 'Walk-in Music' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'Sting' })).toHaveCount(1)
    // The stored path is shown, not just the cue: it is what tells the operator which
    // copy of the show this is.
    await expect(rows.first().locator('.missing-media-path')).toContainText('media')

    // The file dialog belongs to the OS and cannot be driven; it is answered in the main
    // process, and everything after it — mapping the move, resolving the rest, updating
    // the session — runs for real.
    await app.evaluate(async ({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
    }, show.media[0])
    await page.locator('.missing-media-locate-all').click()

    // One pick accounted for both files.
    await expect(page.locator('.missing-media-bar')).toHaveCount(0)
    await expect(page.locator('.missing-media-dialog')).toHaveCount(0)
    // Relinking changed the show, so it is unsaved.
    await expect(page.locator('.workspace-name')).toContainText('●')

    await page.locator('.toolbar-brand').click()
    await page.locator('.file-menu button[data-action="save"]').click()
    await expect(page.locator('.workspace-name')).not.toContainText('●')

    // The saved file carries both locations per file: relative for the media inside the
    // folder, and the absolute path it is at now.
    const saved = JSON.parse(fs.readFileSync(show.wlab, 'utf-8')) as {
      cues: Array<{ filePath: string; media?: { path: string; originalPath: string } }>
    }
    expect(saved.cues[0].media).toEqual({
      path: path.join('media', 'walk-in.wav'),
      originalPath: show.media[0]
    })
    expect(saved.cues[1].media).toEqual({
      path: path.join('media', 'sting.wav'),
      originalPath: show.media[1]
    })

    // Reopening the saved show — even launched fresh — finds everything.
    await closeApp(app)
    ;({ app, page } = await launchApp({ userDataDir }))
    await openFromRecent(page, userDataDir, show.wlab)
    await expect(page.locator('.cue-row')).toHaveCount(2)
    await expect(page.locator('.missing-media-bar')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('a pick that accounts for nothing else leaves the rest missing', async () => {
  const show = movedShow()
  const { app, page, userDataDir } = await launchApp()

  try {
    // One of the files is moved somewhere unrelated, so mapping the pick does not find
    // the other. Choosing a file must not guess on its behalf.
    const elsewhere = path.join(show.root, 'elsewhere')
    fs.mkdirSync(elsewhere, { recursive: true })
    const lone = path.join(elsewhere, 'walk-in.wav')
    fs.copyFileSync(DEMO_AUDIO, lone)

    await openFromRecent(page, userDataDir, show.wlab)
    await expect(page.locator('.missing-media-bar')).toHaveText(/2 audio files/)

    await app.evaluate(async ({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
    }, lone)
    await page.locator('.missing-media-bar-review').click()
    await page.locator('.missing-media-row', { hasText: 'Walk-in Music' }).locator('.missing-media-locate').click()

    // The picked file is found; the other keeps its last known location and stays
    // visible rather than being written off.
    await expect(page.locator('.missing-media-row')).toHaveCount(1)
    await expect(page.locator('.missing-media-bar')).toHaveText(/One audio file/)
    await expect(page.locator('.missing-media-row .missing-media-path')).toContainText('sting.wav')
  } finally {
    await closeApp(app)
  }
})
