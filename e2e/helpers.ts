import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createServer, type IncomingHttpHeaders, type Server } from 'http'
import type { ChildProcess } from 'child_process'
import { createSocket } from 'dgram'
import { generateKeyPairSync } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
// The spec process mints keys with the same codec the app reads them with, so a test
// cannot pass against a format the app does not actually accept.
import { createLicense } from '../src/main/license/key.ts'
import { workerDisplay } from './display.ts'

/**
 * A license minted for a test run.
 *
 * The private half of the product key is deliberately not in the repository, so a spec
 * that needs the Pro surfaces brings a key of its own: `launchApp({ license })` writes
 * it where the app keeps its own and points the app at the public half that signed it.
 * That override is honoured by a build running out of the source tree and ignored by a
 * packaged one — see src/main/license/trustedKeys.ts — so this unlocks a test, never a
 * release.
 */
export interface TestLicense {
  /** The key as an operator would paste it. */
  text: string
  /** The public half, for the app that has to trust it. */
  publicKeyPem: string
  /** The private half, so a spec can mint a second key from the same issuer — an
   *  expired one, say — without the app having to trust a second key. */
  privateKeyPem: string
}

export function mintLicense(
  options: { licensee?: string; expires?: string; issuer?: TestLicense } = {}
): TestLicense {
  const { privateKeyPem, publicKeyPem } = options.issuer ?? newIssuer()
  const payload = {
    v: 1,
    id: `CRN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    licensee: options.licensee ?? 'End to End Test',
    issued: '2026-01-01',
    ...(options.expires === undefined ? {} : { expires: options.expires })
  }
  return {
    privateKeyPem,
    publicKeyPem,
    text: createLicense(payload, privateKeyPem)
  }
}

/** A pair to sign test licenses with. Nothing it signs leaves this machine. */
function newIssuer(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}

/** Environment for a launch, with any license override the shell happens to carry removed. */
function launchEnv(trustPublicKey?: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('CUERUNNER_LICENSE_')) env[key] = value
  }
  if (trustPublicKey !== undefined) env['CUERUNNER_LICENSE_PUBLIC_KEY'] = trustPublicKey
  return env
}

// Every instance gets its own user-data directory: recent files, window state and
// recovery snapshots live there, and tests that write them must not leak into the
// instances running alongside them. Pass the same directory back in to relaunch an
// instance that should see what the previous one left behind.
export async function launchApp(
  options: {
    userDataDir?: string
    license?: TestLicense
    trustPublicKey?: string
    /**
     * Extra environment for the app process. Used for the dev-only harness switches a
     * spec needs — never for anything the product reads in a packaged build.
     */
    env?: Record<string, string>
    /** Extra argv, for a spec that has to point the app somewhere else. */
    args?: string[]
    /**
     * Native audio engine settings for the run. The suite never touches the operator's
     * hardware: unless a spec explicitly asks for the device (`backend: 'auto'`, which
     * only the isolated native device smoke does), the engine runs its real mixer and
     * scheduler against the silent backend.
     */
    audio?: {
      /** Path to the built engine binary, when it is not the development default. */
      binPath?: string
      backend?: 'silent' | 'auto'
    }
  } = {}
): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
  let userDataDir = options.userDataDir
  if (!userDataDir) {
    mkdirSync('test-results', { recursive: true })
    userDataDir = mkdtempSync(path.join('test-results', 'userdata-'))
  }

  // The key goes where the app puts its own, so a licensed spec exercises the same path
  // an operator's license takes — and a launch without one starts locked.
  if (options.license) {
    writeFileSync(path.join(userDataDir, 'license.key'), options.license.text, 'utf-8')
  }

  // Each worker's windows go to a virtual display of that worker's own: on one shared
  // server, a pointer drag in one app was lost when another worker's app dragged at the
  // same moment. display.ts carries the measurements.
  const display = await workerDisplay()

  const app = await electron.launch({
    args: [
      path.join(process.cwd(), 'out/main/index.js'),
      `--user-data-dir=${userDataDir}`,
      // Electron 28+ auto-selects the session's Wayland compositor and ignores DISPLAY,
      // so on a Wayland desk every test instance would open its window on the developer's
      // desktop instead of the display the suite was given — dozens of windows in quick
      // succession, each taking focus, for the length of the run. The command line is the
      // only lever that works (`ELECTRON_OZONE_PLATFORM_HINT` is no longer read); with
      // this, the window goes to the runner's Xvfb, or to the desk's own X server for a
      // headed run a developer asked to watch.
      '--ozone-platform=x11',
      ...(options.args ?? [])
    ],
    env: {
      ...launchEnv(options.license?.publicKeyPem ?? options.trustPublicKey),
      // Electron prints its security advice into the renderer's console once per window
      // while unpackaged, and the suite opens hundreds. It says so itself — "this warning
      // will not show up once the app is packaged" — and where the harness tees the app's
      // stdio (Windows) that is a hundred and forty lines of the log saying nothing about
      // the run. The policy it advises on is a real item and not a test-harness one; this
      // keeps the suite's log about the suite.
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      ...(options.audio?.binPath !== undefined ? { CUERUNNER_AUDIO_BIN: options.audio.binPath } : {}),
      // Explicit, not detected: a test run plays no user hardware, and a spec that wants
      // the real device says so.
      CUERUNNER_AUDIO_BACKEND: options.audio?.backend ?? 'silent',
      ...(display === null ? {} : { DISPLAY: display }),
      ...options.env
    }
  })
  // On a Windows runner Playwright prints none of the app's stdio, and the engine's own
  // diagnostics ride it (main re-emits them, and reports its startup failures there too).
  // Elsewhere Playwright already surfaces it, so the tee stays Windows-only.
  if (process.platform === 'win32') {
    const proc = app.process()
    // Node prints this once per app, on exit, because Playwright's inspector is still
    // attached — it is about the debugger, not the app, and the suite launches an app per
    // test. Dropping it keeps the tee about what the tee is for: the engine's diagnostics
    // and main's own reports, on the one lane where Playwright does not print them.
    const nodeNoise = /^Waiting for the debugger to disconnect\.\.\.\s*/gm
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().replace(nodeNoise, '')
      if (text.trim() !== '') process.stdout.write(text)
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().replace(nodeNoise, '')
      if (text.trim() !== '') process.stderr.write(text)
    })
  }

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir }
}

// Force-exits the Electron process, bypassing the beforeunload dirty-check dialog. A
// crashed renderer can leave the app unable to answer, so a stuck exit is killed rather
// than left to time the worker out.
//
// An app that is already gone is gone: several specs restart the app under test and close
// their own instance along the way, and Playwright disposes the handle when the process is
// out — reading it after that throws rather than answering. Nothing is left to close, so
// that is not a failure of the teardown.
export async function closeApp(app: ElectronApplication): Promise<void> {
  let proc: ChildProcess
  try {
    proc = app.process()
  } catch {
    return
  }
  const exited = Promise.withResolvers<void>()
  if (proc.exitCode !== null || proc.signalCode !== null) exited.resolve()
  else proc.once('exit', () => exited.resolve())

  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {})
  const kill = setTimeout(() => {
    proc.kill('SIGKILL')
    exited.resolve()
  }, 5000)
  await exited.promise
  clearTimeout(kill)
}

// Scoped to the toolbar to avoid matching the inspector "Wait" tab button.
export function toolbarCueBtn(page: Page, label: string) {
  return page.locator('.toolbar-cue-btn', { hasText: label })
}

/**
 * A read of the window after its renderer was replaced, through the window's own webContents:
 * Playwright's page handle stays marked as crashed after the renderer is gone, so the page
 * cannot be asked. Every read is raced against a deadline — `executeJavaScript` issued while a
 * renderer is being torn down never settles, and `isCrashed()` can read false for a moment
 * after the crash is requested — and `null` means "not yet", which is what a poll wants.
 * `expression` is read in the window, so what it names is the page's own `document`.
 */
export async function readRecovered(app: ElectronApplication, expression: string): Promise<unknown> {
  return app.evaluate(async ({ BrowserWindow }, code) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents
    if (!contents || contents.isCrashed() || contents.isDestroyed()) return null
    const read = contents.executeJavaScript(code).catch(() => null)
    const deadline = Promise.withResolvers<unknown>()
    setTimeout(() => deadline.resolve(null), 2000)
    return Promise.race([read, deadline.promise]) as Promise<unknown>
  }, expression)
}

// Adds a cue from the toolbar's "More" menu (MIDI, OSC, Network, Script).
export async function addCueFromMoreMenu(page: Page, label: string): Promise<void> {
  await page.locator('.toolbar-more-btn').click()
  await page.locator('.toolbar-more-menu-item', { hasText: label }).click()
}

/** Sets the show's firing window, the way an operator would, and closes the panel. */
export async function setGuardWindow(page: Page, ms: number): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="settings"]').click()
  await page.locator('#settings-guard-window').fill(String(ms))
  await page.locator('#settings-guard-window').press('Enter')
  await expect(page.locator('#settings-guard-window')).toHaveValue(String(ms))
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
}

// Opens a saved show the way an operator does from the File menu: the entry the app keeps
// in its own recent list is written where it reads it from, rather than a file dialog
// being driven. The list is read when the menu opens, so the write may happen at any
// point before the click.
export async function openFromRecent(page: Page, userDataDir: string, cuerunner: string): Promise<void> {
  writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([cuerunner]))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: path.basename(cuerunner) }).click()
}

export interface RequestHit {
  method: string
  url: string
  headers: IncomingHttpHeaders
  body: string
}

export interface TestServer {
  baseUrl: string
  /** Every non-preflight request the server received, in order. */
  hits: RequestHit[]
  close: () => Promise<void>
}

// Local HTTP server for network cue tests. Answers 500 for "/fail" and records every
// non-preflight request.
//
// CORS headers are on by default so the older specs keep exercising what they always
// did. Pass `{ cors: false }` for the case that matters to a network cue: a console on
// the LAN that has never heard of the page's origin. A renderer-side fetch cannot reach
// that server, and a request from the main process does not care.
export async function startServer(options: { cors?: boolean } = {}): Promise<TestServer> {
  const cors = options.cors ?? true
  const hits: RequestHit[] = []
  const server: Server = createServer((req, res) => {
    if (cors) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', '*')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
    }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      hits.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
      res.writeHead(req.url === '/fail' ? 500 : 200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server port')

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    hits,
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  }
}

// ── The engine's own output, for the panic tests ──────────────────────────────
// Launched with CUERUNNER_TEST_AUDIO_CAPTURE=<path>, the engine tees its real mixer
// output to a 32-bit float WAV (data size left as 0xFFFFFFFF while it runs, so the PCM
// can be read past the header without waiting for a graceful close). A test can then
// ask the only question that matters for a panic: is the tail of that file silent, or
// was something still playing?

/** Peak absolute sample in the last `windowMs` of captured output. 0 when there is none. */
export function capturedOutputPeak(filePath: string, windowMs: number): number {
  const buffer = readFileSync(filePath)
  // 12 bytes RIFF header, 24 bytes fmt chunk, 8 bytes data chunk header.
  const PCM_OFFSET = 44
  if (buffer.length <= PCM_OFFSET) return 0

  const channels = buffer.readUInt16LE(22) || 2
  const sampleRate = buffer.readUInt32LE(24) || 48000
  const bytesPerFrame = 4 * channels
  const frames = Math.floor((buffer.length - PCM_OFFSET) / bytesPerFrame)
  if (frames === 0) return 0

  const windowFrames = Math.min(frames, Math.max(1, Math.ceil((sampleRate * windowMs) / 1000)))
  let peak = 0
  for (let frame = frames - windowFrames; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.abs(buffer.readFloatLE(PCM_OFFSET + frame * bytesPerFrame + channel * 4))
      if (sample > peak) peak = sample
    }
  }
  return peak
}

// ── OSC ──────────────────────────────────────────────────────────────────────
// The tests have to speak to the app the way a console does. An OSC message is an
// address, a type tag string, and the arguments, each padded to a 4-byte boundary —
// a dozen lines, which is less to carry than a dependency the app only needs on the
// receiving end.

function oscString(value: string): Buffer {
  const bytes = Buffer.from(`${value}\0`, 'utf8')
  const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4)
  bytes.copy(padded)
  return padded
}

function oscArgument(value: number | string): Buffer {
  if (typeof value === 'string') return oscString(value)
  const bytes = Buffer.alloc(4)
  if (Number.isInteger(value)) bytes.writeInt32BE(value)
  else bytes.writeFloatBE(value)
  return bytes
}

export function encodeOscMessage(address: string, ...args: Array<number | string>): Buffer {
  const tags = args
    .map(arg => typeof arg === 'string' ? 's' : Number.isInteger(arg) ? 'i' : 'f')
    .join('')
  return Buffer.concat([
    oscString(address),
    oscString(`,${tags}`),
    ...args.map(oscArgument)
  ])
}

/** Sends one message to a port on this machine, resolving once it is on the wire. */
export async function sendOsc(
  port: number,
  address: string,
  ...args: Array<number | string>
): Promise<void> {
  const socket = createSocket('udp4')
  const message = encodeOscMessage(address, ...args)
  return new Promise((resolve, reject) => {
    socket.send(message, port, '127.0.0.1', error => {
      socket.close()
      if (error) reject(error)
      else resolve()
    })
  })
}

// ── The desk show, for the specs that need one ───────────────────────────────
// Setting a show up through the UI is a dozen steps; the scene and matrix specs both need
// the same show, so it is built here once.

export async function liveRack(page: Page): Promise<void> {
  await page.locator('.btn-rf').click()
  await page.locator('.rf-demo-btn').click()
  await expect(page.locator('.rf-row')).toHaveCount(12)
  await page.locator('.btn-rf').click()
}

/** The Scenes view is where the show is run and the only place it is edited. */
export async function openScenesView(page: Page): Promise<void> {
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await expect(page.locator('.scenes-view')).toBeVisible()
}

/**
 * The run log, opened the way the toolbar button opens it — and left alone when it is
 * already open, because the button toggles and a spec that pressed it twice would be
 * asserting against a panel it had just closed.
 */
export async function openLogPanel(page: Page): Promise<void> {
  const panel = page.locator('.log-panel')
  if ((await panel.count()) === 0) await page.locator('.btn-log').click()
  await expect(panel).toBeVisible()
}

/** The view opens to run the show; building one starts with the press that edits it. */
export async function editScenes(page: Page): Promise<void> {
  // The grid is the view, so its corner lock is there as soon as a show has faders; a show
  // with none has no grid and carries the same press in words — under a class two buttons
  // share, so the one that unlocks is named rather than taken by class.
  const lock = page.locator('.matrix-lock')
  const way = (await lock.count()) > 0
    ? lock
    : page.getByRole('button', { name: /Unlock to add scenes|Lock it again/ })
  if ((await way.getAttribute('data-editing')) !== 'true') await way.click()
  await expect(page.locator('.scenes-view')).toHaveAttribute('data-editing', 'true')
}

/**
 * What a cell opens — the blank box of a row holding nothing, or the name of one holding
 * something: every strip and every group the show has, less the one the row holds, under
 * their own headings, and the builder at its foot. The label is typed into
 * the filter and the row pressed, because that is how a menu holding a console's worth of
 * strips is actually used — and the strip's label is the name it was given or the performer
 * standing on it, never its bare number.
 */
export async function pickFromBox(page: Page, cell: Locator, label: string): Promise<void> {
  // A row holding nothing is a blank box; a row holding something is that name, pressed —
  // the row holds one thing, so there is no second box beside it.
  await cell.locator('.matrix-cell-add, .matrix-block-name').first().click()
  const picker = page.locator('.scene-picker')
  await expect(picker).toBeVisible()
  await picker.locator('.scene-picker-filter').fill(label)
  // The rows are the filter's options rather than buttons: the filter is the combobox that
  // drives them, so the arrows reach them and Tab does not.
  await picker.getByRole('option', { name: label, exact: true }).click()
  await expect(picker).toHaveCount(0)
}

/**
 * The builder behind the box's last row: the strips the operator moves across become a new
 * ensemble — named here — and it is applied to the row it was opened from. The row this is
 * called on holds a strip or nothing, so the builder opens as a new group.
 */
export async function buildEnsembleFromBox(
  page: Page,
  cell: Locator,
  name: string,
  strips: string[]
): Promise<void> {
  // Whichever the cell offers: a blank box, or the name it already holds.
  await cell.locator('.matrix-cell-add, .matrix-block-name').first().click()
  const picker = page.locator('.scene-picker')
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'Ensemble…', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'New ensemble' })
  await expect(dialog).toBeVisible()
  await dialog.locator('.ensemble-name-field').fill(name)
  for (const strip of strips) {
    // Exactly, not by substring: "Ch 1" is a prefix of "Ch 10".
    await dialog.locator('[data-pane="free"]')
      .getByRole('button', { name: strip, exact: true })
      .click()
    await dialog.locator('.ensemble-move').first().click()
  }
  await dialog.getByRole('button', { name: 'Create and apply' }).click()
  await expect(dialog).toHaveCount(0)
}

/** The tabs of Show Settings, as the menu names them. */
export type ShowSettingsTab = 'channels' | 'cast' | 'mic-plot'

const SHOW_SETTINGS_TAB_LABEL: Record<ShowSettingsTab, string> = {
  channels: 'Channels',
  cast: 'Cast',
  'mic-plot': 'Mic plot'
}

/**
 * Show Settings is where the show's set-up lives — the DCAs, the cast and the mic plot —
 * and it opens from the menu rather than from the Scenes view, so a show can be set up
 * before the view it is run from is on screen.
 */
export async function openShowSettings(page: Page, tab?: ShowSettingsTab): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('[data-action="show-settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Show Settings' })
  await expect(dialog).toBeVisible()
  if (tab !== undefined) {
    const button = dialog.locator('.show-settings-tab', { hasText: SHOW_SETTINGS_TAB_LABEL[tab] })
    await button.click()
    await expect(button).toHaveAttribute('data-active', 'true')
  }
}

/**
 * The address a DCA's place in the show makes under a pattern: `{n}` swapped for the
 * number, or the number appended when the pattern has none — the app's own rule, written
 * out here the way the OSC codec above is, so a spec says what the wire should carry
 * without carrying the app into the test process.
 */
function addressAt(pattern: string, index: number): string {
  const number = index + 1
  if (pattern.includes('{n}')) return pattern.replaceAll('{n}', String(number))
  const trimmed = pattern.trim()
  if (trimmed === '') return `/${number}`
  return trimmed.endsWith('/') ? `${trimmed}${number}` : `${trimmed}/${number}`
}

/**
 * Points the show's desk at the test's own OSC listener. Where the desk is the one thing
 * about a show the app cannot know, so the test says it — and the tab's read-back is
 * asserted, because what it shows is what will actually be sent.
 *
 * The pattern is what a DCA's number is turned into; the default is the one a new show
 * comes with, so a caller that does not pass one is exercising the defaults end to end.
 */
export async function pointDeskAtOsc(
  page: Page,
  port: number,
  pattern = '/dca/{n}/on'
): Promise<void> {
  await openShowSettings(page)
  const settings = page.locator('.show-settings-dialog')

  await settings.locator('.desk-host').fill('127.0.0.1')
  await settings.locator('.desk-host').blur()
  await settings.locator('.desk-port').fill(String(port))
  await settings.locator('.desk-port').blur()
  await settings.locator('.desk-address').fill(pattern)
  await settings.locator('.desk-address').blur()

  // First and last of the addresses the pattern makes for this show's DCAs.
  const last = Math.max(0, (await settings.locator('.dca-row').count()) - 1)
  await expect(settings.locator('.desk-preview')).toContainText(addressAt(pattern, 0))
  await expect(settings.locator('.desk-preview')).toContainText(addressAt(pattern, last))
}

/**
 * The same, over the desk's own MIDI socket. An SQ and an Avantis serve MIDI on 51325 and
 * the test owns the port it points the show at, so the app is dialling a real socket.
 */
export async function pointDeskAtTcp(page: Page, port: number, host = '127.0.0.1'): Promise<void> {
  await openShowSettings(page)
  const settings = page.locator('.show-settings-dialog')

  await settings.locator('.desk-kind').selectOption('midi-tcp')
  await settings.locator('.desk-tcp-host').fill(host)
  await settings.locator('.desk-tcp-host').blur()
  await settings.locator('.desk-tcp-port').fill(String(port))
  await settings.locator('.desk-tcp-port').blur()

  // The read-back names the desk and the notes it makes, so a test that asserts on it is
  // asserting on what will be sent rather than on the fields it typed.
  const last = Math.max(0, (await settings.locator('.dca-row').count()) - 1)
  await expect(settings.locator('.desk-preview')).toContainText(`note 1 … ${last + 1} to ${host}:${port}`)
}

/**
 * A show set up through the view, in the order an operator would do it: the desk pointed
 * at a port the test owns, the first performer named, and a scene whose first row holds
 * their strip. Naming the performer names their strip, which is what the grid shows, and
 * the row is the scene's own — nothing else in the show says which fader a channel rides
 * (AD-26).
 *
 * `point` is which of the app's desk connections the caller is exercising; a show driven
 * over the desk's own socket passes `pointDeskAtTcp`.
 */
export async function buildDeskShow(
  page: Page,
  port: number,
  point: (page: Page, port: number) => Promise<void> = pointDeskAtOsc
): Promise<void> {
  await liveRack(page)
  await point(page, port)
  const settings = page.locator('.show-settings-dialog')

  // The demo rack's cast is patched to the strips, so naming the first performer names
  // the first strip; nothing here has to be routed.
  await settings.locator('.show-settings-tab', { hasText: 'Cast' }).click()
  const performer = settings.locator('.performer-row').first()
  const patched = await performer.locator('.performer-channel').evaluate(
    select => (select as HTMLSelectElement).selectedOptions[0]?.textContent ?? ''
  )
  expect(patched).toBe('Ch 1')
  await performer.locator('.performer-name').fill('Ruth')
  await performer.locator('.performer-name').blur()
  await settings.locator('.show-settings-done').click()

  await openScenesView(page)
  await editScenes(page)
  await page.locator('.matrix-add-scene').click()
  // A row holds one thing, and this scene places the strip it wants on the first fader:
  // that is the membership a recall writes and the reason the mic is open. Placing it is a
  // press on the cell's box and a press on the strip in the picker.
  await pickFromBox(
    page,
    page.locator('.matrix-row').first().locator('.matrix-cell').first(),
    'Ruth'
  )
}

/**
 * Moves this app's OSC input off the default port, onto one nothing else in the run is
 * using, and waits for the service to say so. Every licensed app in a parallel run
 * listens on the default, and a datagram sent there lands in whichever one the OS picks
 * — so a spec that sends OSC to the app it launched sends it here.
 */
export async function oscPortOfItsOwn(page: Page): Promise<number> {
  const port = 43000 + Math.floor(Math.random() * 5000)
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
  await dialog.locator('#settings-osc-port').fill(String(port))
  await dialog.locator('#settings-osc-port').blur()
  await expect(dialog.locator('.settings-service[data-service="osc-in"]')).toContainText(String(port))
  await dialog.getByRole('button', { name: 'Close' }).click()
  return port
}

/** A free-ish port for a test that needs to listen for OSC. */
export function freePort(): number {
  return 43600 + Math.floor(Math.random() * 2000)
}

export interface OscMessage {
  address: string
  args: Array<number | string | boolean>
}

function readOscString(buffer: Buffer, offset: number): { value: string; next: number } {
  const end = buffer.indexOf(0, offset)
  const value = buffer.toString('utf8', offset, end === -1 ? buffer.length : end)
  return { value, next: Math.ceil((end + 1) / 4) * 4 }
}

/** Just enough of a decoder to read back what the app sent. */
export function decodeOscMessage(buffer: Buffer): OscMessage {
  const address = readOscString(buffer, 0)
  const tags = readOscString(buffer, address.next)
  const args: Array<number | string | boolean> = []
  let offset = tags.next

  for (const tag of tags.value.replace(',', '')) {
    if (tag === 'i') {
      args.push(buffer.readInt32BE(offset))
      offset += 4
    } else if (tag === 'f') {
      args.push(buffer.readFloatBE(offset))
      offset += 4
    } else if (tag === 's') {
      const text = readOscString(buffer, offset)
      args.push(text.value)
      offset = text.next
    } else if (tag === 'T' || tag === 'F') {
      args.push(tag === 'T')
    }
  }

  return { address: address.value, args }
}

/**
 * A port that receives OSC, so a test can prove what the app actually put on the wire
 * rather than what it meant to.
 *
 * `receivedAt` stamps each message as it lands, on the monotonic clock the spec also
 * stamps its own actions with, so a timing test measures the wire and not the wall
 * clock or a polling interval.
 */
export async function listenOsc(
  port: number
): Promise<{ port: number; received: OscMessage[]; receivedAt: number[]; close: () => Promise<void> }> {
  const socket = createSocket('udp4')
  const received: OscMessage[] = []
  const receivedAt: number[] = []
  socket.on('message', buffer => {
    received.push(decodeOscMessage(buffer))
    receivedAt.push(performance.now())
  })
  await new Promise<void>(resolve => socket.bind(port, '127.0.0.1', resolve))
  return {
    port,
    received,
    receivedAt,
    close: () => new Promise<void>(resolve => socket.close(() => resolve()))
  }
}
