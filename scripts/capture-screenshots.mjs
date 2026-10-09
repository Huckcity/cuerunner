#!/usr/bin/env node
// Regenerates the screenshots used by the user guide (website/guide.html).
//
//   npm run build && npm run screenshots
//
// Launches the built app, opens the demo workspace that ships with it, drives the UI,
// and writes PNGs into website/assets/guide/. Images are captured from the real app
// showing the real demo, so neither the guide nor the demo can drift from the product;
// re-run after any UI change.
//
// The capture is pinned to CSS pixels and runs on a display of its own (see
// scripts/virtual-display.mjs), so the figures are the same whichever desk it was started
// from — and no window appears on that desk while it runs.
import { _electron as electron } from '@playwright/test'
import { generateKeyPairSync } from 'node:crypto'
import { Client } from 'node-osc'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLicense } from '../src/main/license/key.ts'
import { underVirtualDisplay } from './virtual-display.mjs'

// Before anything is launched: on Linux this re-runs the script under Xvfb, so the windows
// this capture drives are on a display nobody is looking at rather than on the desk of
// whoever started it.
await underVirtualDisplay()

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appEntry = path.join(root, 'out/main/index.js')
const outDir = path.join(root, 'website/assets/guide')

if (!fs.existsSync(appEntry)) {
  console.error(`No build at ${appEntry}. Run: npm run build`)
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })

/* ── Network cue target ──────────────────────────────────────────────────── */

// The demo's network cue posts to this address, so the guide can show a real 200
// response rather than a failure. 8080 is the port the bundled cue names.
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  req.resume()
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
  })
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(8080, '127.0.0.1', resolve)
})

/* ── License ─────────────────────────────────────────────────────────────── */

// Most of the figures in the guide are Pro surfaces — the monitor, the wireless panel, the
// mic plot, the script, the scenes view — so the capture runs on a license of its own: a
// throwaway pair minted here, a key signed with it, and the development-only public-key
// override that a packaged build ignores. The app is given a private user-data directory
// for the run, so the operator's own license is never read, written or shown.
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-shots-'))
fs.writeFileSync(
  path.join(userDataDir, 'license.key'),
  createLicense(
    {
      v: 1,
      id: 'CRN-SHOT01',
      licensee: 'Guide Screenshots',
      issued: new Date().toISOString().slice(0, 10)
    },
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  ),
  'utf-8'
)

/* ── Capture ─────────────────────────────────────────────────────────────── */

