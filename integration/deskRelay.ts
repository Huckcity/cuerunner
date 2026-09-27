/**
 * A relay in front of a desk, because its MIDI service serves one connection at a time — and,
 * where a caller asks for it, the desk's own control service beside it.
 *
 * Measured against an SQ-6 on firmware 1.6.1 (2026-09-21): the desk serves its first connection
 * on 51325 and resets every later one the moment it is accepted, whatever the new connection
 * sends or does not send — the rule is the number of connections, not the traffic on them. That
 * is what the hardware lane runs into, because it needs the app *and* a socket of its own: the
 * app must hold the desk, and this spec asks with its own wire. So the relay holds the desk's
 * single connection and both clients connect here — bytes from a client go to the desk verbatim,
 * and every byte the desk sends goes to every client attached.
 *
 * The desk's own control service is carried the same way where `native` asks for it: the session
 * on 51326, the leave channel on 51321 and the keepalive datagrams on 51324 — the three ports
 * the app dials on the show's desk host for an SQ (`src/main/desk/SqNativeEngine.ts`), and the
 * desk's own numbers rather than any show setting, so the carriage's listeners and dials take
 * them unchanged. One upstream connection per service, a client's bytes forwarded verbatim, the
 * desk's own bytes broadcast to every client attached, and a bounded record of the last bytes in
 * each direction — because a client cannot see another client's writes, and what the app wrote
 * on that route is nowhere else for a lane to read.
 *
 * It is a relay and not a desk: it answers nothing, invents nothing, drops nothing, and knows no
 * protocol — it forwards and records bytes, and decodes none of them.
 * `specs/harness-desk-relay.spec.ts` holds it to that against the desk peer, in one case with
 * the peer told to refuse a second client the way the desk does, which is the rule the relay
 * exists to get around. `INTEGRATION-HARNESS.md` §6 has the measurement.
 */
import { createConnection, createServer } from 'node:net'
import { createSocket } from 'node:dgram'
import type { AddressInfo, Server, Socket } from 'node:net'
import type { RemoteInfo, Socket as DatagramSocket } from 'node:dgram'
// The three numbers the app dials on the show's desk host, and the goodbye it leaves by, taken
// from the app's own codec rather than copied: listeners and dials that disagree are a route that
// goes nowhere, and the desk's numbers are not a lane's to have an opinion about.
import {
  GOODBYE,
  NATIVE_KEEPALIVE_PORT,
  NATIVE_LEAVE_PORT,
  NATIVE_TCP_PORT
} from '../src/main/desk/frames.ts'

/** How much of each direction the carriage's record keeps by default. */
const DEFAULT_RECORD_BYTES = 32 * 1024

/** The carriage's three ports, and how much of each direction its record keeps. */
export interface NativeCarriage {
  /** The control service's own port: 51326, which is what the app dials for any SQ. */
  tcpPort?: number
  /** The range's own leave port: 51321, where a session says `BYE.`. */
  leavePort?: number
  /** Where the session's keepalive datagrams go: 51324. */
  keepalivePort?: number
  /** The most bytes of each direction the record keeps. 32 KiB by default. */
  recordBytes?: number
}

export interface DeskRelayOptions {
  /** Where the desk is: the address the relay is the only client of. */
  desk: { host: string; port: number }
  /** The interface to listen on. Loopback by default, which is all a lane on one machine needs. */
  host?: string
  /** 0 (the default) takes an ephemeral port, so a spec never fights another over one. */
  port?: number
  /** How long the desk has to accept the relay's connection. */
  connectDeadlineMs?: number
  /**
   * Carry the desk's own control service as well as its MIDI service — the session on 51326,
   * the leave channel on 51321 and the keepalive datagrams on 51324, all of them at this
   * relay's host and all of them dialled on the desk's. `true` takes the desk's own numbers.
   *
   * One number is both ends of a carried service: the port the relay listens on is the port it
   * dials on the desk. So a caller overriding one passes the port the desk is on — not 0, which
   * would leave the relay listening on an ephemeral port nothing dials.
   *
   * Opt-in, and today's behaviour is what leaving it out means: nothing is dialled and nothing
   * listens on the three ports.
   */
  native?: boolean | NativeCarriage
}

