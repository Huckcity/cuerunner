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
import { generateKeyPairSync } from 'node:crypto'
import { Client } from 'node-osc'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLicense } from '../src/main/license/key.ts'

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
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-shots-'))
fs.writeFileSync(
  path.join(userDataDir, 'license.key'),
  createLicense(
    {
      v: 1,
      id: 'WSP-SHOT01',
      licensee: 'Guide Screenshots',
      issued: new Date().toISOString().slice(0, 10)
    },
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  ),
  'utf-8'
)

/* ── Capture ─────────────────────────────────────────────────────────────── */

const app = await electron.launch({
  args: [appEntry, `--user-data-dir=${userDataDir}`],
  env: {
    ...process.env,
    WINSLAB_LICENSE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString()
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
await page.evaluate(() => (document.querySelector('.dock').style.height = '340px'))
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
await page.locator('.monitor-service[data-state="running"]').first().waitFor()
await shot('12-show-monitor.png', '.monitor-panel')
await page.locator('.btn-monitor').click()
await client.close()

// The wireless panel with the demo rack, so the figure shows a plot with a pack in
// trouble rather than an empty table. Twelve packs need more height than the strip
// holds by default.
await page.evaluate(() => (document.querySelector('.dock').style.height = '430px'))
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

// Triggers have a tab of their own, after the cue's type.
await selectCue('Walk-in Music')
await openTab('Triggers')
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
await page.evaluate(() => (document.querySelector('.dock').style.height = '430px'))
await shot('15-script.png', '.script-panel')
// The strip gives the window back: the scenes view wants all of it.
await page.locator('.btn-script').click()

// The scenes view: the show as a matrix, edited in place. This is where the show is run
// from and the only place it is edited, so the two figures are the same surface twice —
// once as the operator watches it, once with the groups open for editing.
await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
await page.locator('.scenes-view').waitFor()
// The view opens to run the show; building one is an Edit away.
await page.locator('.scenes-edit').click()

// A group on the desk, pointed at a local port so the figure shows a real message.
await page.locator('.scenes-groups-toggle').click()
const groups = page.locator('.scenes-groups')
await groups.locator('.group-add').click()
const groupLabel = groups.locator('.group-label').first()
await groupLabel.fill('DCA 2 — Ensemble')
await groupLabel.blur()
await groups.locator('.group-delivery').first().selectOption('osc')
await groups.locator('.group-host').first().fill('127.0.0.1')
await groups.locator('.group-osc-port').first().fill('9000')
await groups.locator('.group-osc-port').first().blur()
await groups.locator('.group-address').first().fill('/dca/2/mute')
await groups.locator('.group-address').first().blur()
await groups.locator('.group-summary').first().waitFor()
// Closed again while the show is built, so the grid has the window to itself.
await page.locator('.scenes-groups-toggle').click()

const openMics = async (column, from, to) => {
  for (let i = from; i <= to; i++) {
    await page.locator('.matrix-row').nth(i).locator('.matrix-cell').nth(column).click()
  }
}
const nameScene = async (index, name) => {
  const field = page.locator('.matrix-scene').nth(index).locator('.scene-name-field')
  await field.fill(name)
  await field.blur()
}

await page.locator('.scenes-add').click()
await nameScene(0, 'Act One')
await openMics(0, 0, 3)
await page.locator('.scenes-add').click()
await nameScene(1, 'Wedding')
await openMics(1, 4, 7)

// The patch, in the editor the rest of the mic plot is set up in: the packs that feed that
// group, so the figure shows a desk with something on it.
await page.locator('.btn-rf').click()
await page.locator('.rf-edit').click()
const plotDialog = page.locator('.plot-dialog')
for (let i = 0; i < 8; i++) {
  await plotDialog.locator('.plot-pack-row').nth(i).locator('.plot-pack-group')
    .selectOption({ label: 'DCA 2 — Ensemble' })
}
await plotDialog.locator('.plot-close').click()
await page.locator('.btn-rf').click()

// The first number, so the header shows both the scene the desk is on and the one coming.
await page.locator('.matrix-recall').first().click()
await page.locator('.matrix-scene[data-current="true"]').waitFor()
// The first figure is the view as the operator runs the show from it.
await page.locator('.scenes-edit').click()
await shot('18-scenes.png', '.scenes-view')

await page.locator('.scenes-edit').click()
await page.locator('.scenes-groups-toggle').click()
await groups.waitFor()
await shot('19-scenes-groups.png', '.scenes-view')
await page.locator('.toolbar-view-btn', { hasText: 'Cues' }).click()

await app.evaluate(({ app: electronApp }) => electronApp.exit(0))
fs.rmSync(userDataDir, { recursive: true, force: true })
console.log('Done.')
