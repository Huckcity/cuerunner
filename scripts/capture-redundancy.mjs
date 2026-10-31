#!/usr/bin/env node
// Regenerates the walkthrough for redundant playback (website/redundancy.html): the
// figures, and the clip of the pair itself.
//
//   npm run build && npm run screenshots:redundancy
//
// Two machines are what this feature is, so two copies of the built app are launched
// here — one set to run the show and one to stand by for it — against a workspace and a
// track this script writes, each with its own user-data directory (the role and the
// partner's address are kept with the machine, not with the show). The show is fired, the
// machine running it is closed the way a machine in a rack goes down, and what the backup
// does about it is captured as it happens: the alarm, the takeover, the run log, and the
// cue that comes back where it left off rather than at the top.
//
// Images come from the real app in the state being described, so neither the page nor the
// product can drift from the other; re-run after any UI change. The clip is recorded from
// both windows at once and stacked side by side, so what the page claims about the pair
// can be watched happening on both machines.
//
// The capture is pinned to the window's own size, and runs on a display of its own (see
// scripts/virtual-display.mjs), so the figures are the same whichever desk it was started
// from and no window appears on that desk while it runs. Figures come out at the size the
// app draws them — a dialog 520 pixels wide, the window 1280 — and the page shows each one
// at that size rather than blowing it up.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeApp, launchApp, openFromRecent } from '../e2e/helpers.ts'
import { underVirtualDisplay } from './virtual-display.mjs'

// Before anything is launched: on Linux this re-runs the script under Xvfb, so the windows
// this capture drives are on a display nobody is looking at rather than on the desk of
// whoever started it.
await underVirtualDisplay()

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appEntry = path.join(root, 'out/main/index.js')
const outDir = path.join(root, 'website/assets/redundancy')

if (!fs.existsSync(appEntry)) {
  console.error(`No build at ${appEntry}. Run: npm run build`)
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })

/* ── The show both machines will have open ───────────────────────────────── */

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-redundancy-shots-'))
const track = path.join(work, 'overture.wav')
const showPath = path.join(work, 'Redundancy Demo.cuerunner')
const SHOW_ID = 'w-redundancy-demo'

/** A WAV of an exact length: what the cue plays, written here rather than shipped. */
function writeWav(filePath, seconds) {
  const sampleRate = 48000
  const frames = seconds * sampleRate
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let frame = 0; frame < frames; frame++) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 12000), 44 + frame * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

writeWav(track, 30)
fs.writeFileSync(showPath, JSON.stringify({
  version: 1,
  id: SHOW_ID,
  name: 'Redundancy Demo',
  createdAt: '2026-01-01T00:00:00.000Z',
  audioSettings: { outputDeviceId: 'default' },
  midiSettings: { outputPortName: '' },
  cues: [
    {
      id: 'a1', number: '1', name: 'Walk-in Music', type: 'audio', colorLabel: 'blue',
      parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 30_000,
      advance: 'none', isArmed: true, notes: '', filePath: track, startTime: 0, endTime: null,
      fadeInDuration: 0, volume: 1, pan: 0, outputs: null, loopCount: -1, playbackRate: 1, trim: 1
    },
    {
      id: 'a2', number: '2', name: 'Entrance', type: 'audio', colorLabel: 'amber',
      parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 30_000,
      advance: 'none', isArmed: true, notes: '', filePath: track, startTime: 0, endTime: 12_000,
      fadeInDuration: 0, volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
    }
  ]
}))

/* ── The two machines ────────────────────────────────────────────────────── */

const liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-redundancy-live-'))
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-redundancy-backup-'))
const livePort = 53110
const backupPort = 53111
const TOKEN = 'stage-left'

for (const [dir, settings] of [
  [liveDir, {
    enabled: true, name: 'desk-live', id: 'id-live', role: 'live', port: livePort,
    peerHost: '127.0.0.1', peerPort: backupPort, token: TOKEN, timeoutMs: 3000, takeover: 'manual'
  }],
  [backupDir, {
    enabled: true, name: 'desk-backup', id: 'id-backup', role: 'standby', port: backupPort,
    peerHost: '127.0.0.1', peerPort: livePort, token: TOKEN, timeoutMs: 3000, takeover: 'auto'
  }]
]) {
  fs.writeFileSync(path.join(dir, 'redundancy.json'), JSON.stringify(settings, null, 2))
}

/* ── Capture ─────────────────────────────────────────────────────────────── */

// The apps are launched and closed the way the e2e suite launches and closes them, from
// e2e/helpers.ts, so standing a pair up has one implementation rather than two; the
// capture adds only what is its own — the workspace, the machines' settings, and the
// frames. Both are shut down through one path, because a capture that fails half way must
// not leave two windows behind for whoever started it to find.
let liveApp = null
let live = null
let backupApp = null
let backup = null