/** The carried control service: where it listens, and the last bytes of each direction. */
export interface DeskRelayNative {
  /** The control service's port, as held and dialled: the desk's own number unless overridden. */
  tcpPort: number
  /** The leave channel's port, the same way. */
  leavePort: number
  /** The port the session's keepalive datagrams are taken on and forwarded to the desk's. */
  keepalivePort: number
  /**
   * The last `recordBytes` a client wrote to the control service, in arrival order — a ring
   * rather than a prefix, because the session opens with an 8192-byte layout push and a
   * recall's membership frames land after it.
   */
  toDesk: number[]
  /** The last `recordBytes` the desk wrote back, which every attached client also received. */
  fromDesk: number[]
}

export interface DeskRelay {
  /** Where clients connect, as bound: read this rather than the port asked for. */
  host: string
  port: number
  /** How many clients are attached to the MIDI service right now. */
  readonly clients: number
  /** The carried control service, or null when it was not asked for. */
  readonly native: DeskRelayNative | null
  /**
   * Why the desk connection ended, once it has — the lane reports this rather than a bare
   * ECONNRESET: a desk that went away and a relay that never reached it are different failures.
   * Null while the relay holds the desk (and after a deliberate `close`).
   */
  readonly lost: string | null
  close(): Promise<void>
}

/** The carriage's numbers, resolved against the desk's own: null when it was not asked for. */
function carriageOf(native: DeskRelayOptions['native']): Required<NativeCarriage> | null {
  if (native === undefined || native === false) return null
  const asked = native === true ? {} : native
  return {
    tcpPort: asked.tcpPort ?? NATIVE_TCP_PORT,
    leavePort: asked.leavePort ?? NATIVE_LEAVE_PORT,
    keepalivePort: asked.keepalivePort ?? NATIVE_KEEPALIVE_PORT,
    recordBytes: asked.recordBytes ?? DEFAULT_RECORD_BYTES
  }
}

/**
 * One direction's record: the bytes appended, and everything past the last `limit` dropped.
 *
 * The bytes are appended a byte at a time rather than spread, because a chunk is however much
 * the socket delivered and `push(...chunk)` is a call with that many arguments.
 */
function keep(into: number[], chunk: Buffer, limit: number): void {
  for (const byte of chunk) into.push(byte)
  if (into.length > limit) into.splice(0, into.length - limit)
}

