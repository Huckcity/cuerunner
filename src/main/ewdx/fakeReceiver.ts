import { createServer } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { FIXTURE_SERIAL, LINKED_EM4 } from './fixtures'

// A receiver for tests: the same words an EM 4 spoke when one was captured, over a real
// local socket, with the behaviour the client has to survive — Basic auth, the `/api`
// prefix on subscribed paths, an add that is refused as a whole, a limit on sessions, and
// state that arrives once per path and then only on change.

export interface FakeReceiverOptions {
  username?: string
  password: string
  /** How many subscription sessions it grants before refusing with 500. */
  maxSessions?: number
  protocol?: string
  /** The resources it knows and the first value of each. */
  state?: ReadonlyArray<readonly [string, unknown]>
  /** A certificate to present, which makes it an https receiver as a real one is. */
  tls?: { key: string; cert: string }
  /** A port to listen on, for a receiver that comes back where another one was. */
  port?: number
  /** The serial it gives in its identity: another value is a different receiver at the same address. */
  serial?: string
}

export interface FakeReceiver {
  /** `http://127.0.0.1:port`, or `https://` when it presents a certificate; the client picks the protocol from this. */
  origin: string
  /** Whether any request has carried credentials: what a receiver that should not have them must never see. */
  sawCredentials(): boolean
  /** Changes a resource and pushes it to every open session that subscribed to it. */
  push(path: string, value: unknown): void
  /** Ends every open event stream the way a rebooting receiver would. */
  dropStreams(): void
  /** Stops answering anything, with the sockets left open: a receiver that has gone quiet. */
  stall(on: boolean): void
  sessions(): number
  /** The requests the receiver has served, as `METHOD path`. */
  requests: string[]
  close(): Promise<void>
}

interface Session {
  id: string
  res: ServerResponse
  paths: Set<string>
}

export async function startFakeReceiver(options: FakeReceiverOptions): Promise<FakeReceiver> {
  const username = options.username ?? 'api'
  const protocol = options.protocol ?? '2.4'
  const state = new Map<string, unknown>(options.state ?? LINKED_EM4)
  const sessions = new Map<string, Session>()
  const requests: string[] = []
  let stalled = false
  let credentials = false

  const json = (res: ServerResponse, status: number, body?: unknown): void => {
    res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  }

  const authorised = (req: IncomingMessage): boolean =>
    req.headers.authorization ===
    `Basic ${Buffer.from(`${username}:${options.password}`).toString('base64')}`

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise(resolve => {
      let text = ''
      req.setEncoding('utf8')
      req.on('data', chunk => (text += chunk))
      req.on('end', () => resolve(text))
    })

  const emit = (session: Session, path: string): void => {
    session.res.write(`data: ${JSON.stringify({ [path]: state.get(path) })}\n\n`)
  }

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    route(req, res)
  }
  // The routes `return` what they answered with so each reads as one line; nothing uses it.
  const route = (req: IncomingMessage, res: ServerResponse): unknown => {
    const path = (req.url ?? '').split('?')[0]
    requests.push(`${req.method} ${path}`)
    if (req.headers.authorization !== undefined) credentials = true
    if (stalled) return undefined // no answer, ever

    if (path === '/api/ssc/version') return json(res, 200, { protocol, schema: '1.7' })
    if (path === '/api/device/identity') {
      return json(res, 200, { product: 'EWDX4CHDS', serial: options.serial ?? FIXTURE_SERIAL, vendor: 'Sennheiser electronic SE & Co. KG' })
    }
    if (!authorised(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="ssc"' })
      return res.end()
    }

    if (req.method === 'GET' && path === '/api/ssc/state/subscriptions') {
      if (sessions.size >= (options.maxSessions ?? 2)) return json(res, 500)
      const id = randomUUID()
      const session: Session = { id, res, paths: new Set() }
      sessions.set(id, session)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Content-Location': `/api/ssc/state/subscriptions/${id}`
      })
      res.write(`event: open\ndata: ${JSON.stringify({ path: `/api/ssc/state/subscriptions/${id}`, sessionUUID: id })}\n\n`)
      res.on('close', () => sessions.delete(id))
      return
    }

    const sub = /^\/api\/ssc\/state\/subscriptions\/([^/]+)(\/add)?$/.exec(path)
    if (sub) {
      const session = sessions.get(sub[1])
      if (!session) return json(res, 404)
      if (req.method === 'DELETE') {
        session.res.write(`event: close\ndata: ${JSON.stringify({ sessionUUID: session.id })}\n\n`)
        session.res.end()
        sessions.delete(session.id)
        return json(res, 200)
      }
      if (req.method === 'PUT' && sub[2]) {
        void readBody(req).then(text => {
          const wanted = JSON.parse(text) as string[]
          // The receiver's rule: the whole add stands or none of it does, and the paths
          // are spelled with the /api prefix whatever the schema's examples say.
          const bad = wanted.find(candidate => !candidate.startsWith('/api/') || !state.has(candidate))
          if (bad !== undefined) return json(res, 400, { path: bad, error: 404 })
          json(res, 200)
          for (const wantedPath of wanted) {
            session.paths.add(wantedPath)
            emit(session, wantedPath)
          }
        })
        return
      }
    }

    const channel = /^\/api\/channel\/(\d+)$/.exec(path)
    if (req.method === 'GET' && channel && state.has(path)) return json(res, 200, state.get(path))
    json(res, 404)
    return undefined
  }

  const server: Server = options.tls ? createSecureServer(options.tls, handle) : createServer(handle)
  await new Promise<void>(resolve => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    origin: `${options.tls ? 'https' : 'http'}://127.0.0.1:${port}`,
    sawCredentials: () => credentials,
    push(path, value) {
      state.set(path, value)
      for (const session of sessions.values()) if (session.paths.has(path)) emit(session, path)
    },
    dropStreams() {
      for (const session of sessions.values()) session.res.destroy()
      sessions.clear()
    },
    stall(on) {
      stalled = on
    },
    sessions: () => sessions.size,
    requests,
    close: () =>
      new Promise<void>(resolve => {
        for (const session of sessions.values()) session.res.destroy()
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
