import { createSocket } from 'node:dgram'
import type { OscArg } from '../../shared/cue'
import { encodeMessage } from './codec'

export interface OscSendResult {
  ok: boolean
  error?: string
}

/**
 * One destination's socket: a packet out, and its errors. Cuerunner's own UDP socket, so a
 * message's argument types are the ones the cue wrote — an `f` of 1 goes out as a float, where
 * a client that reads the type back off the JavaScript number would have sent an int — and so
 * the socket can be bound to the interface this machine pinned its OSC to.
 */
interface OscClient {
  send(packet: Buffer, callback: (error?: Error | null) => void): void
  close(callback?: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
}

/** Opens a client for one destination, from the interface address given (null: any). */
type ClientFactory = (host: string, port: number, localAddress: string | null) => OscClient

function connectOsc(host: string, port: number, localAddress: string | null): OscClient {
  const socket = createSocket({ type: 'udp4' })
  // An ephemeral port on the pinned interface: nothing listens on a sender's port, so it is
  // never shared and never needs to be.
  socket.bind(0, localAddress ?? undefined)
  socket.unref()
  return {
    send(packet, callback) {
      socket.send(packet, port, host, error => callback(error ?? null))
    },
    close(callback) {
      try {
        socket.close(callback)
      } catch {
        // Already closed: the outcome the caller wanted.
        callback?.()
      }
    },
    on(event, listener) {
      socket.on(event, listener)
    }
  }
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
  private destinations = new Map<string, Destination>()

  constructor(
    private readonly connect: ClientFactory = connectOsc,
    /** The interface address OSC goes out of, read per new socket; null is any. */
    private readonly localAddress: () => string | null = () => null
  ) {}

  async send(host: string, port: number, address: string, args: OscArg[]): Promise<OscSendResult> {
    if (!host) return { ok: false, error: 'No OSC host is set for this cue' }

    let packet: Buffer
    try {
      packet = encodeMessage(address, args)
    } catch (error) {
      return { ok: false, error: describe(error) }
    }

    let destination: Destination
    try {
      destination = this.destinationFor(host, port)
    } catch (error) {
      return { ok: false, error: describe(error) }
    }

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
      destination.client.send(packet, error => {
        finish(error ? { ok: false, error: describe(error) } : { ok: true })
      })
    } catch (error) {
      finish({ ok: false, error: describe(error) })
      this.closeDestination(host, port, destination)
    }

    return promise
  }

  /**
   * Closes every socket, so the next send opens one on the interface chosen now: what a change
   * of the machine's OSC interface asks for.
   */
  rebind(): void {
    this.close()
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

  private destinationFor(host: string, port: number): Destination {
    const key = `${host}:${port}`
    const existing = this.destinations.get(key)
    if (existing) return existing

    const destination: Destination = { client: this.connect(host, port, this.localAddress()), pending: new Map() }

    // A socket error with no listener is an unhandled 'error' event, which takes the main
    // process down with it; with a socket shared by every send, one error must reach every
    // cue waiting on it.
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
