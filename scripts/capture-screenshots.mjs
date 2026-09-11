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
// The capture is pinned to CSS pixels, so the figures are the same size whichever
// display the script runs on.
import { _electron as electron } from '@playwright/test'
import { Client } from 'node-osc'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

/* ── Capture ─────────────────────────────────────────────────────────────── */

const app = await electron.launch({ args: [appEntry] })
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

console.log('Capturing to website/assets/guide:')

await selectCue('Walk-in Music')
await shot('01-window.png')

await shot('02-cue-list.png', '.cue-list-container')

await openTab('Audio')
await shot('03-inspector-audio.png', '.inspector')

await openTab('Basics')
await shot('04-inspector-basics.png', '.inspector')

// Run the network cue first so the inspector shows a populated Last Run section.
// GO advances the selection, so re-select the cue before capturing.
await selectCue('Trigger Video')
await openTab('Network')
await page.getByRole('button', { name: /GO/ }).click()
await selectCue('Trigger Video')
await openTab('Network')
await page.locator('.last-run-badge').waitFor()
await shot('05-inspector-network.png', '.inspector')

await selectCue('House Lights')
await openTab('Script')
await page.getByRole('button', { name: /GO/ }).click()
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
await page.evaluate(() => document.documentElement.style.setProperty('--h-log', '340px'))
await new Promise(resolve => server.close(resolve))
await selectCue('Trigger Video')
await page.getByRole('button', { name: /GO/ }).click()
await page.locator('.log-row[data-level="error"]').waitFor()
await shot('08-run-log.png', '.log-panel')
await page.locator('.btn-log').click()

await page.keyboard.press('Control+,')
await page.locator('.settings-dialog').waitFor()
await shot('09-settings.png', '.settings-dialog')
await page.keyboard.press('Escape')

await page.locator('.cue-row', { hasText: 'Count 8' }).click({ button: 'right' })
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
await page.locator('.monitor-event[data-kind="osc"]').first().waitFor()
await shot('12-show-monitor.png', '.monitor-panel')
await page.locator('.btn-monitor').click()
await client.close()

// The wireless panel with the demo rack, so the figure shows a plot with a pack in
// trouble rather than an empty table. Twelve packs need more height than the strip
// holds by default.
await page.evaluate(() => document.documentElement.style.setProperty('--h-rf', '430px'))
await page.locator('.btn-rf').click()
await page.locator('.rf-panel').waitFor()
await page.locator('.rf-demo-btn').click()
await page.locator('.rf-row[data-state="critical"]').waitFor()
await shot('13-wireless.png', '.rf-panel')

// The editor, with a swap made so the figure shows the record rather than an empty list.
await page.locator('.rf-edit').click()
await page.locator('.plot-dialog').waitFor()
await page.locator('.plot-pack-row').first().locator('.plot-pack-performer').selectOption({ index: 2 })
await page.locator('.plot-swaps').waitFor()
await shot('16-plot.png', '.plot-dialog')
await page.locator('.plot-close').click()

// And the report the same session leaves behind.
await page.locator('.rf-mode').click()
await page.locator('.rf-report-row').first().waitFor()
await shot('17-report.png', '.rf-panel')
await page.locator('.rf-mode').click()
await page.locator('.rf-btn', { hasText: '✕' }).click()

// Triggers live on the Basics tab, under the fields every cue shares.
await selectCue('Walk-in Music')
await page.locator('#trigger-osc-address').fill('/eos/cue/12/fire')
await page.locator('.trigger-section[data-kind="osc"] .trigger-add').click()
await page.locator('.trigger-row[data-kind="osc"]').waitFor()
await shot('14-triggers.png', '.inspector')

// The script panel, with a cue pinned to the line it fires on. The picker is the OS's,
// so it is answered directly and everything after it — reading the file, rendering the
// lines, pinning the cue — happens for real.
const scriptPath = path.join(os.tmpdir(), 'winslab-guide-script.txt')
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
await page.evaluate(() => document.documentElement.style.setProperty('--h-script', '430px'))
await shot('15-script.png', '.script-panel')

// The desk side of the plot: scenes, and the groups they drive. The group is pointed at a
// local port so the figure shows a real message rather than a delivery failure.
await page.locator('.btn-scenes').click()
await page.locator('.scenes-edit-btn').click()
const sceneDialog = page.locator('.scene-dialog')
await sceneDialog.locator('.group-add').click()
const groupLabel = sceneDialog.locator('.group-label').first()
await groupLabel.fill('DCA 2 — Ensemble')
await groupLabel.blur()
await sceneDialog.locator('.group-delivery').first().selectOption('osc')
await sceneDialog.locator('.group-host').first().fill('127.0.0.1')
await sceneDialog.locator('.group-osc-port').first().fill('9000')
await sceneDialog.locator('.group-osc-port').first().blur()
await sceneDialog.locator('.group-address').first().fill('/dca/2/mute')
await sceneDialog.locator('.group-address').first().blur()

const openMics = async (from, to) => {
  for (let i = from; i <= to; i++) {
    await sceneDialog.locator('.scene-mic-row').nth(i).locator('.scene-mic-toggle').check()
  }
}
await sceneDialog.locator('.scene-add').click()
const actOne = sceneDialog.locator('.scene-name-input').first()
await actOne.fill('Act One')
await actOne.blur()
await openMics(0, 3)
await sceneDialog.locator('.scene-add').click()
const wedding = sceneDialog.locator('.scene-name-input').nth(1)
await wedding.fill('Wedding')
await wedding.blur()
await openMics(4, 7)
await shot('19-scene-editor.png', '.scene-dialog')
await sceneDialog.locator('.scene-close').click()

// The packs that feed that group, so the figure shows a desk with something on it.
await page.locator('.btn-rf').click()
await page.locator('.rf-edit').click()
const plotDialog = page.locator('.plot-dialog')
for (let i = 0; i < 8; i++) {
  await plotDialog.locator('.plot-pack-desk').nth(i).selectOption({ label: 'DCA 2 — Ensemble' })
}
await plotDialog.locator('.plot-close').click()
await page.locator('.btn-rf').click()
await page.locator('.btn-scenes').click()

await page.locator('.scene-recall').last().click()
await page.locator('.desk-row[data-live="true"]').first().waitFor()
await shot('18-scenes.png', '.scenes-panel')
await page.locator('.scenes-actions .scenes-btn', { hasText: '✕' }).click()

await app.evaluate(({ app: electronApp }) => electronApp.exit(0))
console.log('Done.')
