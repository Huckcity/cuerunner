/**
 * A peer that stands in for an SQ's own control service — the desk's native protocol on TCP
 * 51326, which Allen & Heath publish nothing about — as far as a client on the wire can tell.
 *
 * It is written from one measurement,
 * `integration/fixtures/vendor/sq6-native-apply-2026-09-22.json` (an SQ-6 on firmware 1.6.1,
 * 2026-09-22), and it owns both halves of that reading: its decoder and its answers. The app's
 * codec (`src/main/desk/frames.ts`) is a second reading of the same capture and never an
 * import of this one, because the point of a peer is that it can disagree with the code it is
 * put in front of.
 *
 * What the capture holds, this peer answers with: every frame the client writes gets the
 * desk's own reply back where the capture holds one, in the capture's own order, and a frame's
 * bytes are decoded the way the capture's own pairing reads them. What the capture does not
 * hold is not invented. It holds no assignment frame from the desk, so this peer says nothing
 * about a membership and a client can never read back what it wrote; it holds no keepalive
 * datagram at all, so a datagram is witnessed as arrival and width and never as a body; and it
 * holds no second way into the session, so a frame the capture answers nothing to gets nothing
 * back. The read form therefore stays unmeasured, which is the state `SPEC.md`'s open question
 * and `INTEGRATION-HARNESS.md` §11 decision 6 record.
 *
 * The desk takes several clients at once (measured on the same run as the ports below), so
 * this peer does too, and it is the desk's own door on 51321 that a client leaves by.
 */

