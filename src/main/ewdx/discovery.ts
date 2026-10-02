import { createSocket } from 'node:dgram'
import type { RemoteInfo, Socket } from 'node:dgram'
import https from 'node:https'
import { networkInterfaces } from 'node:os'
import { buildPtrQuery, parseDnsRecords, presenceDevices } from '../services/mdns'
import type { EwDxFound } from '../../shared/ipc/show'

// Finding EW-DX receivers on the network, so nobody types an address.
//
// A receiver announces its control interface over mDNS as `_ssc-https._tcp`, and answers
// the public `/api/device/identity` without a password. That is enough to name it and to
// know what it is, and nothing here logs in: adding a receiver is still the operator's
// decision, and its password still theirs to enter.
//
// This is a look, not a service. It runs when the settings window asks and stops when it
// has listened, so a show that never opens that page has no traffic from it at all.

export const EW_DX_SERVICE = '_ssc-https._tcp.local'

/** The mDNS group every responder listens on, and the port they share. */
const MDNS_ADDRESS = '224.0.0.251'
const MDNS_PORT = 5353

/** How long a scan listens. A receiver answers in milliseconds; the rest is for a slow switch. */
const DEFAULT_WINDOW_MS = 2000
/** Asked twice: UDP is allowed to lose one, and a receiver that missed the first still hears the second. */
const RETRY_MS = 600
const IDENTIFY_TIMEOUT_MS = 2000
/** An identity document is four short strings; anything past this is not one. */
const MAX_IDENTITY_BYTES = 4096
/** A machine with more networks than this is not asking about all of them. */
const MAX_INTERFACES = 8

/**
 * What a receiver calls itself in `/api/device/identity`, read from one captured. The first
 * is the product code the Dante EM 4 reports; a receiver whose code is not here is still
 * offered, under the code it gave, rather than hidden.
 */
const MODELS: Record<string, string> = {
  EWDX4CHDS: 'EW-DX EM 4 Dante'
}

/** The slice of a dgram socket a scan uses; a test's stand-in needs only these. */
export type ScanSocket = Pick<Socket, 'on' | 'bind' | 'send' | 'close' | 'setMulticastInterface'>

export interface Identity {
  product: string
  serial: string
}

export interface DiscoverOptions {
  windowMs?: number
  /** The local addresses to ask from, one socket each. Default: this machine's own IPv4 ones. */
  interfaces?: string[]
  open?: () => ScanSocket
  identify?: (address: string, port: number) => Promise<Identity | null>
  /**
   * Receivers to treat as announced instead of asking the network, for a harness that has no
   * multicast to rely on. Each is still identified over HTTPS like any other.
   */
  announced?: Array<{ address: string; port: number; name: string }>
}

export interface DiscoverResult {
  receivers: EwDxFound[]
  /** Why nothing could be asked, when no network could be: the window says so rather than "none found". */
  error: string | null
}

/** This machine's IPv4 addresses that are on a network rather than on itself. */
export function localAddresses(): string[] {
  const found: string[] = []
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address)
    }
  }
  return found.slice(0, MAX_INTERFACES)
}

/**
 * The receiver's own account of itself, read without a password and without trusting its
 * certificate — it is only a label, nothing is sent to it, and the certificate is pinned
 * later by the connection that does carry a password.
 */
export function readIdentity(address: string, port: number): Promise<Identity | null> {
  return new Promise(resolve => {
    const request = https.get(
      { host: address, port, path: '/api/device/identity', rejectUnauthorized: false, timeout: IDENTIFY_TIMEOUT_MS, agent: false },
      response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => {
          body += chunk
          if (body.length > MAX_IDENTITY_BYTES) {
            response.destroy()
            resolve(null)
          }
        })
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { vendor?: unknown; product?: unknown; serial?: unknown }
            const sennheiser = typeof parsed.vendor === 'string' && /sennheiser/i.test(parsed.vendor)
            resolve(
              response.statusCode === 200 && sennheiser && typeof parsed.product === 'string' && typeof parsed.serial === 'string'
                ? { product: parsed.product, serial: parsed.serial }
                : null
            )
          } catch {
            resolve(null)
          }
        })
        response.on('error', () => resolve(null))
      }
    )
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(null))
  })
}

