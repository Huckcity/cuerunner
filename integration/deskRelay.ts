/**
 * A relay in front of a desk's MIDI-over-TCP service, because that service serves one connection
 * at a time.
 *
 * Measured against an SQ-6 on firmware 1.6.1 (2026-09-21): the desk serves its first connection
 * on 51325 and resets every later one the moment it is accepted, whatever the new connection
 * sends or does not send — the rule is the number of connections, not the traffic on them. That
 * is what the hardware lane runs into, because it needs the app *and* a socket of its own: the
 * app must hold the desk, and this spec asks with its own wire. So the relay holds the desk's
 * single connection and both clients connect here — bytes from a client go to the desk verbatim,
 * and every byte the desk sends goes to every client attached.
 *
 * It is a relay and not a desk: it answers nothing, invents nothing, drops nothing, and knows no
 * protocol. `specs/harness-desk-relay.spec.ts` holds it to that against the desk peer, in one
 * case with the peer told to refuse a second client the way the desk does, which is the rule the
 * relay exists to get around. `INTEGRATION-HARNESS.md` §6 has the measurement.
 */
import { createConnection, createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'

export interface DeskRelayOptions {
  /** Where the desk is: the address the relay is the only client of. */
  desk: { host: string; port: number }
  /** The interface to listen on. Loopback by default, which is all a lane on one machine needs. */
  host?: string
  /** 0 (the default) takes an ephemeral port, so a spec never fights another over one. */
  port?: number
  /** How long the desk has to accept the relay's connection. */
  connectDeadlineMs?: number
}

export interface DeskRelay {
  /** Where clients connect, as bound: read this rather than the port asked for. */
  host: string
  port: number
  /** How many clients are attached right now. */
  readonly clients: number
  /**
   * Why the desk connection ended, once it has — the lane reports this rather than a bare
   * ECONNRESET: a desk that went away and a relay that never reached it are different failures.
   * Null while the relay holds the desk (and after a deliberate `close`).
   */
  readonly lost: string | null
  close(): Promise<void>
}

/** One relay, holding one desk, for as long as it is up. */
export async function startDeskRelay(options: DeskRelayOptions): Promise<DeskRelay> {
  const { desk, host = '127.0.0.1', port = 0, connectDeadlineMs = 5000 } = options

  const clients = new Set<Socket>()
  let lost: string | null = null
  let closing = false

  const upstream = createConnection({ host: desk.host, port: desk.port })
  upstream.setNoDelay(true)

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      upstream.destroy()
      reject(new Error(`Nothing answered at ${desk.host}:${desk.port} within ${connectDeadlineMs} ms`))
    }, connectDeadlineMs)
    // A deadline still counting must not be what keeps the process alive on quit.
    timer.unref?.()
    upstream.once('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    upstream.once('error', (error: Error) => {
      clearTimeout(timer)
      // A refused connection and a silent one are the same thing to the lane: no desk. The
      // socket's own words are kept after the address, because which of the two it was is the
      // first thing worth knowing about a desk somebody has just cabled up.
      reject(new Error(`Nothing answered at ${desk.host}:${desk.port}: ${error.message}`))
    })
  })

  /** The desk is gone: the clients go with it, and a later connect is refused rather than served. */
  const deskGone = (why: string): void => {
    if (closing || lost !== null) return
    lost = why
    for (const client of clients) client.destroy()
    clients.clear()
    server.close()
  }

  const server: Server = createServer((client) => {
    client.setNoDelay(true)
    clients.add(client)
    client.on('data', (chunk: Buffer) => {
      // A client that speaks after the desk is gone writes into nothing; its own close is
      // what tells it, and that close is already on its way from `deskGone`.
      if (!upstream.destroyed) upstream.write(chunk)
    })
    const drop = (): void => {
      clients.delete(client)
    }
    client.on('close', drop)
    client.on('error', drop)
  })

  upstream.on('data', (chunk: Buffer) => {
    for (const client of clients) client.write(chunk)
  })
  upstream.on('close', () => deskGone('the desk closed the connection'))
  upstream.on('error', (error: Error) => deskGone(error.message))

  // A named port is a caller's own decision (`--listen host:port`), so a port somebody else
  // holds is a sentence naming it rather than an `error` event with nobody on it, which takes
  // the worker down: the peers' `listen`/`bind` say the same about their own sockets.
  const listening = Promise.withResolvers<AddressInfo>()
  const failed = (error: Error): void => {
    listening.reject(new Error(`cannot listen on ${host}:${port}: ${error.message}`))
  }
  server.once('error', failed)
  server.listen(port, host, () => {
    // The rejection handler goes and a listener stays: `listen`'s callback is not the last
    // word on the socket, and an error after it would be the same unhandled event.
    server.off('error', failed)
    server.on('error', () => {})
    listening.resolve(server.address() as AddressInfo)
  })
  const address = await listening.promise

  return {
    host,
    port: address.port,
    get clients(): number {
      return clients.size
    },
    get lost(): string | null {
      return lost
    },
    async close(): Promise<void> {
      closing = true
      for (const client of clients) client.destroy()
      clients.clear()
      upstream.destroy()
      const closed = Promise.withResolvers<void>()
      server.close(() => closed.resolve())
      await closed.promise
    }
  }
}

/* ---------------------------------------------------------------------------- CLI */

function usage(): string {
  return [
    'A relay in front of a desk, because its MIDI service takes one client.',
    '',
    '  node integration/deskRelay.ts --desk <host:port> [--listen <host:port>]',
    '',
    'It prints the address it listens on and holds the desk until it is stopped: point a show',
    'at the printed address, and anything else that wants the desk connects there too.'
  ].join('\n')
}

/** `host:port` as the two values, or null when it is not one. */
function splitAddress(said: string): { host: string; port: number } | null {
  const [host, portSaid] = said.split(':')
  const port = Number(portSaid)
  if (host === '' || !Number.isInteger(port) || port <= 0 || port > 65535) return null
  return { host, port }
}

async function main(argv: string[]): Promise<void> {
  const deskSaid = argv[argv.indexOf('--desk') + 1]
  const listenSaid = argv.includes('--listen') ? argv[argv.indexOf('--listen') + 1] : undefined
  const desk = argv.includes('--desk') ? splitAddress(deskSaid ?? '') : null
  const listen = listenSaid === undefined ? null : splitAddress(listenSaid)
  if (desk === null || (listenSaid !== undefined && listen === null)) {
    console.error(usage())
    process.exit(2)
  }

  const relay = await startDeskRelay({ desk, ...(listen ?? {}) })
  console.log(`relay listening on ${relay.host}:${relay.port} -> desk ${desk.host}:${desk.port}`)

  const stop = (): void => {
    void relay.close().then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (process.argv[1]?.endsWith('deskRelay.ts')) {
  void main(process.argv.slice(2))
}
