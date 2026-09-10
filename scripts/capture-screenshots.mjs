#!/usr/bin/env node
// Regenerates the screenshots used by the user guide (website/guide.html).
//
//   npm run build && npm run screenshots
//
// Launches the built app, opens a demo show from a temp file, drives the UI, and
// writes PNGs into website/assets/guide/. Images are captured from the real app so
// the guide cannot drift from the product; re-run after any UI change.
import { _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
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

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-shots-'))

/* ── Audio for the demo show ─────────────────────────────────────────────── */

// A decaying two-tone blip, so the waveform panel has something to draw.
function writeWav(file) {
  const rate = 44100
  const seconds = 4
  const total = rate * seconds
  const pcm = Buffer.alloc(total * 2)
  for (let i = 0; i < total; i++) {
    const t = i / rate
    const env = Math.min(1, t * 5) * Math.exp(-t * 0.8)
    const v = Math.sin(2 * Math.PI * 220 * t) * 0.6 + Math.sin(2 * Math.PI * 440 * t) * 0.25
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * env)) * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)   // PCM
  header.writeUInt16LE(1, 22)   // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  fs.writeFileSync(file, Buffer.concat([header, pcm]))
}

/* ── Demo show ───────────────────────────────────────────────────────────── */

// Network cue target: a local server that answers CORS requests, so the guide can
// show a real 200 response rather than a failure.
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
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const wav = path.join(workDir, 'walk-in.wav')
writeWav(wav)

const id = () => crypto.randomUUID()
const base = (number, name, extra) => ({
  id: id(),
  number,
  name,
  colorLabel: 'none',
  parentId: null,
  preWait: 0,
  postWait: 0,
  timelineOffset: 0,
  duration: 0,
  advance: 'none',
  isArmed: true,
  notes: '',
  ...extra
})

const walkIn = id()
const groupAct = id()
const timelineGroup = id()

const cues = [
  base('1', 'Walk-in Music', {
    id: walkIn, type: 'audio', colorLabel: 'blue', duration: 4200, advance: 'none',
    filePath: wav, startTime: 0, endTime: null, fadeInDuration: 800, fadeOutDuration: 1500,
    outputs: [{ deviceId: 'default', channelPair: [1, 2], volume: 0.8, pan: 0 }],
    loopCount: 0, playbackRate: 1, trim: 1,
    notes: 'Holds under the pre-show loop.'
  }),
  base('2', 'Act 1', { id: groupAct, type: 'group', mode: 'sequence', colorLabel: 'orange' }),
  base('3', 'Count 8', {
    type: 'wait', parentId: groupAct, duration: 8000, preWait: 500,
    advance: 'on-end', notes: 'Stage manager calls this.'
  }),
  base('4', 'Strings Patch', {
    type: 'midi', parentId: groupAct,
    portName: 'IAC Driver Bus 1',
    messages: [{ kind: 'programChange', channel: 1, program: 12 }]
  }),
  base('5', 'LX Cue 12', {
    type: 'osc', parentId: groupAct, host: '127.0.0.1', port: 53000, address: '/lx/12',
    args: [{ type: 'i', value: 12 }, { type: 'f', value: 3.5 }]
  }),
  base('6', 'Trigger Video', {
    type: 'network', parentId: groupAct, method: 'POST',
    url: `http://127.0.0.1:${port}/scene`,
    body: '{"scene": 3}',
    headers: { 'Content-Type': 'application/json', 'X-Show': 'demo' },
    timeout: 5000
  }),
  base('7', 'Scene Change', {
    type: 'audio', parentId: groupAct, duration: 4200,
    filePath: wav, startTime: 0, endTime: null, fadeInDuration: 300, fadeOutDuration: 0,
    outputs: [{ deviceId: 'default', channelPair: [1, 2], volume: 0.6, pan: -0.3 }],
    loopCount: 0, playbackRate: 1, trim: 1
  }),
  base('8', 'Fade Walk-in', {
    type: 'fade', targetCueId: walkIn, fadeProperty: 'volume', targetValue: 0,
    curve: 'sCurve', duration: 5000, stopTargetWhenDone: true
  }),
  base('9', 'House Lights', {
    type: 'script', language: 'javascript',
    script: "console.log('house lights → warm')\nconst r = await shell('echo dimmer 80%')\nconsole.log(r.stdout.trim())"
  }),
  base('10', 'Interval', { type: 'wait', duration: 15000, advance: 'on-end' }),
  base('11', 'Walk-out', { id: timelineGroup, type: 'group', mode: 'timeline', colorLabel: 'purple' }),
  base('12', 'Walk-out Bed', {
    type: 'audio', parentId: timelineGroup, timelineOffset: 0, duration: 4200,
    filePath: wav, startTime: 0, endTime: null, fadeInDuration: 500, fadeOutDuration: 1000,
    outputs: [{ deviceId: 'default', channelPair: [1, 2], volume: 0.7, pan: 0 }],
    loopCount: 0, playbackRate: 1, trim: 1
  }),
  base('13', 'Hold', { type: 'wait', parentId: timelineGroup, timelineOffset: 5000, duration: 6000 }),
  base('14', 'Walk-out Outro', {
    type: 'audio', parentId: timelineGroup, timelineOffset: 13000, duration: 4200,
    filePath: wav, startTime: 0, endTime: null, fadeInDuration: 200, fadeOutDuration: 2000,
    outputs: [{ deviceId: 'default', channelPair: [1, 2], volume: 0.7, pan: 0 }],
    loopCount: 0, playbackRate: 1, trim: 1
  }),
  base('15', 'End of Show', {
    type: 'stop', colorLabel: 'red', targetCueId: 'all', fadeOut: true, fadeOutDuration: 2000
  })
]

const workspacePath = path.join(workDir, 'Demo Show.wlab')
fs.writeFileSync(workspacePath, JSON.stringify({
  version: 1,
  id: id(),
  name: 'Demo Show',
  createdAt: new Date().toISOString(),
  audioSettings: { outputDeviceId: 'default', sampleRate: 48000, bufferSize: 256 },
  midiSettings: { outputPortName: '', inputPortName: '' },
  cues
}, null, 2))

/* ── Capture ─────────────────────────────────────────────────────────────── */

const app = await electron.launch({ args: [appEntry] })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')

// Point the File > Recent list at the demo show, then open it the way a user would.
const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
fs.writeFileSync(path.join(userData, 'recent.json'), JSON.stringify([workspacePath]), 'utf-8')

await page.locator('.toolbar-brand').click()
await page.locator('.file-menu-recent', { hasText: 'Demo Show' }).click()
await page.locator('.cue-row', { hasText: 'Walk-in Music' }).waitFor()

const shot = async (file, selector) => {
  const target = selector ? page.locator(selector) : page
  await target.screenshot({ path: path.join(outDir, file) })
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

await app.evaluate(({ app: electronApp }) => electronApp.exit(0))
fs.rmSync(workDir, { recursive: true, force: true })
console.log('Done.')
