import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
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
