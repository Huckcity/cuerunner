import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type IncomingHttpHeaders, type Server } from 'http'
import { createSocket } from 'dgram'
import { generateKeyPairSync } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
// The spec process mints keys with the same codec the app reads them with, so a test
// cannot pass against a format the app does not actually accept.
import { createLicense } from '../src/main/license/key'

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
    id: `WSP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
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
    if (value !== undefined && !key.startsWith('WINSLAB_LICENSE_')) env[key] = value
  }
  if (trustPublicKey !== undefined) env['WINSLAB_LICENSE_PUBLIC_KEY'] = trustPublicKey
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
      ...(options.audio?.binPath !== undefined ? { WINSLAB_AUDIO_BIN: options.audio.binPath } : {}),
      // Explicit, not detected: a test run plays no user hardware, and a spec that wants
      // the real device says so.
      WINSLAB_AUDIO_BACKEND: options.audio?.backend ?? 'silent',
      ...options.env
    }
  })
  // On a Windows runner Playwright prints none of the app's stdio, and the engine's own
  // diagnostics ride it (main re-emits them, and reports its startup failures there too).
  // Elsewhere Playwright already surfaces it, so the tee stays Windows-only.
  if (process.platform === 'win32') {
    const proc = app.process()
    proc.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk))
    proc.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))
  }

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir }
}

// Force-exits the Electron process, bypassing the beforeunload dirty-check dialog. A
// crashed renderer can leave the app unable to answer, so a stuck exit is killed rather
// than left to time the worker out.
export async function closeApp(app: ElectronApplication): Promise<void> {
  const proc = app.process()
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

// Adds a cue from the toolbar's "More" menu (MIDI, OSC, Network, Script).
export async function addCueFromMoreMenu(page: Page, label: string): Promise<void> {
  await page.locator('.toolbar-more-btn').click()
  await page.locator('.toolbar-more-menu-item', { hasText: label }).click()
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
// Launched with WINSLAB_TEST_AUDIO_CAPTURE=<path>, the engine tees its real mixer
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
 * A show set up through the view, in the order an operator would do it: a group on the
 * desk driven over OSC at a port the test owns, the pack that feeds it patched in the mic
 * plot, and a scene with that mic open in it.
 */
export async function buildDeskShow(page: Page, port: number): Promise<void> {
  await liveRack(page)
  await openScenesView(page)

  await page.locator('.scenes-groups-toggle').click()
  const groups = page.locator('.scenes-groups')
  await groups.locator('.group-add').click()
  await groups.locator('.group-delivery').first().selectOption('osc')
  await groups.locator('.group-host').first().fill('127.0.0.1')
  await groups.locator('.group-osc-port').first().fill(String(port))
  await groups.locator('.group-osc-port').first().blur()
  await groups.locator('.group-address').first().fill('/dca/1/mute')
  await groups.locator('.group-address').first().blur()
  await expect(groups.locator('.group-summary').first()).toContainText('/dca/1/mute')

  // Which group a mic feeds is set up with the plot, not in the grid the show is run from.
  await page.locator('.btn-rf').click()
  await page.locator('.rf-edit').click()
  const dialog = page.locator('.plot-dialog')
  await dialog.locator('.plot-pack-row').first().locator('.plot-pack-group')
    .selectOption({ label: 'DCA 1' })
  await dialog.locator('.plot-close').click()
  await page.locator('.btn-rf').click()

  await page.locator('.scenes-add').click()
  await page.locator('.matrix-row').first().locator('.matrix-cell').first().click()
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
