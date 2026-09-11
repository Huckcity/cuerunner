type OscArg = { type: string; value: number | string | boolean }

export interface OscSendResult {
  ok: boolean
  error?: string
}

// node-osc ships no types, so the surface this engine uses is declared here. The
// cast at the require is the library boundary and nothing else.
interface OscClient {
  send(address: string, ...args: unknown[]): void
  close(callback?: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
}

type ClientFactory = (host: string, port: number) => OscClient

function connectOsc(host: string, port: number): OscClient {
  const { Client } = require('node-osc') as {
    Client: new (host: string, port: number) => OscClient
  }
  return new Client(host, port)
}

// UDP gives no delivery confirmation, but the send itself can fail: a bad port, a
// hostname that does not resolve, a socket that errors. Without a bound on the wait, a
// lost callback would leave the cue running for the rest of the show.
const SEND_TIMEOUT_MS = 2000

/** One socket per destination, kept open: a cue stack must not open a port per send. */
interface Destination {
  client: OscClient
  /** Sends waiting on their write to come back, so one socket error can fail them all. */
  pending: Map<symbol, (result: OscSendResult) => void>
}

export class OscEngine {
  private listener: unknown = null
  private destinations = new Map<string, Destination>()

  constructor(private readonly connect: ClientFactory = connectOsc) {}

  async send(host: string, port: number, address: string, args: OscArg[]): Promise<OscSendResult> {
    if (!host) return { ok: false, error: 'No OSC host is set for this cue' }

    let destination: Destination
    try {
      destination = this.destinationFor(host, port)
    } catch (error) {
      return { ok: false, error: describe(error) }
    }

    const mappedArgs = args.map(a => {
      if (a.type === 'T') return true
      if (a.type === 'F') return false
      return a.value
    })

    const { promise, resolve } = Promise.withResolvers<OscSendResult>()
    const token = Symbol('osc send')
    let settled = false
    const finish = (result: OscSendResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      destination.pending.delete(token)
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ ok: false, error: `No response sending to ${host}:${port}` })
      // A write that never came back means this socket is not worth keeping; the next
      // send opens a fresh one.
      this.closeDestination(host, port, destination)
    }, SEND_TIMEOUT_MS)
    destination.pending.set(token, finish)

    try {
      destination.client.send(address, ...mappedArgs, (error?: Error) => {
        finish(error ? { ok: false, error: describe(error) } : { ok: true })
      })
    } catch (error) {
      finish({ ok: false, error: describe(error) })
      this.closeDestination(host, port, destination)
    }

    return promise
  }

  /** Closes every open socket, so a quit is not held up by one. */
  close(): void {
    for (const destination of [...this.destinations.values()]) {
      // The error handler reads `pending` only; clearing here keeps a late error from
      // resolving sends that were already answered by close().
      for (const finish of [...destination.pending.values()]) {
        finish({ ok: false, error: 'OSC engine closed' })
      }
      destination.client.close(() => {})
    }
    this.destinations.clear()
  }

  startListener(port: number): void {
    try {
      const { Server } = require('node-osc') as {
        Server: new (port: number, host: string, callback: () => void) => unknown
      }
      if (this.listener) return
      this.listener = new Server(port, '0.0.0.0', () => {
        console.log(`OSC listener on port ${port}`)
      })
    } catch (e) {
      console.error('OSC listener error:', e)
    }
  }

  private destinationFor(host: string, port: number): Destination {
    const key = `${host}:${port}`
    const existing = this.destinations.get(key)
    if (existing) return existing

    const destination: Destination = { client: this.connect(host, port), pending: new Map() }

    // node-osc re-emits socket errors on the client. Without a listener that is an
    // unhandled 'error' event, which takes the main process down with it; with a socket
    // shared by every send, one error must reach every cue waiting on it.
    destination.client.on('error', (error: Error) => {
      const message = describe(error)
      for (const finish of [...destination.pending.values()]) finish({ ok: false, error: message })
      this.closeDestination(host, port, destination)
    })

    this.destinations.set(key, destination)
    return destination
  }

  private closeDestination(host: string, port: number, destination: Destination): void {
    const key = `${host}:${port}`
    if (this.destinations.get(key) === destination) this.destinations.delete(key)
    destination.client.close(() => {})
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