/** One relay, holding one desk, for as long as it is up. */
export async function startDeskRelay(options: DeskRelayOptions): Promise<DeskRelay> {
  const { desk, host = '127.0.0.1', port = 0, connectDeadlineMs = 5000 } = options
  const carriage = carriageOf(options.native)
  const recordBytes = carriage?.recordBytes ?? 0

  /** The MIDI service's clients, which is what `clients` has always counted. */
  const clients = new Set<Socket>()
  /** The clients of each carried service, kept so every one of them is let go together. */
  const controlClients = new Set<Socket>()
  const leaveClients = new Set<Socket>()
  /** Every set of attached clients, so a desk that goes away takes all of them with it. */
  const attached: Set<Socket>[] = carriage === null
    ? [clients]
    : [clients, controlClients, leaveClients]
  /** The desk's end of every carried service except the leave channel, which `leaving` holds. */
  const upstreams: Socket[] = []
  /**
   * The desk's own door: the leave channel a client says `BYE.` on. It is held apart from
   * `upstreams` because the relay owes the desk a goodbye on it before it is let go, and a
   * goodbye is a write that has to leave the process — destroying the socket with it still
   * queued would lose it.
   */
  let leaving: Socket | null = null
  /** Everything the relay listens on. */
  const servers: Server[] = []
  /** The control service's record, both directions: live, and read by the lanes. */
  const toDesk: number[] = []
  const fromDesk: number[] = []
  let datagrams: DatagramSocket | null = null
  let lost: string | null = null
  let closing = false

  /**
   * The desk's own door, said on the way out. §6 measures what a client that leaves without its
   * goodbye leaves behind — an SQ that answers nothing on 51326 until it is reset — and this relay
   * *is* the client holding that session, so the four bytes go out on the leave channel before the
   * channel is let go, whether the relay is closing or a start failed with it already dialled.
   *
   * `end` rather than `destroy`: the write above is queued, and the kernel sends what is queued
   * even as the process goes, which a channel reset first would throw away.
   */
  const sayGoodbye = (): void => {
    const leave = leaving
    leaving = null
    if (leave === null || leave.destroyed) return
    try {
      leave.write(Buffer.from(GOODBYE))
      leave.end()
    } catch {
      // Already gone at the OS level: what the desk reads is whatever arrived before it went.
    }
  }

  /**
   * Everything the relay opened, let go of. Used when the desk goes away and when a relay that
   * could not start must leave nothing behind: a half-open relay is a port somebody else cannot
   * have, and "nothing already opened stays listening" is the promise that makes a failed start
   * a sentence rather than a leak.
   */
  const release = (): void => {
    sayGoodbye()
    for (const set of attached) {
      for (const client of set) client.destroy()
      set.clear()
    }
    for (const upstream of upstreams) upstream.destroy()
    for (const server of servers) {
      try {
        server.close()
      } catch {
        // Never listened, so never running: nothing to close.
      }
    }
    try {
      datagrams?.close()
    } catch {
      // Never bound, so never running: nothing to close.
    }
  }

  /**
   * The desk is gone: its clients go with it, and a later connect is refused rather than served
   * nothing. The desk is one device however many of its services the relay holds, so whichever
   * of them ended, the whole of it goes.
   */
  const deskGone = (why: string): void => {
    if (closing || lost !== null) return
    lost = why
    release()
  }

  /**
   * One TCP service's wiring: a client's bytes go to the desk verbatim, and every byte the desk
   * sends goes to every client attached. The service's own bytes are kept in `record` where a
   * lane asked for a record — and nothing is decoded, whatever it is.
   */
  const forward = (
    server: Server,
    upstream: Socket,
    set: Set<Socket>,
    record: { toDesk: number[]; fromDesk: number[] } | null
  ): void => {
    server.on('connection', (client) => {
      client.setNoDelay(true)
      set.add(client)
      client.on('data', (chunk: Buffer) => {
        // A client that speaks after the desk is gone writes into nothing; its own close is
        // what tells it, and that close is already on its way from `deskGone`.
        if (!upstream.destroyed) upstream.write(chunk)
        if (record !== null) keep(record.toDesk, chunk, recordBytes)
      })
      const drop = (): void => {
        set.delete(client)
      }
      client.on('close', drop)
      client.on('error', drop)
    })
    upstream.on('data', (chunk: Buffer) => {
      for (const client of set) client.write(chunk)
      if (record !== null) keep(record.fromDesk, chunk, recordBytes)
    })
  }

  /** A server on its own port, or the sentence naming the address somebody else holds. */
  const listen = async (server: Server, on: number): Promise<number> => {
    const bound = Promise.withResolvers<AddressInfo>()
    // A named port is a caller's own decision (`--listen host:port`), so a port somebody else
    // holds is a sentence naming it rather than an `error` event with nobody on it.
    const failed = (error: Error): void => {
      bound.reject(new Error(`cannot listen on ${host}:${on}: ${error.message}`))
    }
    server.once('error', failed)
    server.listen(on, host, () => {
      // The rejection handler goes and a listener stays: `listen`'s callback is not the last
      // word on the socket, and an error after it would be the same unhandled event.
      server.off('error', failed)
      server.on('error', () => {})
      bound.resolve(server.address() as AddressInfo)
    })
    return (await bound.promise).port
  }

  /** A datagram socket on its own port, with the same sentence and the same promise. */
  const bind = async (socket: DatagramSocket, on: number): Promise<number> => {
    const bound = Promise.withResolvers<AddressInfo>()
    const failed = (error: Error): void => {
      bound.reject(new Error(`cannot listen on ${host}:${on}: ${error.message}`))
    }
    socket.once('error', failed)
    socket.bind(on, host, () => {
      socket.off('error', failed)
      bound.resolve(socket.address() as AddressInfo)
    })
    return (await bound.promise).port
  }

  /**
   * One of the desk's services, or the sentence saying nothing answered. The deadline is the
   * relay's own, because a desk that is switched off is a desk nobody is talking to and the
   * kernel's own judgement about a silent host arrives minutes later.
   */
  const dial = (on: number): Promise<Socket> => {
    const socket = createConnection({ host: desk.host, port: on })
    socket.setNoDelay(true)
    const dialled = Promise.withResolvers<Socket>()
    const timer = setTimeout(() => {
      socket.destroy()
      dialled.reject(new Error(`Nothing answered at ${desk.host}:${on} within ${connectDeadlineMs} ms`))
    }, connectDeadlineMs)
    // A deadline still counting must not be what keeps the process alive on quit.
    timer.unref?.()
    const refused = (error: Error): void => {
      clearTimeout(timer)
      socket.destroy()
      // A refused connection and a silent one are the same thing to the lane: no desk. The
      // socket's own words are kept after the address, because which of the two it was is the
      // first thing worth knowing about a desk somebody has just cabled up.
      dialled.reject(new Error(`Nothing answered at ${desk.host}:${on}: ${error.message}`))
    }
    socket.once('error', refused)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.off('error', refused)
      dialled.resolve(socket)
    })
    return dialled.promise
  }

  const midi = createServer()
  const control = carriage === null ? null : createServer()
  const leave = carriage === null ? null : createServer()
  const datagramSocket = carriage === null ? null : createSocket('udp4')
  let controlPort = 0
  let leavePort = 0
  let keepalivePort = 0

  try {
    // The desk's own control service first where it is carried: it is the route a lane's show
    // dials, and a desk that is not there is named by that service rather than by whichever of
    // the dials happened to be armed first.
    if (carriage !== null && control !== null && leave !== null) {
      const controlUpstream = await dial(carriage.tcpPort)
      upstreams.push(controlUpstream)
      forward(control, controlUpstream, controlClients, { toDesk, fromDesk })
      controlUpstream.on('close', () => deskGone('the desk closed its control service'))
      controlUpstream.on('error', (error: Error) => deskGone(error.message))

      const leaveUpstream = await dial(carriage.leavePort)
      leaving = leaveUpstream
      forward(leave, leaveUpstream, leaveClients, null)
      leaveUpstream.on('close', () => deskGone('the desk closed the leave channel'))
      leaveUpstream.on('error', (error: Error) => deskGone(error.message))
    }

    const midiUpstream = await dial(desk.port)
    upstreams.push(midiUpstream)
    forward(midi, midiUpstream, clients, null)
    midiUpstream.on('close', () => deskGone('the desk closed the connection'))
    midiUpstream.on('error', (error: Error) => deskGone(error.message))

    // Then everything the relay listens on, and only once each of them has somewhere to forward
    // to: a port somebody else holds is a sentence a caller reads rather than a listener that
    // accepts clients into nothing.
    const boundMidi = await listen(midi, port)
    servers.push(midi)
    if (carriage !== null && control !== null && leave !== null && datagramSocket !== null) {
      controlPort = await listen(control, carriage.tcpPort)
      servers.push(control)
      leavePort = await listen(leave, carriage.leavePort)
      servers.push(leave)
      keepalivePort = await bind(datagramSocket, carriage.keepalivePort)
      datagrams = datagramSocket
      // A datagram the kernel hands back is not what ends a relay: the desk answering is.
      datagramSocket.on('error', () => {})
      datagramSocket.on('message', (message: Buffer, from: RemoteInfo) => {
        // One direction only — the client's datagram to the desk's own port — and the desk's own
        // address is how the other direction is told apart: a desk that answered the sender would
        // otherwise be bounced back at itself for as long as it kept answering. What the desk sees
        // as the sender is this socket rather than the app, which is a fact a manual run should
        // know before it reads anything into a desk's account of its client.
        if (from.address === desk.host && from.port === carriage.keepalivePort) return
        // The same body, to the desk's own port: nothing is read out of it and nothing is
        // invented, so what the desk sees is what the client sent.
        datagramSocket.send(message, carriage.keepalivePort, desk.host, () => {
          // An address nothing is on is not what ends a session; the desk answering is.
        })
      })
    }

    // A carried service that ended while the relay was still binding would otherwise leave it
    // returning with `lost` set and its later listeners open — clients could connect and write into
    // a destroyed upstream. So the sentence that named the loss is thrown, with nothing behind it.
    const gone: string | null = lost
    if (gone !== null) {
      release()
      throw new Error(gone)
    }

    return {
      host,
      port: boundMidi,
      get clients(): number {
        return clients.size
      },
      get native(): DeskRelayNative | null {
        return carriage === null
          ? null
          : { tcpPort: controlPort, leavePort, keepalivePort, toDesk, fromDesk }
      },
      get lost(): string | null {
        return lost
      },
      async close(): Promise<void> {
        closing = true
        sayGoodbye()
        for (const set of attached) {
          for (const client of set) client.destroy()
          set.clear()
        }
        for (const upstream of upstreams) upstream.destroy()
        try {
          datagrams?.close()
        } catch {
          // Never bound, so never running: nothing to close.
        }
        const closed = Promise.all(
          servers.map(server => new Promise<void>((resolve) => server.close(() => resolve())))
        )
        await closed
      }
    }
  } catch (error) {
    // A start that failed leaves nothing behind: the listeners it took, the desk connections it
    // opened and the ownerless client sets all go, so a caller that reads the sentence is not
    // also holding a port.
    release()
    throw error
  }
}

