// The companion only exists as a server, so the tests talk to one: the service binds a
// real port (0, so a run never squats on the one a show will want), a fetch reads the
// page and the streams, and the client count is whatever a publish reports back.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createServer, type Server } from 'node:http'
import { CompanionService } from './CompanionService'
import type { CompanionOptions } from './CompanionService'
import { companionPage } from './companionPage'
import type { ServiceContext } from '../bus/ServiceHost'
import { ShowBus } from '../bus/ShowBus'
import { defaultShowSettings } from '../../shared/show'
import type {
  CompanionCue,
  CompanionSettings,
  CompanionState,
  ShowSettings
} from '../../shared/show'

const TOKEN = 's3cret'
const HOST = '10.0.0.5'

const EMPTY_STATE: CompanionState = {
  at: 0,
  workspaceName: '',
  nextCue: null,
  running: [],
  cues: [],
  script: null,
  alerts: []
}

function cue(id: string, number: string, name: string, scriptLine: number | null = null): CompanionCue {
  return { id, number, name, type: 'audio', parentId: null, scriptLine }
}

function published(at = 1_700_000_000_000): CompanionState {
  return {
    at,
    workspaceName: 'Hamlet',
    nextCue: cue('b', '12', 'Ghost entrance', 2),
    running: [{ id: 'a', number: '3', name: 'Lighting', state: 'running' }],
    cues: [cue('a', '3', 'Lighting', 1), cue('b', '12', 'Ghost entrance', 2)],
    script: { path: '/shows/hamlet.txt', lines: ['ACT I', 'Enter the GHOST'] },
    alerts: [{ id: 1, level: 'warning', message: 'Pack 4 low' }]
  }
}

function settings(patch: Partial<CompanionSettings> = {}): ShowSettings {
  const defaults = defaultShowSettings()
  return {
    ...defaults,
    companion: { ...defaults.companion, enabled: true, port: 0, token: TOKEN, ...patch }
  }
}

interface Harness {
  service: CompanionService
  context: ServiceContext
  setState: Mock
  bus: ShowBus
}

const started: CompanionService[] = []
const blockers: Server[] = []

function harness(options: CompanionOptions = { lanAddress: () => HOST }): Harness {
  const service = new CompanionService(options)
  started.push(service)
  const bus = new ShowBus()
  const setState = vi.fn()
  return { service, context: { bus, setState }, setState, bus }
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** The URL the operator was told to type, and therefore the one the test talks to. */
async function serve(h: Harness, patch: Partial<CompanionSettings> = {}): Promise<string> {
  h.service.start(h.context, settings(patch))
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    for (const call of h.setState.mock.calls) {
      const match = call[0] === 'running' ? /:(\d+)\/\?/.exec(String(call[1])) : null
      if (match) return `http://127.0.0.1:${match[1]}`
    }
    await delay(10)
  }
  throw new Error('the companion never reported that it was listening')
}

async function waitForCall(setState: Mock, state: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (setState.mock.calls.some(call => call[0] === state)) return
    await delay(10)
  }
  throw new Error(`the service never reported "${state}"`)
}

interface ByteReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
  /** The tablet closing its end of the stream. */
  cancel(): Promise<void>
}

interface Buffered {
  text: string
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const { promise: guarded, resolve, reject } = Promise.withResolvers<T>()
  const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
  // The timer is cleared on either outcome, so a fast frame does not hold the run open.
  promise.then(value => {
    clearTimeout(timer)
    resolve(value)
  }, error => {
    clearTimeout(timer)
    reject(error)
  })
  return guarded
}

async function nextFrame(reader: ByteReader, buffered: Buffered, timeoutMs = 3000): Promise<string> {
  const decoder = new TextDecoder()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const end = buffered.text.indexOf('\n\n')
    if (end >= 0) {
      const frame = buffered.text.slice(0, end)
      buffered.text = buffered.text.slice(end + 2)
      return frame
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('no frame arrived')
    const read = await withTimeout(reader.read(), remaining)
    if (read.done) throw new Error('the stream ended before a frame arrived')
    if (read.value) buffered.text += decoder.decode(read.value, { stream: true })
  }
}