async function capture() {
  // Both machines are stood up the way the e2e suite stands one up, from e2e/helpers.ts:
  // the same arguments, the same ozone pin, the same silent backend
  // handling. A capture that launched its own app would be a second implementation of the
  // thing the suite already owns, and the two would drift.
  ;({ app: liveApp, page: live } = await launchApp({ userDataDir: liveDir }))
  ;({ app: backupApp, page: backup } = await launchApp({ userDataDir: backupDir }))

  // And the show is opened the way a user opens it — through the recents list the file
  // menu shows — rather than by a script reaching into the store.
  await openFromRecent(live, liveDir, showPath)
  await openFromRecent(backup, backupDir, showPath)
  await live.locator('.cue-row', { hasText: 'Walk-in Music' }).waitFor({ timeout: 15_000 })
  await backup.locator('.cue-row', { hasText: 'Walk-in Music' }).waitFor({ timeout: 15_000 })

  const shot = async (page, file, selector) => {
    const target = page.locator(selector).first()
    await target.waitFor({ timeout: 15_000 })
    await page.waitForTimeout(250)
    await target.screenshot({ path: path.join(outDir, file) })
    console.log(`  ${file}`)
  }

  /** Settings on the Backup machine tab: this machine's half of the pair, and the status. */
  async function openRedundancyTab(page, { tall = 1180 } = {}) {
    // Through the menu rather than the accelerator: this is the door a user comes in by,
    // and it is the one the e2e suite uses for the same reason.
    await page.locator('.toolbar-brand').click()
    await page.locator('.file-menu [data-action="settings"]').click()
    const dialog = page.locator('.settings-dialog')
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Backup machine', exact: true }).click()
    // The tab is taller than the box a window of this size gives a dialog, and a figure
    // that scrolls would leave either the settings or the status below the fold.
    await page.setViewportSize({ width: 1280, height: tall })
    await dialog.locator('.redundancy-status, .inspector-hint').first().waitFor()
    await page.waitForTimeout(300)
    return dialog
  }

  const closeDialog = async page => {
    await page.locator('.settings-dialog').getByRole('button', { name: 'Close' }).click()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(150)
  }

  /* ── 1. What the machine that runs the show is set to ────────────────────── */

  const liveDialog = await openRedundancyTab(live)
  await shot(live, '01-settings-live.png', '.settings-dialog')
  await liveDialog.getByRole('button', { name: 'Close' }).click()
  await live.setViewportSize({ width: 1280, height: 800 })

  /* ── 2. The same tab on the machine standing by, once the two have met ───── */

  // The pair finds each other while the show stands still, and the two halves say which
  // one each is. The backup's tab is the one that matters: it is the machine nobody is
  // looking at until it is needed.
  await backup.waitForTimeout(1500)
  const backupDialog = await openRedundancyTab(backup)
  await shot(backup, '02-settings-standby.png', '.settings-dialog')
  await shot(backup, '03-status.png', '.redundancy-status')

  /* ── 3. The show, running on the machine that drives it ──────────────────── */

  await closeDialog(backup)
  await live.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await live.getByRole('button', { name: /GO/ }).click()
  await live.waitForTimeout(2500)
  await shot(live, '04-running-live.png', '.cue-list-container')

  // The backup mirrors it: a cue running on the machine at the other end of the wire, and
  // the media for it warmed in this machine's own engine. This is what the panel says while
  // nothing is wrong — and the tab is opened again for it, because the panel that showed
  // the same machine a moment ago was closed.
  await openRedundancyTab(backup)
  await backup.locator('.redundancy-status').waitFor()
  await backup.waitForTimeout(500)
  await shot(backup, '05-mirror.png', '.redundancy-status')
  await shot(backup, '06-settings-mirror.png', '.settings-dialog')
  await closeDialog(backup)

  /* ── 4. The act itself, photographed frame by frame ──────────────────────── */

  // Playwright's own video recording does not survive an Electron launch — with it on, the
  // window never finishes loading — so the clip is built here instead: the two windows are
  // photographed as fast as the machine will take it, and stacked side by side at the end.
  // That is also the honest way to do it: these are the frames the app actually drew, at
  // real speed, and the speed is measured rather than assumed when they are encoded.
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-redundancy-frames-'))
  const FRAME_MS = 200
  let frames = 0
  let lastLiveFrame = null
  let liveStopped = false
  let shooting = false

  const captureFrame = async () => {
    if (shooting) return
    shooting = true
    try {
      frames += 1
      const index = String(frames).padStart(4, '0')
      if (!liveStopped) {
        lastLiveFrame = await live.screenshot({ animations: 'disabled' })
      }
      if (lastLiveFrame !== null) fs.writeFileSync(path.join(framesDir, `live-${index}.png`), lastLiveFrame)
      const backupShot = await backup.screenshot({ animations: 'disabled' })
      fs.writeFileSync(path.join(framesDir, `backup-${index}.png`), backupShot)
    } catch {
      // A window that is going away mid-frame is not a reason to lose the ones already shot.
    } finally {
      shooting = false
    }
  }

  const frameTimer = setInterval(() => void captureFrame(), FRAME_MS)
  const clipStartedAt = Date.now()

  // The show, running on the machine that drives it, with the machine standing by looking at
  // its own status: which half it is, who it has heard from, and whether the two have the
  // same show open.
  await live.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await live.getByRole('button', { name: /GO/ }).click()
  await live.waitForTimeout(3000)

  await openRedundancyTab(backup, { tall: 800 })
  await backup.locator('.redundancy-status').waitFor()
  await backup.waitForTimeout(3000)

  // The machine running the show goes away the way a machine in a rack goes down: process,
  // socket and sound together, while its cue is playing. Nothing else is touched — no cue is
  // fired by hand, and the show is never reloaded.
  liveStopped = true
  await liveApp.evaluate(({ app }) => app.exit(0)).catch(() => {})
  const stoppedAt = Date.now()

  // The alarm, and then the takeover, both of which happen in the panel on screen.
  await backup.waitForTimeout(Math.max(0, 4200 - (Date.now() - stoppedAt)))
  await backup.locator('.redundancy-line[data-field="machine"]').waitFor()
  await backup.waitForTimeout(2000)

  // And the show, carried on: the dialog is put away and the cue is playing on the machine
  // that was standing by, at the position the mirror had rather than from the top.
  await closeDialog(backup)
  await backup.waitForTimeout(3500)
  clearInterval(frameTimer)
  await captureFrame()
  const clipSeconds = (Date.now() - clipStartedAt) / 1000

  /* ── 5. The clip ─────────────────────────────────────────────────────────── */

  console.log(`  ${frames} frames over ${clipSeconds.toFixed(1)} s`)

  try {
    const out = path.join(outDir, 'pair.mp4')
    // The frame rate is measured rather than assumed, so the clip plays at the speed the
    // capture actually managed: a slow machine makes a slower capture, not a clip that lies
    // about how long the takeover took.
    const fps = Math.max(1, Math.min(10, frames / clipSeconds)).toFixed(2)
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-framerate', fps, '-i', path.join(framesDir, 'live-%04d.png'),
      '-framerate', fps, '-i', path.join(framesDir, 'backup-%04d.png'),
      '-filter_complex',
      '[0:v]scale=1280:800[a];[1:v]scale=1280:800[b];[a][b]hstack=inputs=2,scale=1600:-2[out]',
      '-map', '[out]',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      out
    ])
    console.log(`  pair.mp4 (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB at ${fps} fps)`)

    // A poster frame from the middle of the act, so the page shows the pair before anyone
    // presses play.
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-ss', String(Math.round(frames / fps / 2)), '-i', out,
      '-frames:v', '1', path.join(outDir, 'pair-poster.png')
    ])
    console.log('  pair-poster.png')
  } catch (error) {
    console.error(`  the clip was not produced: ${error.message}`)
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true })
  }

  /* ── 6. What the takeover did, and what it could not ─────────────────────── */

  // The alarm in the monitor, which stays raised: the machine that was running the show has
  // not answered since.
  await backup.locator('.btn-monitor').click()
  const redundancyRow = backup.locator('.monitor-service[data-state="degraded"]', { hasText: 'Redundant playback' })
  await redundancyRow.waitFor()
  // The services column scrolls, and a figure of a panel is no good if the row it is
  // about is below the fold.
  await redundancyRow.scrollIntoViewIfNeeded()
  await backup.waitForTimeout(300)
  await shot(backup, '07-alarm.png', '.monitor-panel')
  await backup.locator('.btn-monitor').click()

  const takenDialog = await openRedundancyTab(backup)
  await takenDialog
    .locator('.redundancy-line[data-field="machine"]', { hasText: 'running the show' })
    .waitFor()
  await shot(backup, '08-took-over.png', '.settings-dialog')
  await closeDialog(backup)

  // What the takeover did, named line by line: what was picked up, what could not be, and
  // how much of the show went by unheard.
  await backup.locator('.btn-log').click()
  await backup.locator('.log-row').first().waitFor()
  await backup.evaluate(() => (document.querySelector('.dock').style.height = '340px'))
  await backup.waitForTimeout(300)
  await shot(backup, '09-run-log.png', '.log-panel')
  await backup.locator('.btn-log').click()

  // And the show itself, carried on: the cue the live machine was playing is playing on
  // this machine's engine, seven seconds in rather than from the top of the file — which
  // is what the waveform's playhead and the clock beside it say. The row it is on is a
  // two-pixel bar at the bottom of the cue list, so the cue is selected and its audio
  // inspector is what the figure shows; the running row is asserted first, so the figure
  // can only be of a cue that really is playing.
  await backup.locator('.cue-row[data-running="true"]').waitFor()
  await backup.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await backup.locator('.inspector-tab', { hasText: 'Audio' }).click()
  await backup.locator('.waveform-panel').waitFor()
  await backup.waitForTimeout(1200)
  await shot(backup, '10-still-running.png', '.waveform-panel')

  await backupApp.close()
}

try {
  await capture()
} finally {
  if (backupApp) await closeApp(backupApp)
  if (liveApp) await closeApp(liveApp)
  fs.rmSync(work, { recursive: true, force: true })
  fs.rmSync(liveDir, { recursive: true, force: true })
  fs.rmSync(backupDir, { recursive: true, force: true })
  console.log('Done.')
}