interface Candidate {
  address: string
  port: number
  /** The instance label the receiver announced, e.g. `EWDXEM4D-001B663BDD13`. */
  name: string
}

/** What to call a receiver: the model if it is known, the code it gave if it is not. */
export function modelOf(product: string): string {
  return MODELS[product] ?? `EW-DX (${product})`
}

export async function discoverEwDx(options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const interfaces = options.interfaces ?? localAddresses()
  const open = options.open ?? ((): ScanSocket => createSocket({ type: 'udp4', reuseAddr: true }))
  const identify = options.identify ?? readIdentity

  const candidates = new Map<string, Candidate>()
  for (const entry of options.announced ?? []) candidates.set(`${entry.address}:${entry.port}`, entry)

  if (options.announced === undefined && interfaces.length === 0) {
    return { receivers: [], error: 'this computer is not on a network' }
  }

  const sockets: ScanSocket[] = []
  const timers: ReturnType<typeof setTimeout>[] = []
  const failures: string[] = []
  let asked = 0

  for (const local of options.announced === undefined ? interfaces : []) {
    const socket = open()
    sockets.push(socket)
    // An error with no listener takes the main process down, and a network that will not
    // take a datagram is an ordinary state of a laptop: it is a reason, not a crash.
    socket.on('error', error => failures.push(error.message))
    socket.on('message', (packet: Buffer, remote: RemoteInfo) => {
      for (const device of presenceDevices(parseDnsRecords(packet))) {
        if (!device.id.toLowerCase().endsWith(`.${EW_DX_SERVICE}`)) continue
        // A responder that sent no address record is still the one that answered.
        const address = device.address || remote.address
        const port = device.port > 0 ? device.port : 443
        candidates.set(`${address}:${port}`, { address, port, name: device.name })
      }
    })

    const ask = (): void => {
      try {
        socket.send(buildPtrQuery(EW_DX_SERVICE), MDNS_PORT, MDNS_ADDRESS)
        asked += 1
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    try {
      // An ephemeral port, not 5353: answers to a query from any other port come back
      // straight to it, so the scan neither competes with the machine's own responder
      // for the shared port nor needs to join the group.
      socket.bind(0, local, () => {
        try {
          socket.setMulticastInterface(local)
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error))
        }
        ask()
        timers.push(setTimeout(ask, RETRY_MS))
      })
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  // Nothing to listen for when the answers were handed in.
  if (options.announced === undefined) await new Promise<void>(resolve => setTimeout(resolve, windowMs))
  for (const timer of timers) clearTimeout(timer)
  for (const socket of sockets) {
    try {
      socket.close()
    } catch {
      // A socket that never bound is already closed.
    }
  }

  if (candidates.size === 0) {
    // Nothing answered. If nothing could even be asked, that is the news; if it was asked
    // and no receiver is there, it is simply none.
    return { receivers: [], error: asked === 0 && failures.length > 0 ? failures[0] : null }
  }

  const identified = await Promise.all(
    [...candidates.values()].map(async candidate => ({ candidate, identity: await identify(candidate.address, candidate.port) }))
  )
  // One receiver can answer on more than one address; the serial is what it is.
  const bySerial = new Map<string, EwDxFound>()
  for (const { candidate, identity } of identified) {
    if (identity === null || !identity.product.toUpperCase().startsWith('EWDX')) continue
    if (!bySerial.has(identity.serial)) {
      bySerial.set(identity.serial, {
        address: candidate.address,
        port: candidate.port,
        name: candidate.name,
        product: identity.product,
        serial: identity.serial,
        model: modelOf(identity.product)
      })
    }
  }
  const receivers = [...bySerial.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { receivers, error: null }
}
