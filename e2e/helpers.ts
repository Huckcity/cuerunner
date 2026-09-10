import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type IncomingHttpHeaders, type Server } from 'http'
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

// Force-exits the Electron process, bypassing the beforeunload dirty-check dialog.
export async function closeApp(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0))
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