import { createSocket } from 'node:dgram'
import type { Socket as DatagramSocket } from 'node:dgram'
import { readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'
import { join } from 'node:path'

/* -------------------------------------------------------------------- the ports */

/**
 * The desk's own control service. The app dials it on the desk's address for any SQ show, so
 * a lane that drives the app binds this one — and `desk.tcpPort` keeps meaning the MIDI
 * service's port on 51325, which is a different service on the same desk.
 */
export const NATIVE_TCP_PORT = 51326

/** The range's own leave port: a client says `BYE.` here before it lets the desk go. */
export const NATIVE_LEAVE_PORT = 51321

/** Where a session's keepalive datagrams go, once a second; this peer binds it to witness them. */
export const NATIVE_KEEPALIVE_PORT = 51324

/** `BYE.`, in ASCII: four bytes on the leave port, and the goodbye the desk expects. */
export const GOODBYE = [0x42, 0x59, 0x45, 0x2e]

/* ------------------------------------------------------------------ the capture */

/**
 * The capture this peer is written from: the one measurement of this protocol in the
 * repository, resolved from this file rather than from a caller's working directory.
 */
export const CAPTURE = join(__dirname, '..', 'fixtures', 'vendor', 'sq6-native-apply-2026-09-22.json')

/** One captured chunk: what went one way, when, and the bytes as the wire carried them. */
export interface SqNativeExchange {
  at: number
  direction: 'to-desk' | 'from-desk'
  /** The chunk's bytes, hex, as the capture writes them. */
  bytes: string
}

/** The capture, shape-checked: what this peer reads, and what it will not guess at. */
export interface SqNativeCapture {
  /** `sq-native` and the desk it came off. A capture of something else is refused. */
  provenance: { kind: string; device: string; firmware: string; target: string; recordedAt: string }
  exchanges: SqNativeExchange[]
}

/** Past this a file is not one session's capture, whatever it says it is. */
const CAPTURE_LIMIT_BYTES = 4 * 1024 * 1024

/** Hex, and nothing else: the capture's own spelling of a chunk. */
const HEX = /^[0-9a-f]*$/

/**
 * Read the capture, under a bound and with its shape checked. Every failure is a sentence a
 * human can act on — the file came off another machine, and "there is no file there" is the
 * usual fault (`eos.ts`'s `loadRecording` makes the same promise about a recording).
 */
export function readCapture(path: string = CAPTURE): SqNativeCapture {
  const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  let size: number
  try {
    size = statSync(path).size
  } catch (error) {
    throw new Error(`no capture at ${path}: ${describe(error)}`)
  }
  if (size > CAPTURE_LIMIT_BYTES) {
    throw new Error(
      `${path} is ${size} bytes, past the ${CAPTURE_LIMIT_BYTES} one session's capture can be: this is not a capture`
    )
  }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${path}: ${describe(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} is not JSON: ${describe(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || !('provenance' in parsed) || !('exchanges' in parsed)) {
    throw new Error(`${path} is not an SQ native capture: no provenance and no list of exchanges`)
  }
  const { provenance, exchanges: listed } = parsed
  if (typeof provenance !== 'object' || provenance === null || !('kind' in provenance) || provenance.kind !== 'sq-native') {
    throw new Error(`${path} is not an SQ native capture: its provenance is not \`sq-native\``)
  }
  // The four strings the type declares, because they are what says *which* desk and firmware
  // these bytes came off and when: a file carrying the kind and nothing else is one somebody
  // assembled, and replaying it would be replaying something nobody measured.
  if (
    !('device' in provenance) ||
    !('firmware' in provenance) ||
    !('target' in provenance) ||
    !('recordedAt' in provenance)
  ) {
    throw new Error(
      `${path} is not an SQ native capture: its provenance does not name the desk, its firmware, the address it was taken from and the day`
    )
  }
  const { device, firmware, target, recordedAt } = provenance
  if (
    typeof device !== 'string' || device.trim() === '' ||
    typeof firmware !== 'string' || firmware.trim() === '' ||
    typeof target !== 'string' || target.trim() === '' ||
    typeof recordedAt !== 'string' || recordedAt.trim() === ''
  ) {
    throw new Error(`${path} is not an SQ native capture: a provenance field is empty or is not a string`)
  }
  if (!Array.isArray(listed)) throw new Error(`${path} is not an SQ native capture: its exchanges are not a list`)

  const exchanges = listed.map((entry: unknown, index: number): SqNativeExchange => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('at' in entry) ||
      !('direction' in entry) ||
      !('bytes' in entry)
    ) {
      throw new Error(`${path}: exchange ${index} is not a recorded chunk`)
    }
    const { at, direction, bytes } = entry
    if (typeof at !== 'number') throw new Error(`${path}: exchange ${index} carries no time`)
    if (direction !== 'to-desk' && direction !== 'from-desk') {
      throw new Error(`${path}: exchange ${index} is neither to nor from the desk`)
    }
    if (typeof bytes !== 'string' || bytes.length === 0 || bytes.length % 2 !== 0 || !HEX.test(bytes)) {
      throw new Error(`${path}: exchange ${index} carries bytes that are not a non-empty even run of hex`)
    }
    return { at, direction, bytes }
  })

  // Built from the validated fields rather than asserted into the type: what is returned is
  // what was checked, field by field.
  return {
    provenance: { kind: 'sq-native', device, firmware, target, recordedAt },
    exchanges
  }
}

/* --------------------------------------------------------------- the two families */

/** The first family's leading byte: a command and a payload under a four-byte length. */
const FAMILY_7F = 0x7f
/** The second family's leading byte, and its width: eight bytes, every frame of it. */
const FAMILY_F7 = 0xf7
const F7_FRAME_BYTES = 8

/** The first family's header: the leading byte, the command, and the payload's length. */
const HEADER_BYTES = 6

/**
 * The longest payload that is a frame. The capture's layout push declares 8192 bytes; past
 * this the stream has lost its place rather than found a long message, and the reader looks
 * on for the next byte that could open one.
 */
const MAX_PAYLOAD_BYTES = 64 * 1024

/** The eight-byte family's own pair of bytes before a membership command. */
const MEMBERSHIP = [0x07, 0x07]
/** The pair frame: one input placed on one fader, or taken off it. */
const PAIR_FRAME = 0x1d
/** The per-channel "rides a fader" flag, which follows the pair. */
const RIDES_FRAME = 0x0c

/**
 * The two bytes that open a frame, as hex: what an answer is filed under and what a frame
 * arriving is looked up by, so the two halves of that convention cannot drift apart.
 */
const openKey = (bytes: readonly number[]): string => Buffer.from(bytes.slice(0, 2)).toString('hex')

/** A frame's command byte: the family's own second byte. */
const commandOf = (bytes: readonly number[]): number => bytes[1] ?? -1

/**
 * The desk's own replies, keyed by the two bytes that open the frame that asked for them.
 *
 * A from-desk frame is a reply when it follows a client frame and carries that frame's own
 * command or the next one: the capture shows the hello answered in its own form, `7f 01`
 * answered `7f 02 …`, `7f 0b` by `7f 0c …` and `7f 11` by `7f 12 …`. What that rule leaves out
 * is the desk's own pushes — the `7f 08 …` tables and strip names the capture holds after a
 * client frame they do not answer — and this peer sends none of them: what the desk pushes
 * unasked is the desk's, and standing in for it would be standing in for more than the
 * capture shows.
 *
 * One answer set per opening pair, not one per request: a frame the capture shows twice keeps
 * the last answers it holds, because a map set is a replacement rather than an append and the
 * reply rule has nothing to tell two requests of the same shape apart.
 */
function repliesFrom(exchanges: SqNativeExchange[]): Map<string, number[][]> {
  const chunks = exchanges.map((exchange) => ({
    direction: exchange.direction,
    bytes: [...Buffer.from(exchange.bytes, 'hex')]
  }))
  const replies = new Map<string, number[][]>()
  for (let index = 0; index < chunks.length; index++) {
    const request = chunks[index]
    if (request.direction !== 'to-desk' || request.bytes[0] !== FAMILY_7F) continue
    const command = commandOf(request.bytes)
    const answers: number[][] = []
    for (let next = index + 1; next < chunks.length && chunks[next].direction === 'from-desk'; next++) {
      const answer = chunks[next].bytes
      if (answer[0] !== FAMILY_7F) continue
      if (commandOf(answer) === command || commandOf(answer) === command + 1) answers.push(answer)
    }
    // The desk's own pushes are not in `answers`, so a frame the capture does not answer is
    // not keyed at all: it gets nothing back, which is what the capture shows it getting.
    if (answers.length > 0) replies.set(openKey(request.bytes), answers)
  }
  return replies
}

/* ------------------------------------------------------------------- the record */

/**
 * A session frame: the `7f` family, whose command is the protocol's own — the hello and the
 * ping (`00`), the identify (`01`), the descriptor (`14`), the settle (`0b`), the layout push
 * (`0a`) with the `0d` and `11` that follow it, and the `03` the session ends with. Nothing
 * here reads their payloads, because nothing in the capture says what the desk makes of them.
 */
export interface SqNativeSessionFrame {
  kind: 'session'
  /** Epoch milliseconds when the frame arrived. */
  at: number
  /** The exact wire bytes of the frame. */
  bytes: number[]
  /**
   * The frame's command byte: `0x00` is the hello and the ping, `0x0a` the layout push, `0x0b`
   * the settle, and `0x03` the frame the capture's session ends with.
   */
  command: number
}

/** One (input, fader) pair: what a membership is written with, one frame each. */
export interface SqNativePairFrame {
  kind: 'pair'
  at: number
  bytes: number[]
  /** The input's own number, from one, which is its place in the show's channel list. */
  channel: number
  /** The fader's own number, from one. */
  dca: number
  /** Whether the frame places the pair or clears it. */
  placed: boolean
}

/**
 * The per-channel flag that follows a pair. The capture's own pairing fixes its polarity: the
 * four channels its `1d … 01 00` frames place are the four written `00 00 00`, and the twelve
 * they leave alone are written `00 01 00`.
 */
export interface SqNativeFlagFrame {
  kind: 'flag'
  at: number
  bytes: number[]
  channel: number
  /** Whether the channel rides a fader at all after this write. */
  rides: boolean
}

/** `BYE.` on the range's own leave port, which is how a client lets the desk go. */
export interface SqNativeGoodbyeFrame {
  kind: 'goodbye'
  at: number
  bytes: number[]
}

/** Anything this peer does not read: the desk's own pushes, a value the capture never shows. */
export interface SqNativeRawFrame {
  kind: 'raw'
  at: number
  bytes: number[]
}

export type SqNativeReceived =
  | SqNativeSessionFrame
  | SqNativePairFrame
  | SqNativeFlagFrame
  | SqNativeGoodbyeFrame
  | SqNativeRawFrame

/**
 * One frame's bytes as this peer reads them, at the time they arrived.
 *
 * The pair and the flag are read the way the capture's own bytes read — a value of `01` places
 * a pair and `00` clears it, and the flag's middle byte is `00` where a channel rides a fader
 * and `01` where it rides none — and any other value is left raw rather than guessed at.
 */
function decode(bytes: number[], at: number): SqNativeReceived {
  if (bytes[0] === FAMILY_7F && bytes.length >= 2) return { kind: 'session', at, bytes, command: bytes[1] }
  if (bytes[0] === FAMILY_F7 && bytes.length === F7_FRAME_BYTES && bytes[1] === MEMBERSHIP[0] && bytes[2] === MEMBERSHIP[1]) {
    if (bytes[3] === PAIR_FRAME && bytes[7] === 0x00 && (bytes[6] === 0x00 || bytes[6] === 0x01)) {
      return { kind: 'pair', at, bytes, channel: bytes[4] + 1, dca: bytes[5] + 1, placed: bytes[6] === 0x01 }
    }
    if (bytes[3] === RIDES_FRAME && bytes[5] === 0x00 && bytes[7] === 0x00 && (bytes[6] === 0x00 || bytes[6] === 0x01)) {
      return { kind: 'flag', at, bytes, channel: bytes[4] + 1, rides: bytes[6] === 0x00 }
    }
  }
  return { kind: 'raw', at, bytes }
}

/* ------------------------------------------------------------------- the reader */

/**
 * One socket's bytes in, whole frames out. Two families share the stream — `7f` with its
 * command and a little-endian length, `f7` in its fixed eight bytes — and a frame may arrive
 * across several chunks or several to one. Bytes that cannot open a frame are stepped over,
 * and a length past the ceiling is a stream that has lost its place rather than a long
 * message; the app's own reader makes the same judgement, and this one is written again here
 * because a peer that shared the codec could not disagree with it.
 */
class FrameReader {
  private held: number[] = []

  push(chunk: Uint8Array): number[][] {
    this.held.push(...chunk)
    const frames: number[][] = []
    for (;;) {
      const frame = this.take()
      if (frame === null) return frames
      frames.push(frame)
    }
  }

  /** The next whole frame, or null when what is held is not one yet. */
  private take(): number[] | null {
    for (;;) {
      if (this.held.length === 0) return null
      const lead = this.held[0]
      if (lead !== FAMILY_7F && lead !== FAMILY_F7) {
        this.held.shift()
        continue
      }
      if (lead === FAMILY_F7) {
        if (this.held.length < F7_FRAME_BYTES) return null
        return this.held.splice(0, F7_FRAME_BYTES)
      }
      if (this.held.length < HEADER_BYTES) return null
      const length = (this.held[2] | (this.held[3] << 8) | (this.held[4] << 16) | (this.held[5] << 24)) >>> 0
      if (length > MAX_PAYLOAD_BYTES) {
        this.held.shift()
        continue
      }
      if (this.held.length < HEADER_BYTES + length) return null
      return this.held.splice(0, HEADER_BYTES + length)
    }
  }
}

/* ------------------------------------------------------------------ the peer itself */

export interface SqNativePeerOptions {
  /** The control service's port: 51326 by default, which is what the app dials for any SQ show. */
  port?: number
  /** Loopback by default; pass 0.0.0.0 to let another machine drive the peer. */
  host?: string
  /** The port the range's own leave channel binds. 51321 by default. */
  leavePort?: number
  /** The UDP port the session's keepalive arrives on. 51324 by default. */
  keepalivePort?: number
  /** The capture to answer from and to read frames against. Defaults to the repository's own. */
  capture?: string
  /** How many decoded frames `received` keeps before dropping the oldest. */
  receivedLimit?: number
}

export interface SqNativePeer {
  host: string
  /** The port the control service bound, so a spec started on 0 can connect to it. */
  port: number
  /** The port the leave channel bound, where `BYE.` arrives. */
  leavePort: number
  /** The port the keepalive datagrams arrive on. */
  keepalivePort: number
  /**
   * What the client wrote, in arrival order and decoded — the service's frames and the leave
   * channel's `BYE.` together, because they are one session to a lane. Capped at
   * `receivedLimit`, and so is every other list here.
   */
  received: SqNativeReceived[]
  /** The frames this peer sent: the capture's own replies, in the order it sent them. */
  sent: number[][]
  /**
   * The keepalive datagrams that arrived, witnessed as arrival and width alone: the capture
   * holds none, so what the desk makes of the body is not measured and nothing here reads it.
   */
  keepalives: Array<{ at: number; length: number }>
  /** How many clients are attached to the control service now. */
  clients: number
  close(): Promise<void>
}

/** A TCP server on its own port, or the rejection that kept it off. */
async function listen(server: Server, port: number, host: string): Promise<number> {
  const bound = Promise.withResolvers<number>()
  server.once('error', bound.reject)
  server.listen(port, host, () => {
    // The rejection handler goes and a listener stays: `server.listen`'s callback is not the
    // last word on the socket, and a server that fails later emits `error` — an unhandled one
    // takes the whole worker with it, and a lane's failure message is worth more than that.
    server.off('error', bound.reject)
    server.on('error', () => {})
    bound.resolve((server.address() as AddressInfo).port)
  })
  return bound.promise
}

/** The UDP socket on its own port, for the same reason and with the same promise. It needs no
 *  listener of its own here: the caller keeps one on the socket for the session's life. */
async function bind(datagrams: DatagramSocket, port: number, host: string): Promise<number> {
  const bound = Promise.withResolvers<number>()
  datagrams.once('error', bound.reject)
  datagrams.bind(port, host, () => {
    datagrams.off('error', bound.reject)
    bound.resolve((datagrams.address() as AddressInfo).port)
  })
  return bound.promise
}

/** A server gone, whether it ever listened or not — and settled either way. */
function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      server.close(() => resolve())
    } catch {
      // Never listened, so nothing to close: the caller is waiting.
      resolve()
    }
  })
}

