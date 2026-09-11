import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type IncomingHttpHeaders, type Server } from 'http'
import { createSocket } from 'dgram'
import { mkdirSync, mkdtempSync } from 'fs'
import path from 'path'

// Every instance gets its own user-data directory: recent files, window state and
// recovery snapshots live there, and tests that write them must not leak into the
// instances running alongside them. Pass the same directory back in to relaunch an
// instance that should see what the previous one left behind.
export async function launchApp(
  options: { userDataDir?: string } = {}
): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
  let userDataDir = options.userDataDir
  if (!userDataDir) {
    mkdirSync('test-results', { recursive: true })
    userDataDir = mkdtempSync(path.join('test-results', 'userdata-'))
  }

  const app = await electron.launch({
    args: [path.join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userDataDir}`],
  })
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

// Local HTTP server for network cue tests. Serves CORS headers so the renderer's
// cross-origin fetch passes preflight, answers 500 for "/fail", and records every
// non-preflight request.
export async function startServer(): Promise<TestServer> {
  const hits: RequestHit[] = []
  const server: Server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
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
 * desk driven over OSC at a port the test owns, a scene with the first mic open in it,
 * and the pack feeding that group.
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

  await page.locator('.scenes-add').click()
  await page.locator('.matrix-row').first().locator('.matrix-cell').first().click()
  await page.locator('.matrix-row').first().locator('.matrix-group-select')
    .selectOption({ label: 'DCA 1' })
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
 */
export async function listenOsc(
  port: number
): Promise<{ port: number; received: OscMessage[]; close: () => Promise<void> }> {
  const socket = createSocket('udp4')
  const received: OscMessage[] = []
  socket.on('message', buffer => received.push(decodeOscMessage(buffer)))
  await new Promise<void>(resolve => socket.bind(port, '127.0.0.1', resolve))
  return {
    port,
    received,
    close: () => new Promise<void>(resolve => socket.close(() => resolve()))
  }
}