const app = await electron.launch({
  // Electron 28+ picks a Wayland session's compositor and ignores DISPLAY, so the pin
  // goes on the command line — the only lever that works — and the capture runs under
  // Xvfb: a virtual X server nobody is looking at. Same reason e2e/helpers.ts pins it.
  args: [appEntry, `--user-data-dir=${userDataDir}`, '--ozone-platform=x11'],
  env: {
    ...process.env,
    CUERUNNER_LICENSE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')

// Open the demo workspace that ships with the app, the way a user would.
await page.locator('.toolbar-brand').click()
await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
await page.locator('.cue-row', { hasText: 'Walk-in Music' }).waitFor()

const shot = async (file, selector) => {
  const target = selector ? page.locator(selector) : page
  // 'css' pins the output to CSS pixels: the app fixes its window size, so the figures
  // come out the same size whichever display they were captured on.
  await target.screenshot({ path: path.join(outDir, file), scale: 'css' })
  console.log(`  ${file}`)
}

const selectCue = async name => {
  await page.locator('.cue-row', { hasText: name }).first().click()
}

const openTab = async name => {
  await page.locator('.inspector-tab', { hasText: name }).click()
}

// GO, with the repeat guard respected. Two presses inside the guard window (Settings →
// General, 300 ms by default) are one firing as far as the app is concerned — which is
// the point of it, and which quietly lost the second cue this script fired when the two
// GOs were a couple of hundred milliseconds apart.
const REPEAT_GUARD_MS = 300
let lastGo = 0
const go = async () => {
  const since = Date.now() - lastGo
  if (since < REPEAT_GUARD_MS + 100) await page.waitForTimeout(REPEAT_GUARD_MS + 100 - since)
  await page.getByRole('button', { name: /GO/ }).click()
  lastGo = Date.now()
}

console.log('Capturing to website/assets/guide:')

// The window with the show actually running: the bar under the toolbar answers two
// questions, and a figure with nothing playing only shows one of them. GO also moves the
// selection on, so the inspector in this figure is the next cue's — which is the pairing
// an operator sees mid-show.
await selectCue('Walk-in Music')
await go()
await page.locator('.ctx-live .ctx-name').waitFor()
await shot('01-window.png')

await shot('02-cue-list.png', '.cue-list-container')

// Back to a quiet show, and back on the audio cue, for the panels that follow.
await page.getByRole('button', { name: /STOP/ }).click()
await selectCue('Walk-in Music')

await openTab('Audio')
await shot('03-inspector-audio.png', '.inspector')

await openTab('Basics')
await shot('04-inspector-basics.png', '.inspector')

// Run the network cue first so the inspector shows a populated Last Run section.
// GO advances the selection, so re-select the cue before capturing.
await selectCue('Trigger Video')
await openTab('Network')
await go()
await selectCue('Trigger Video')
await openTab('Network')
await page.locator('.last-run-badge').waitFor()
await shot('05-inspector-network.png', '.inspector')

await selectCue('House Lights')
await openTab('Script')
await go()
await selectCue('House Lights')
await openTab('Script')
await page.locator('.last-run-badge').waitFor()
await shot('06-inspector-script.png', '.inspector')

await selectCue('End of Show')
await openTab('Stop')
await shot('11-inspector-stop.png', '.inspector')

await selectCue('Walk-out')
await page.locator('.timeline-panel').waitFor()
// Default zoom is 5px/s — too tight to read the cue spacing.
for (let i = 0; i < 3; i++) await page.locator('.tl-zoom-btn', { hasText: '+' }).click()
await shot('07-timeline.png', '.timeline-panel')

// The panel scrolls; give it more room for the figure. Then show what a failure
// looks like by firing the same cue with nothing listening.
await page.locator('.btn-log').click()
await page.evaluate(() => (document.querySelector('.dock').style.height = '340px'))
await new Promise(resolve => server.close(resolve))
await selectCue('Trigger Video')
await go()
await page.locator('.log-row[data-level="error"]').waitFor()
await shot('08-run-log.png', '.log-panel')
await page.locator('.btn-log').click()

await page.keyboard.press('Control+,')
await page.locator('.settings-dialog').waitFor()
await shot('09-settings.png', '.settings-dialog')
await page.keyboard.press('Escape')

// The cue list closes its context menu on any scroll, and a click scrolls the row into
// view on the way in — so the row is brought into view first, and the list left a moment
// to settle, so that the press itself is not a scroll.
const contextRow = page.locator('.cue-row', { hasText: 'Count 8' })
await contextRow.scrollIntoViewIfNeeded()
await page.waitForTimeout(250)
await contextRow.click({ button: 'right' })
await page.locator('.cue-context-menu').waitFor()
await shot('10-context-menu.png', '.cue-context-menu')
await page.keyboard.press('Escape')

// ── Show services ─────────────────────────────────────────────────────────
// The monitor with something in it: a desk sending OSC to the app, which is what the
// panel exists to show.
const client = new Client('127.0.0.1', 53000)
client.send('/eos/cue/12/fire')
client.send('/mixer/fader', 3, -6.5)
client.send('/rf/pack12/battery', 42)

await page.locator('.btn-monitor').click()
await page.locator('.monitor-service[data-state="running"]').first().waitFor()
await shot('12-show-monitor.png', '.monitor-panel')
await page.locator('.btn-monitor').click()
await client.close()

// The wireless panel with the demo rack, so the figure shows a plot with a pack in
// trouble rather than an empty table. Twelve packs need more height than the dock
// holds by default.
await page.evaluate(() => (document.querySelector('.dock').style.height = '430px'))
await page.locator('.btn-rf').click()
await page.locator('.rf-panel').waitFor()
await page.locator('.rf-demo-btn').click()
await page.locator('.rf-row[data-state="critical"]').waitFor()
await shot('13-wireless.png', '.rf-panel')

// The plot, with a swap made so the figure shows the record rather than an empty list.
// The plot is a tab of Show Settings rather than a dialog of its own — a pack assignment
// is show content, and everything that edits the show's setup is edited in one place — so
// the panel's Edit button opens the dialog on that tab.
await page.locator('.rf-edit').click()
await page.locator('.show-settings-dialog').waitFor()
await page.locator('.plot-pack-row').first().locator('.plot-pack-performer').selectOption({ index: 2 })
await page.locator('.plot-swaps').waitFor()
await shot('16-plot.png', '.show-settings-dialog')
await page.locator('.show-settings-close').click()

// And the report the same session leaves behind.
await page.locator('.rf-mode').click()
await page.locator('.rf-report-row').first().waitFor()
await shot('17-report.png', '.rf-panel')
await page.locator('.rf-mode').click()
await page.locator('.rf-btn', { hasText: '✕' }).click()

// Triggers have a tab of their own, after the cue's type.
await selectCue('Walk-in Music')
await openTab('Triggers')
await page.locator('#trigger-osc-address').fill('/eos/cue/12/fire')
await page.locator('.trigger-section[data-kind="osc"] .trigger-add').click()
await page.locator('.trigger-row[data-kind="osc"]').waitFor()
await shot('14-triggers.png', '.inspector')

// Slices on the waveform: the demo's Scene Change cut where an operator cuts it — on its
// waveform, a marker at a time — with a slice played twice, a vamp and a skipped bar, and a
// devamp aimed at it. Then it is fired, and the figure is taken while the vamp holds, so it
// shows the lit slice counting its passes and the header naming the devamp that lets it go.
await selectCue('Scene Change')
await page.evaluate(() => (document.querySelector('.dock').style.height = '220px'))
await page.locator('.waveform-canvas[style*="opacity: 1"]').waitFor()
const stage = page.locator('.waveform-stage')
for (const fraction of [0.15, 0.35, 0.55, 0.75]) {
  const box = await stage.boundingBox()
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height * 0.65)
  await page.keyboard.press('m')
}
await page.locator('.slice-marker-grip[data-marker="3"]').waitFor()
for (const [piece, count] of [[1, 2], [2, -1], [3, 0]]) {
  await page.locator('.slice-region').nth(piece).click()
  await page.locator(`.slice-count-chooser [data-count="${count}"]`).click()
}
await page.locator('.toolbar-more-btn').click()
await page.locator('.toolbar-more-menu-item', { hasText: /^\s*Devamp\s*$/ }).click()
await openTab('Devamp')
const release = page.locator('.field-row', { hasText: 'Release' }).locator('select')
await release.selectOption(await release.locator('option', { hasText: 'Scene Change' }).first().getAttribute('value'))
await selectCue('Scene Change')
await go()
await selectCue('Scene Change')
await page.locator('.waveform-vamp-tag[data-pass="2"]').waitFor({ timeout: 10_000 })
await shot('20-slices.png', '.waveform-panel')
await page.getByRole('button', { name: /STOP/ }).click()

// The script panel, with a cue pinned to the line it fires on. The picker is the OS's,
// so it is answered directly and everything after it — reading the file, rendering the
// lines, pinning the cue — happens for real.
const scriptPath = path.join(os.tmpdir(), 'cuerunner-guide-script.txt')
fs.writeFileSync(scriptPath, [
  'ACT ONE',
  '',
  'The house lights dim. WALK-IN MUSIC under.',
  '',
  'ALDonza enters downstage left, dragging the chair.',
  '',
  'SANCHO: I am Sancho Panza, and this is my master.',
  '',
  'The windmill turns. LIGHTING: cue 12 on "master".'
].join('\n'))
await app.evaluate(async ({ dialog }, picked) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
}, scriptPath)
await page.locator('.btn-script').click()
await page.locator('.script-choose').click()
await page.locator('.script-line').first().waitFor()
await page.locator('.script-line[data-line="5"] .script-line-no').click()
await page.locator('.script-pin').waitFor()
await page.evaluate(() => (document.querySelector('.dock').style.height = '430px'))
await shot('15-script.png', '.script-panel')
// The dock gives the window back: the scenes view wants all of it.
await page.locator('.btn-script').click()

// The scenes view: the show as a matrix, run and edited in place. The demo ships its two
// scenes — Act One and Wedding, four faders each — so the figure is the show the demo opens
// on: nothing has to be built for the grid to have something in it, and the one thing this
// capture does build is the ensemble at the end.
await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
await page.locator('.scenes-view').waitFor()
// The view opens to run the show; building one is an Edit away.
await page.locator('.matrix-lock, .matrix-empty-action').first().click()

// A fader is its number, and the row is found by that number exactly: "1" is also the
// first character of "10".
const rowFor = (fader) =>
  page.locator('.matrix-row', { has: page.locator(`.matrix-fader:text-is("${fader}")`) })

// The first scene recalled, so the header says where the desk is and what is coming, and
// the column the desk is on is the one the figure shows lit.
await page.locator('.matrix-scene[data-scene-id] .matrix-recall').first().click()
await page.locator('.matrix-scene[data-scene-id][data-current="true"]').waitFor()

// The other half of building a scene: the strips picked in the builder, kept as one group on
// the row — what a later scene puts there with one press instead of a row of picks. The
// group replaces what the row held, because a row holds one thing. A cell is pressed either
// way: a row holding nothing is a blank box, a row holding something is that name — and the
// name is the one the strip was given, or the performer cast on it, which is what the
// builder's lists offer.
await rowFor(1).locator('.matrix-cell').nth(0)
  .locator('.matrix-cell-add, .matrix-block-name').first().click()
await page.locator('.scene-picker')
  .getByRole('button', { name: 'Ensemble…', exact: true }).click()
const builder = page.getByRole('dialog', { name: 'New ensemble' })
await builder.locator('.ensemble-name-field').fill('Principals')
for (const strip of ['Aldonza', 'Sancho']) {
  await builder.locator('[data-pane="free"]').getByRole('button', { name: strip, exact: true }).click()
  await builder.locator('.ensemble-move').first().click()
}
await builder.getByRole('button', { name: 'Create and apply' }).click()
await builder.waitFor({ state: 'detached' })
await page.locator('.matrix-block[data-kind="ensemble"]').first().waitFor()

// The grid is taller than the window's default by one row, and a screenshot cannot
// scroll: the window is grown by that much so all twelve faders are in the figure rather
// than eleven and a caption that claims twelve.
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].setContentSize(1280, 800)
})
await page.waitForTimeout(150)