/**
 * The desk's own control service, answering as the capture says it answers.
 *
 * Three ports belong to it and all three are bound: the service itself, the leave channel a
 * client says `BYE.` on, and the port the session's keepalive goes to. A lane that drives the
 * app binds the fixed ones, because the app dials them wherever the show is pointed; a lane
 * that drives a socket of its own passes 0 for the lot.
 */
export async function startSqNativePeer(options: SqNativePeerOptions = {}): Promise<SqNativePeer> {
  const host = options.host ?? '127.0.0.1'
  const receivedLimit = options.receivedLimit ?? 5000
  const replies = repliesFrom(readCapture(options.capture).exchanges)
  const received: SqNativeReceived[] = []
  const sent: number[][] = []
  const keepalives: Array<{ at: number; length: number }> = []
  const clients = new Set<Socket>()
  const leaves = new Set<Socket>()

  /**
   * Everything this peer records is capped the same way, and for the same reason `received`
   * was: a lane holds a session open for as long as it runs, a ping and a datagram arrive on
   * their own cadence whether or not anything is asserted, and an unbounded array in a peer
   * is a leak with a suite's lifetime on it.
   */
  function cap<T>(list: T[]): void {
    if (list.length > receivedLimit) list.splice(0, list.length - receivedLimit)
  }

  function remember(frame: SqNativeReceived): void {
    received.push(frame)
    cap(received)
  }

  /**
   * One frame a client wrote: recorded as it decodes, then answered with the capture's own
   * reply where the capture holds one. A frame it does not answer gets nothing — which is
   * the whole of what this peer knows about a membership read.
   */
  function handle(socket: Socket, bytes: number[]): void {
    remember(decode(bytes, Date.now()))
    for (const answer of replies.get(openKey(bytes)) ?? []) {
      socket.write(Buffer.from(answer))
      sent.push(answer)
      cap(sent)
    }
  }

  const service: Server = createServer((socket) => {
    const reader = new FrameReader()
    clients.add(socket)
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
    socket.on('data', (chunk) => {
      for (const frame of reader.push(chunk)) handle(socket, frame)
    })
  })

  const leave: Server = createServer((socket) => {
    // The goodbye is read out of what the channel has accumulated rather than out of one
    // chunk: TCP splits what it likes, and a four-byte word is exactly the sort of thing it
    // splits. What is held is a prefix of the word or it is nothing to do with one.
    let held: number[] = []
    leaves.add(socket)
    socket.on('close', () => leaves.delete(socket))
    socket.on('error', () => leaves.delete(socket))
    socket.on('data', (chunk) => {
      const at = Date.now()
      const bytes = [...chunk]
      held.push(...bytes)
      const soFar = held.every((byte, index) => byte === GOODBYE[index])
      if (soFar && held.length < GOODBYE.length) return
      if (soFar) {
        remember({ kind: 'goodbye', at, bytes: held })
        held = []
        return
      }
      // Anything that is not the word is recorded as it arrived rather than read as a leave,
      // and the accumulator starts again — so a stray byte before a real `BYE.` cannot hide it.
      remember({ kind: 'raw', at, bytes })
      held = []
    })
  })

  const datagrams = createSocket('udp4')
  datagrams.on('error', () => {
    // A datagram the kernel hands back is not what ends a session, and this peer holds no
    // session to end.
  })
  datagrams.on('message', (message) => {
    keepalives.push({ at: Date.now(), length: message.length })
    cap(keepalives)
  })

  let ports: [number, number, number]
  try {
    ports = await Promise.all([
      listen(service, options.port ?? NATIVE_TCP_PORT, host),
      listen(leave, options.leavePort ?? NATIVE_LEAVE_PORT, host),
      bind(datagrams, options.keepalivePort ?? NATIVE_KEEPALIVE_PORT, host)
    ])
  } catch (error) {
    // One of the three could not be taken — somebody else holds the desk's port, which is a
    // state a lane reports rather than a peer to leave behind. What did bind is closed before
    // the failure leaves, so nothing is listening on a port no caller can reach.
    await Promise.all([closeServer(service), closeServer(leave)])
    try {
      datagrams.close()
    } catch {
      // Never bound, so never running: nothing to close.
    }
    throw error
  }
  const [port, leavePort, keepalivePort] = ports

  return {
    host,
    port,
    leavePort,
    keepalivePort,
    received,
    sent,
    keepalives,
    get clients(): number {
      return clients.size
    },
    async close() {
      for (const socket of clients) socket.destroy()
      for (const socket of leaves) socket.destroy()
      clients.clear()
      leaves.clear()
      await Promise.all([
        closeServer(service),
        closeServer(leave),
        new Promise<void>((resolve) => {
          try {
            datagrams.close(() => resolve())
          } catch {
            // Never bound, or already closed: nothing to close, and the caller is waiting.
            resolve()
          }
        })
      ])
    }
  }
}