function dataOf(frame: string): string {
  return frame
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => line.slice(6))
    .join('\n')
}

function openStream(response: Response): ByteReader {
  const body = response.body
  if (body === null) throw new Error('the stream has no body')
  return body.getReader()
}

async function clientsEventually(
  service: CompanionService,
  expected: number,
  timeoutMs = 3000
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let count = -1
  while (Date.now() < deadline) {
    count = service.command('publish', published()).clients
    if (count === expected) return count
    await delay(15)
  }
  return count
}

function listenOn(server: Server): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>()
  server.once('error', reject)
  server.listen(0, '0.0.0.0', () => {
    const address = server.address()
    if (typeof address !== 'object' || address === null) {
      reject(new Error('the blocker never bound a port'))
      return
    }
    resolve(address.port)
  })
  return promise
}

afterEach(async () => {
  for (const service of started.splice(0)) service.stop()
  await Promise.all(
    blockers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))
  )
})

describe('CompanionService', () => {
  it('serves nothing when the operator has not enabled it', async () => {
    const h = harness()

    h.service.start(h.context, settings({ enabled: false }))

    expect(h.setState).toHaveBeenCalledWith('stopped', 'disabled')
    expect(h.setState.mock.calls.some(call => call[0] === 'running')).toBe(false)
    expect(h.bus.snapshot().alerts).toEqual([])
  })

  it('advertises this machine and the port it actually bound', async () => {
    const h = harness()

    const base = await serve(h)
    const port = new URL(base).port

    expect(port).not.toBe('0')
    expect(h.setState).toHaveBeenCalledWith(
      'running',
      `serving http://${HOST}:${port}/?token=${TOKEN}`
    )
  })

  it('serves the tablet page, which carries the token it was opened with', async () => {
    const h = harness()
    const base = await serve(h)

    const response = await fetch(`${base}/?token=${TOKEN}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const body = await response.text()
    expect(body).toBe(companionPage())
    // The page reads its token off the URL it was opened with; the server never hands
    // the secret to a page anyone could have asked for.
    expect(body).not.toContain(TOKEN)
  })

  it('refuses a wrong or missing token on every route', async () => {
    const h = harness()
    const base = await serve(h)

    for (const path of ['/', '/state', '/events']) {
      const wrong = await fetch(`${base}${path}?token=wrong`)
      expect(wrong.status, `${path} with a wrong token`).toBe(403)
      expect(await wrong.text()).toContain('token')

      const missing = await fetch(`${base}${path}`)
      expect(missing.status, `${path} with no token`).toBe(403)
    }
  })

  it('serves nobody when no token is configured', async () => {
    const h = harness()
    const base = await serve(h, { token: '' })

    expect((await fetch(`${base}/state?token=`)).status).toBe(403)
    expect((await fetch(`${base}/state`)).status).toBe(403)
    expect((await fetch(`${base}/?token=`)).status).toBe(403)
  })

  it('serves the empty view until the renderer publishes, then the published one', async () => {
    const h = harness()
    const base = await serve(h)

    const before = await fetch(`${base}/state?token=${TOKEN}`)
    expect(before.headers.get('content-type')).toContain('application/json')
    expect(await before.json()).toEqual(EMPTY_STATE)

    const state = published()
    expect(h.service.command('publish', state)).toEqual({ clients: 0 })

    const after = await fetch(`${base}/state?token=${TOKEN}`)
    expect(await after.json()).toEqual(state)
  })

  it('sends the current state to a new stream and every publish after it', async () => {
    const h = harness()
    const base = await serve(h)

    const response = await fetch(`${base}/events?token=${TOKEN}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = openStream(response)
    const buffered: Buffered = { text: '' }

    expect(JSON.parse(dataOf(await nextFrame(reader, buffered)))).toEqual(EMPTY_STATE)

    const state = published()
    expect(h.service.command('publish', state)).toEqual({ clients: 1 })
    expect(JSON.parse(dataOf(await nextFrame(reader, buffered)))).toEqual(state)

    await reader.cancel()
  })

  it('keeps a quiet stream alive with a comment', async () => {
    const h = harness({ lanAddress: () => HOST, keepAliveMs: 40 })
    const base = await serve(h)

    const response = await fetch(`${base}/events?token=${TOKEN}`)
    const reader = openStream(response)
    const buffered: Buffered = { text: '' }
    await nextFrame(reader, buffered)

    expect((await nextFrame(reader, buffered)).trim()).toBe(': keep-alive')
    await reader.cancel()
  })

  it('drops a stream when the tablet closes it', async () => {
    const h = harness()
    const base = await serve(h)

    const response = await fetch(`${base}/events?token=${TOKEN}`)
    const reader = openStream(response)
    await nextFrame(reader, { text: '' })
    expect(h.service.command('publish', published())).toEqual({ clients: 1 })

    await reader.cancel()

    expect(await clientsEventually(h.service, 0)).toBe(0)
  })

  it('keeps the published state across a restart, so a settings change cannot blank the tablet', async () => {
    const h = harness()
    await serve(h)
    const state = published()
    h.service.command('publish', state)

    // Changing a setting restarts every service; the state describes the show, not the
    // socket, so the tablet keeps reading the last thing the renderer published.
    // The mock is cleared first: serve() reports the port from the latest "running".
    h.setState.mockClear()
    const restarted = await serve(h)

    const response = await fetch(`${restarted}/state?token=${TOKEN}`)
    expect(await response.json()).toEqual(state)
  })

  it('refuses a publish that is not a state and keeps the one it has', async () => {
    const h = harness()
    const base = await serve(h)
    const state = published()
    h.service.command('publish', state)

    expect(() => h.service.command('publish', { at: 1 })).toThrow()
    expect(() => h.service.command('publish', 'nope')).toThrow()
    expect(() => h.service.command('publish', { at: 'now', cues: [] })).toThrow()
    expect(() => h.service.command('publish', { cues: [] })).toThrow()
    expect(() => h.service.command('nope', state)).toThrow()

    expect(await (await fetch(`${base}/state?token=${TOKEN}`)).json()).toEqual(state)
  })

  it('answers 404 for an unknown route and 405 for a method it does not serve', async () => {
    const h = harness()
    const base = await serve(h)

    const missing = await fetch(`${base}/nowhere?token=${TOKEN}`)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-type')).toContain('text/plain')

    const wrong = await fetch(`${base}/state?token=${TOKEN}`, { method: 'POST' })
    expect(wrong.status).toBe(405)
    expect(await wrong.text()).toContain('POST')
  })

  it('degrades with one alarm when another program already holds the port', async () => {
    const blocker = createServer()
    blockers.push(blocker)
    const port = await listenOn(blocker)
    const h = harness()

    expect(() => h.service.start(h.context, settings({ port }))).not.toThrow()
    await waitForCall(h.setState, 'degraded')

    const degraded = h.setState.mock.calls.find(call => call[0] === 'degraded')
    expect(String(degraded?.[1])).toMatch(/EADDRINUSE|in use/)
    const alerts = h.bus.snapshot().alerts
    expect(alerts).toHaveLength(1)
    expect(alerts[0].level).toBe('warning')
  })

  it('closes the streams and the listener on stop, and serves nothing after', async () => {
    const h = harness()
    const base = await serve(h)

    const response = await fetch(`${base}/events?token=${TOKEN}`)
    const reader = openStream(response)
    await nextFrame(reader, { text: '' })

    h.service.stop()
    h.service.stop()

    const ended = await withTimeout(reader.read().then(read => read.done, () => true), 3000)
    expect(ended).toBe(true)
    await expect(fetch(`${base}/state?token=${TOKEN}`)).rejects.toThrow()
    expect(h.service.command('publish', published())).toEqual({ clients: 0 })
  })
})