await shot('18-scenes.png', '.scenes-view')

// Show Settings on its Channels tab: the desk the show drives, the strips on the console
// and the faders a scene can place them on. The tab is longer than the box a window of this size
// gives a dialog, so the window is grown to the height the list wants before the shot:
// the dialog is sized from the window, and a scrolled screenshot would leave either the
// desk block or the DCAs below the fold.
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].setContentSize(1280, 1800)
})
await page.locator('.toolbar-brand').click()
await page.locator('.file-menu button[data-action="show-settings"]').click()
await page.locator('.show-settings-dialog').waitFor()

// Name the first strips the way the cast list does, so the console reads as a desk with
// somebody on it rather than as twelve empty fields.
const nameChannel = async (index, name) => {
  const field = page.locator('.channel-row').nth(index).locator('.channel-name')
  await field.fill(name)
  await field.blur()
}
await nameChannel(0, 'Aldonza')
await nameChannel(1, 'Sancho')
await nameChannel(2, 'Cervantes')
await nameChannel(3, 'Pedro')

// The faders those strips now ride are placed in the Scenes view — a strip is a name and
// a number, and which fader it rides is the scene's — so the rows read back the scenes
// that place channels on them rather than a routing chosen here.
await page.locator('.dca-row').first().locator('.dca-carrying', { hasText: 'place' }).waitFor()
await shot('19-show-settings.png', '.show-settings-dialog')
await page.locator('.show-settings-close').click()

await page.locator('.toolbar-view-btn', { hasText: 'Cues' }).click()

await app.evaluate(({ app: electronApp }) => electronApp.exit(0))
fs.rmSync(userDataDir, { recursive: true, force: true })
console.log('Done.')