/* ---------------------------------------------------------------------------- CLI */

function usage(): string {
  return [
    'A relay in front of a desk, because its MIDI service takes one client.',
    '',
    '  node integration/deskRelay.ts --desk <host:port> [--listen <host:port>] [--native]',
    '',
    'It prints the address it listens on and holds the desk until it is stopped: point a show',
    'at the printed address, and anything else that wants the desk connects there too.',
    '`--listen <host>:0` takes an ephemeral port, which is what the printed line is for.',
    '',
    '--native carries the desk’s own control service as well — the session on 51326, the leave',
    'channel on 51321 and the keepalive datagrams on 51324, all of them at the printed address',
    'and all of them dialled on the desk’s. An SQ show dials those three the moment it opens,',
    'and the membership half of a recall goes over them: a manual run against a real SQ wants',
    'this (INTEGRATION-HARNESS.md §6).',
    '',
    'One case it cannot serve: a desk on this relay’s own host. A carried service listens on the',
    'number it dials, so 51326, 51321 and 51324 cannot be the relay’s listeners and the desk’s',
    'own services at once — give the desk another address (a second address of this machine is',
    'enough), or leave --native off and reach the desk without the carriage.'
  ].join('\n')
}

/** `host:port` as the two values, or null when it is not one. A listener may ask for port 0. */
function splitAddress(said: string, listening = false): { host: string; port: number } | null {
  const [host, portSaid] = said.split(':')
  const port = Number(portSaid)
  if (host === '' || !Number.isInteger(port) || port < (listening ? 0 : 1) || port > 65535) return null
  return { host, port }
}

