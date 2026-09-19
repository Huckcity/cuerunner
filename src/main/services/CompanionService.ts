import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { CompanionState, ShowSettings } from '../../shared/show'
import { describe } from '../bus/ServiceHost'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import { companionPage } from './companionPage'

/** What the tablet is shown before the renderer has published anything. */
const EMPTY_STATE: CompanionState = {
  at: 0,
  workspaceName: '',
  nextCue: null,
  running: [],
  cues: [],
  script: null,
  alerts: []
}

/** A proxy or a sleeping tablet drops a stream it has heard nothing on; this is what it hears. */
const KEEP_ALIVE_MS = 15_000

export interface CompanionOptions {
  /**
   * The address the operator is told to type. Injected so a test — and a machine whose
   * first interface is not the one the tablet can reach — need not know the machine.
   */
  lanAddress?: () => string
  /** Stream keep-alive spacing, shortened by tests that cannot wait fifteen seconds. */
  keepAliveMs?: number
}

/** The address another machine in the room could reach, or loopback if there is none. */
function firstLanAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return '127.0.0.1'
}

/** A publish that carries what the tablet can read; anything else never reaches a client. */
function isCompanionState(value: unknown): value is CompanionState {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CompanionState>
  return Array.isArray(candidate.cues) && typeof candidate.at === 'number'
}

/** One SSE frame. */
function frame(value: CompanionState): string {
  return `data: ${JSON.stringify(value)}\n\n`
}

/**
 * Serves the show, read-only, to a tablet on the local network.
 *
 * The companion is one page and one stream: the renderer publishes the state it already
 * owns, the service hands it to whoever asked, and nobody can change anything through it.
 * It listens on the machines of a show, so an unset token refuses every request rather
 * than opening the show to the building, and a port somebody else holds leaves the rest
 * of the show running with the reason on the panel.
 */
export class CompanionService implements ShowService {
  readonly id = 'companion'
  readonly label = 'Companion'
  readonly pro = true
  /**
   * The companion only: the script the tablet serves is published by the renderer, so a
   * script edit has no business dropping the tablet's stream.
   */
  readonly settingsSections = ['companion'] as const

  private context: ServiceContext | null = null
  private server: Server | null = null
  private clients = new Set<ServerResponse>()
  private state: CompanionState | null = null
  private token = ''
  private keepAlive: NodeJS.Timeout | null = null
  /** Why the listener failed, while it is still failing; null while it works. */
  private failure: string | null = null

  constructor(private readonly options: CompanionOptions = {}) {}

  start(context: ServiceContext, settings: ShowSettings): void {
    this.stop()
    const { enabled, port, token } = settings.companion
    this.token = token
    if (!enabled) {
      // The companion puts the show on the network; nobody asked for that, so nothing
      // is bound and every request would be refused anyway.
      context.setState('stopped', 'disabled')
      return
    }

    this.context = context
    const server = createServer((request, response) => this.request(request, response, context))
    this.server = server

    // An 'error' with no listener takes the main process down, and the likeliest error
    // here is the one that matters: another program already holds the port.
    server.on('error', error => this.degrade(context, describe(error)))
    server.on('listening', () => this.listening(context))

    try {
      // Every address, not just loopback: the tablet is not this machine.
      server.listen(port, '0.0.0.0')
    } catch (error) {
      this.degrade(context, describe(error))
    }
  }

  stop(): void {
    if (this.keepAlive) {
      clearInterval(this.keepAlive)
      this.keepAlive = null
    }
    const clients = [...this.clients]
    this.clients.clear()
    for (const client of clients) {
      try {
        client.end()
      } catch {
        // A stream whose socket has already gone has nothing left to close.
      }
    }

    const server = this.server
    this.server = null
    this.context = null
    // The published state is kept: a settings change restarts this service, and wiping
    // it would blank the tablet until the renderer happened to publish again. It
    // describes the show, not the socket, so the next publish replaces it either way.
    this.token = ''
    this.failure = null
    if (!server) return
    try {
      server.close()
    } catch {
      // A server that never finished listening is already closed.
    }
  }

  command(action: string, payload?: unknown): { clients: number } {
    if (action !== 'publish') throw new Error(`Unknown action "${action}"`)
    if (!isCompanionState(payload)) {
      throw new Error('publish needs a state with a numeric at and a cues array')
    }
    this.state = payload
    // One frame per publish: a client that misses this one still has the stream, and the
    // next publish is the whole state rather than a difference to apply.
    const message = frame(payload)
    for (const client of this.clients) {
      if (!client.writableEnded && !client.destroyed) client.write(message)
    }
    return { clients: this.clients.size }
  }

  /** The listener is up, so the show has an address and a stream to keep open. */
  private listening(context: ServiceContext): void {
    if (this.context !== context || !this.server) return
    const address = this.server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const host = this.options.lanAddress?.() ?? firstLanAddress()
    // The operator reads this string off the panel and types it into the tablet, so it
    // is the address and the port this process actually bound.
    context.setState('running', `serving http://${host}:${port}/?token=${this.token}`)
    this.keepAlive = setInterval(
      () => this.keepAliveTick(),
      this.options.keepAliveMs ?? KEEP_ALIVE_MS
    )
    // A stream nobody is watching must not be what keeps the app alive on quit.
    this.keepAlive.unref?.()
  }

  private keepAliveTick(): void {
    for (const client of this.clients) {
      if (!client.writableEnded && !client.destroyed) client.write(': keep-alive\n\n')
    }
  }

  private request(request: IncomingMessage, response: ServerResponse, context: ServiceContext): void {
    if (this.context !== context) {
      // A request that arrived as the service went down is answered and let go.
      this.refuse(response, 503, 'The companion is not running')
      return
    }
    const method = request.method ?? 'GET'
    if (method !== 'GET') {
      this.refuse(response, 405, `The companion serves GET, not ${method}`)
      return
    }
    const url = new URL(request.url ?? '/', 'http://companion')
    if (this.token === '') {
      this.refuse(response, 403, 'The companion has no token set, so it serves nobody')
      return
    }
    if (url.searchParams.get('token') !== this.token) {
      this.refuse(response, 403, 'Wrong or missing token')
      return
    }

    switch (url.pathname) {
      case '/':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(companionPage())
        return
      case '/state':
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(this.state ?? EMPTY_STATE))
        return
      case '/events':
        this.stream(request, response)
        return
      default:
        this.refuse(response, 404, `No route ${url.pathname}`)
    }
  }

  private stream(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    this.clients.add(response)
    // The client may have connected between two publishes, so the first thing it gets is
    // the world as it stands rather than waiting for the next change.
    response.write(frame(this.state ?? EMPTY_STATE))
    request.on('close', () => {
      this.clients.delete(response)
    })
  }

  private refuse(response: ServerResponse, status: number, reason: string): void {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(reason)
  }

  /** One alarm per outage: the state on the panel already says the companion is down. */
  private degrade(context: ServiceContext, reason: string): void {
    if (this.context !== context) return
    const first = this.failure === null
    this.failure = reason
    context.setState('degraded', reason)
    if (first) context.bus.alert('warning', this.id, `${this.label}: ${reason}`)
  }
}