async function main(argv: string[]): Promise<void> {
  const deskSaid = argv[argv.indexOf('--desk') + 1]
  const listenSaid = argv.includes('--listen') ? argv[argv.indexOf('--listen') + 1] : undefined
  const desk = argv.includes('--desk') ? splitAddress(deskSaid ?? '') : null
  const listen = listenSaid === undefined ? null : splitAddress(listenSaid, true)
  if (desk === null || (listenSaid !== undefined && listen === null)) {
    console.error(usage())
    process.exit(2)
  }

  const relay = await startDeskRelay({
    desk,
    ...(listen ?? {}),
    ...(argv.includes('--native') ? { native: true } : {})
  })
  console.log(`relay listening on ${relay.host}:${relay.port} -> desk ${desk.host}:${desk.port}`)
  if (relay.native !== null) {
    const { tcpPort, leavePort, keepalivePort } = relay.native
    console.log(
      `carrying the desk’s own control service: ${relay.host}:${tcpPort} -> ${desk.host}:${tcpPort}, ` +
        `leave ${relay.host}:${leavePort} -> ${desk.host}:${leavePort}, ` +
        `keepalive udp ${relay.host}:${keepalivePort} -> ${desk.host}:${keepalivePort}`
    )
  }

  const stop = (): void => {
    void relay.close().then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (process.argv[1]?.endsWith('deskRelay.ts')) {
  void main(process.argv.slice(2))
}
