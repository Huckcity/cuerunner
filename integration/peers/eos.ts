// An ETC Eos family console, as far as a client on the wire can tell.
//
// WinsLab's OSC integration is written against this rather than against a console on the
// bench. Every address, argument order and argument type below comes from ETC's own
// documentation for Eos v3.3.x — the OSC Dictionary (OSC Inputs / OSC Outputs) and the
// OSC Get page under "Show Control > OSC > Third-Party Integration" — so a spec can hold
// the app to the vendor's worked examples instead of to this file's opinion.
//
// Running the file directly starts the same peer as a tool: point QLab, Protokol or a
// Bitfocus Companion at the printed port and watch what an integration of your own says.
//
// Assumptions this peer makes, where the documentation is silent or a client is likely to
// differ, are marked "Assumption:" in the comments below.

import { createSocket } from 'node:dgram'
import type { RemoteInfo, Socket as UdpSocket } from 'node:dgram'
import { createServer } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'

// ── OSC 1.0 ─────────────────────────────────────────────────────────────────

/** A message argument: int32, float32, string, or the no-payload T/F pair. */
export type OscArg = number | string | boolean

export interface OscMessage {
  address: string
  args: OscArg[]
}

/** An OSC-string: UTF-8, NUL-terminated, then NUL-padded out to four bytes. */
function oscString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  const cell = Buffer.alloc((bytes.length + 4) & ~3)
  bytes.copy(cell)
  return cell
}

/** Read an OSC-string at `offset`, and say where the next one starts. */
function readString(buffer: Buffer, offset: number): { value: string; next: number } | null {
  const end = buffer.indexOf(0, offset)
  if (end === -1) return null
  return { value: buffer.toString('utf8', offset, end), next: (end + 4) & ~3 }
}

function typeTags(args: OscArg[]): string {
  let tags = ','
  for (const arg of args) {
    if (typeof arg === 'string') tags += 's'
    else if (typeof arg === 'number') tags += Number.isInteger(arg) ? 'i' : 'f'
    else tags += arg ? 'T' : 'F'
  }
  return tags
}

export function encodeOsc(message: OscMessage): Buffer {
  const cells: Buffer[] = [oscString(message.address), oscString(typeTags(message.args))]
  for (const arg of message.args) {
    if (typeof arg === 'string') {
      cells.push(oscString(arg))
    } else if (typeof arg === 'number') {
      const cell = Buffer.alloc(4)
      if (Number.isInteger(arg)) cell.writeInt32BE(arg)
      else cell.writeFloatBE(arg)
      cells.push(cell)
    }
  }
  return Buffer.concat(cells)
}

/**
 * Decode one packet. Nothing a client can put on a UDP socket may throw here: a peer
 * taken down by a malformed datagram takes the spec's own failure message with it, so an
 * unreadable packet decodes to no messages rather than an exception.
 *
 * Bundles are unwrapped and their timetag dropped: this stands in for a device, and a
 * device does not schedule its client's messages.
 */
export function decodeOscPacket(buffer: Buffer): OscMessage[] {
  if (buffer.subarray(0, 7).toString('ascii') === '#bundle') {
    const messages: OscMessage[] = []
    let offset = 16 // "#bundle" + NUL + the 8-byte timetag
    while (offset + 4 <= buffer.length) {
      const size = buffer.readInt32BE(offset)
      offset += 4
      if (size <= 0 || offset + size > buffer.length) break
      messages.push(...decodeOscPacket(buffer.subarray(offset, offset + size)))
      offset += size
    }
    return messages
  }

  const address = readString(buffer, 0)
  if (!address || !address.value.startsWith('/')) return []
  const message: OscMessage = { address: address.value, args: [] }
  // OSC 1.1 lets the type-tag string be dropped when there are no arguments.
  if (address.next >= buffer.length) return [message]

  const tags = readString(buffer, address.next)
  if (!tags || !tags.value.startsWith(',')) return [message]

  let offset = tags.next
  for (const tag of tags.value.slice(1)) {
    if (tag === 'T' || tag === 'F') {
      message.args.push(tag === 'T')
      continue
    }
    if (tag === 'i' || tag === 'f') {
      if (offset + 4 > buffer.length) break
      message.args.push(tag === 'i' ? buffer.readInt32BE(offset) : buffer.readFloatBE(offset))
      offset += 4
      continue
    }
    if (tag === 's') {
      const value = readString(buffer, offset)
      if (!value || value.next > buffer.length) break
      message.args.push(value.value)
      offset = value.next
      continue
    }
    // Blob, timetag, MIDI, ...: the length of the payload is not something to guess at,
    // so the arguments read so far are the message.
    break
  }
  return [message]
}

// ── The show ────────────────────────────────────────────────────────────────

export interface EosCue {
  /** Cue list number, as the console numbers them. */
  list: number
  number: number
  label: string
  /**
   * Cue time in seconds — the unit `/eos/out/active/cue/text` prints ("1/1 Label 5.0").
   * The list packets carry milliseconds, as the dictionary's own example does: 5000 for
   * a five-second cue.
   */
  upTime?: number
  /** Parts above the base cue. The dictionary's part count is "not including base cue". */
  parts?: number
  notes?: string
  scene?: string
}

/** A cue as it is being played back, which is what the active/pending strings describe. */
export interface EosPlaybackCue {
  list: number
  cue: number
  part: number
  label: string
}

export interface EosCueListBank {
  bank: number
  list: number
  /** Rows the console was asked to show before and after the current cue. */
  prev: number
  pending: number
  /** The 0-based cue the window starts at, after the current cue was accounted for. */
  offset: number
  rows: Array<{ index: number; cue: number; label: string; notes: string; scene: string; duration: number }>
}

/** What the peer thinks, which is what the control endpoint serves as JSON. */
export interface EosState {
  version: string
  fixtureLibraryVersion: string
  cueSendString: string | null
  subscribers: number
  /** Per cue list, how many notifications have gone out. They only count upward. */
  sequences: Record<number, number>
  playback: Record<number, { active: EosPlaybackCue | null; pending: EosPlaybackCue | null }>
  banks: Record<number, EosCueListBank>
  lastKey: string | null
  lastCommand: string | null
  /** The last thing a handler choked on, so a human can curl it rather than guess. */
  lastError: string | null
}

export interface EosInbound extends OscMessage {
  at: number
  from: { address: string; port: number }
}

export interface EosOutbound extends OscMessage {
  at: number
  to: { address: string; port: number }
}

export interface EosPeerOptions {
  /** Default 127.0.0.1: a peer on the loopback is what a spec wants, and a device on the
   *  network is what `--host 0.0.0.0` is for. */
  host?: string
  /** 0 — the default — binds an ephemeral port, so two specs never fight over 8000. */
  port?: number
  /** Undefined starts no control endpoint; 0 takes an ephemeral port, as the UDP side does. */
  controlPort?: number
  cues?: EosCue[]
  /** Setup > System > Show Control > OSC > OSC Cue Send String. */
  cueSendString?: string
  /**
   * Setup > System > Show Control > OSC > OSC UDP TX IP Address and OSC UDP TX Port. With
   * one configured, everything the peer sends goes there — a console has a single OSC
   * output and does not care who asked. Without one the peer falls back to the client that
   * is talking to it, which is what makes it usable as a tool from a laptop.
   */
  tx?: { host: string; port: number }
  version?: string
  fixtureLibraryVersion?: string
  /** Every message either way, for a human watching the tool. */
  log?: (line: string) => void
}

export interface EosPeer {
  host: string
  /** The port the socket actually bound. */
  port: number
  controlPort: number | null
  /** Where unsolicited output goes, when a destination was configured. */
  tx: { host: string; port: number } | null
  /** What clients sent, decoded, in the order it arrived. */
  received: EosInbound[]
  /** What the peer put on the wire, decoded, in the order it went out. */
  sent: EosOutbound[]
  state: EosState
  close(): Promise<void>
}

// Cue 12 is here because that is where the operator's cue send string example lands:
// `%1` of cue 12 is how `/go/12` gets on the wire.
const DEFAULT_SHOW: EosCue[] = [
  { list: 1, number: 1, label: 'Preshow', upTime: 3 },
  { list: 1, number: 2, label: 'Act One', upTime: 5, parts: 2, notes: 'wings' },
  { list: 1, number: 12, label: 'Blackout', upTime: 2 },
  { list: 2, number: 1, label: 'Encore', upTime: 4 }
]

/** The dictionary's cue packet, argument by argument: see `cueArguments`. */
const CUE_ARGUMENTS = 31

/** An address segment that has to be a number for the message to mean anything. */
function segment(value: string | undefined): number | null {
  if (value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** A stable UID: derived from list and cue number so a client sees the same one every
 *  run, where a console mints one per cue and quotes it back for the life of the show. */
function cueUid(list: number, cue: EosCue): string {
  const tail = (list * 1_000_000 + Math.round(cue.number * 1000)).toString(16).toUpperCase().padStart(12, '0')
  return `00000000-0000-0000-0000-${tail}`
}

interface CueList {
  label: string
  cues: EosCue[]
  byNumber: Map<number, EosCue>
}

interface Target {
  address: string
  port: number
  subscribed: boolean
}

/** The port something is bound to. A socket reports a path when it is a unix socket and
 *  nothing at all before it listens; neither is a case this peer can be in. */
function boundPort(of: { address(): string | AddressInfo | null }, what: string): number {
  const bound = of.address()
  if (typeof bound === 'string' || bound === null) throw new Error(`${what} is not bound to a port`)
  return bound.port
}

// ── The peer ────────────────────────────────────────────────────────────────

export async function startEosPeer(options: EosPeerOptions = {}): Promise<EosPeer> {
  const host = options.host ?? '127.0.0.1'
  const cueSendString = options.cueSendString ?? null
  const log = options.log

  const lists = new Map<number, CueList>()
  for (const cue of options.cues ?? DEFAULT_SHOW) {
    let list = lists.get(cue.list)
    if (!list) {
      list = { label: `Cue List ${cue.list}`, cues: [], byNumber: new Map() }
      lists.set(cue.list, list)
    }
    list.cues.push(cue)
    list.byNumber.set(cue.number, cue)
  }
  for (const list of lists.values()) list.cues.sort((a, b) => a.number - b.number)
  const listNumbers = [...lists.keys()].sort((a, b) => a - b)

  const state: EosState = {
    version: options.version ?? '3.3.6.0',
    fixtureLibraryVersion: options.fixtureLibraryVersion ?? '3.3.6.1',
    cueSendString,
    subscribers: 0,
    sequences: {},
    playback: {},
    banks: {},
    lastKey: null,
    lastCommand: null,
    lastError: null
  }

  const socket: UdpSocket = createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(options.port ?? 0, host, () => {
      socket.off('error', reject)
      resolve()
    })
  })
  const port = boundPort(socket, 'the OSC socket')

  const received: EosInbound[] = []
  const sent: EosOutbound[] = []
  const targets = new Map<string, Target>()
  let lastSender: Target | null = null
  const tx: Target | null = options.tx ? { address: options.tx.host, port: options.tx.port, subscribed: false } : null

  /**
   * Who gets a message: the configured OSC TX destination if there is one, otherwise the
   * clients that subscribed, otherwise whoever last spoke. Assumption: a client cannot
   * say where it wants a cue event — a console's output destination is configured in the
   * desk, not in the message — so with no TX destination the peer answers the client it
   * is talking to, which is what makes driving it by hand work. A notification is only
   * ever what a subscription buys, so with neither a destination nor a subscriber there
   * is nobody to notify.
   */
  function outputTargets(subscribedOnly: boolean): Target[] {
    if (tx) return [tx]
    const subscribed = [...targets.values()].filter((target) => target.subscribed)
    if (subscribed.length > 0) return subscribed
    return subscribedOnly || !lastSender ? [] : [lastSender]
  }

  function send(message: OscMessage, subscribedOnly = false): void {
    for (const target of outputTargets(subscribedOnly)) {
      // A client that stopped listening is not this peer's problem: the error a UDP send
      // would report is the socket's, and nothing here can act on it.
      socket.send(encodeOsc(message), target.port, target.address, () => {})
      sent.push({ ...message, at: Date.now(), to: { address: target.address, port: target.port } })
    }
    log?.(`> ${describe(message)}`)
  }

  function describe(message: OscMessage): string {
    return message.args.length === 0 ? message.address : `${message.address} ${JSON.stringify(message.args)}`
  }

  function playbackFor(list: number): EosState['playback'][number] {
    const playback = state.playback[list]
    if (playback) return playback
    const created: EosState['playback'][number] = { active: null, pending: null }
    state.playback[list] = created
    return created
  }

  /**
   * The dictionary's empty target packet: the target address and no arguments. It is what
   * a console sends for a cue that does not exist. Assumption: this peer answers *any*
   * instruction naming a cue it cannot resolve with it, so a client sees the refusal on a
   * documented address instead of inferring it from silence.
   */
  function refuse(list: number, cue: number, part: number): void {
    send({ address: `/eos/out/get/cue/${list}/${cue}/${part}`, args: [] })
  }

  /**
   * The cue packet, in the dictionary's order and of its types: list index, UID, label,
   * the five time/delay pairs, preheat, curve, rate, mark, block, assert, link, follow,
   * hang, all fade, loop, solo, timecode, part count, notes, scene, scene end, part
   * index. That is 31 arguments, sent as one packet — the `/list/<arg index>/<arg count>`
   * convention is what lets a console split them, and zero is where this one starts.
   */
  function cueArguments(list: number, cue: EosCue, part: number): OscArg[] {
    return [
      list,
      cueUid(list, cue),
      cue.label,
      Math.round((cue.upTime ?? 0) * 1000), 0,
      0, 0,
      0, 0,
      0, 0,
      0, 0,
      false,
      0,
      100,
      '', '', '',
      -1,
      0, 0,
      false,
      0,
      false,
      '',
      cue.parts ?? 0,
      cue.notes ?? '',
      cue.scene ?? '',
      false,
      part === 0 ? -1 : part
    ]
  }

  function answerCue(list: number, cue: number, part: number): void {
    const found = lists.get(list)?.byNumber.get(cue)
    if (!found || part > (found.parts ?? 0)) {
      refuse(list, cue, part)
      return
    }
    const address = `/eos/out/get/cue/${list}/${cue}/${part}/list/0/${CUE_ARGUMENTS}`
    send({ address, args: cueArguments(list, found, part) })
  }

  /** The console's implicit cue string, which the active and pending output both use. */
  function cueText(list: number, cue: EosCue): string {
    return `${list}/${cue.number} ${cue.label} ${(cue.upTime ?? 0).toFixed(1)}`
  }

  /**
   * Tell subscribers that a cue changed. The dictionary's list convention is in the
   * address: the packet starts at argument 0, and the count is the whole logical list —
   * the sequence number and the ids that changed.
   */
  function notify(list: number, cue: number): void {
    if (outputTargets(true).length === 0) return
    const sequence = (state.sequences[list] ?? 0) + 1
    state.sequences[list] = sequence
    const args: OscArg[] = [sequence, cue]
    send({ address: `/eos/out/notify/cue/${list}/list/0/${args.length}`, args }, true)
  }

  /**
   * An OSC Cue Send String replaces the cue event message — that is how an operator makes
   * Eos say `/go/12` instead of `/eos/out/event/cue/1/12/fire`. Wildcards, as the online
   * help lists them: %1 cue number, %2 cue list number, %3 cue whole number, %4 cue point
   * number, %5 cue label. Assumption: they are substituted as written, since the console
   * does not escape them either — a label with a space in it makes an address that is not
   * legal OSC, and a format string that quotes labels should say so.
   */
  function cueSendAddress(format: string, list: number, cue: EosCue): string {
    const number = String(cue.number)
    const [whole, point = '0'] = number.split('.')
    const values: Record<string, string> = { '1': number, '2': String(list), '3': whole, '4': point, '5': cue.label }
    return format.replace(/%([1-5])/g, (match, index: string) => values[index] ?? match)
  }

  function fire(list: number, cue: number, part: number): void {
    const entry = lists.get(list)
    const found = entry?.byNumber.get(cue)
    if (!entry || !found || part > (found.parts ?? 0)) {
      refuse(list, cue, part)
      return
    }

    const playback = playbackFor(list)
    playback.active = { list, cue, part, label: found.label }
    const next = entry.cues[entry.cues.indexOf(found) + 1]
    playback.pending = next ? { list, cue: next.number, part: 0, label: next.label } : null

    const event: OscMessage = cueSendString
      ? { address: cueSendAddress(cueSendString, list, found), args: [] }
      : { address: `/eos/out/event/cue/${list}/${cue}/fire`, args: [found.label] }
    send(event)
    send({ address: '/eos/out/active/cue/text', args: [cueText(list, found)] })
    // Nothing is pending at the end of a list, and a console does not invent a cue to
    // say is next.
    if (next) send({ address: '/eos/out/pending/cue/text', args: [cueText(list, next)] })

    notify(list, cue)
  }

  /**
   * [Go] on the main playback: fire what is pending, and start the list if nothing has
   * ever run on it. At the end of a list nothing is pending and nothing happens, as on a
   * console. Keys the peer does not model are recorded and nothing else.
   */
  function pressKey(key: string): void {
    state.lastKey = key
    if (key !== 'go' && key !== 'go_0') return
    const list = listNumbers[0]
    if (list === undefined) return
    const playback = playbackFor(list)
    const next = playback.pending?.cue ?? (playback.active ? null : lists.get(list)?.cues[0]?.number)
    if (next !== null && next !== undefined) fire(list, next, 0)
  }

  /**
   * `/eos/cuelist/<bank>/config/<list>/<prev>/<pending>[/<offset>]`: which cue list an OSC
   * bank should show and how much of it. The console answers by pushing the bank's label
   * and then a row per cue in the window.
   */
  function configureBank(bank: number, list: number, prev: number, pending: number, offset: number | null): void {
    const entry = lists.get(list)
    const cues = entry?.cues ?? []
    const active = state.playback[list]?.active
    const activeIndex = active ? cues.findIndex((cue) => cue.number === active.cue) : -1
    // Rows before and after the current cue, per the dictionary; when the optional
    // offset is given the window starts at that 0-based cue instead, which is what a
    // caller paging a bank away from the current cue is asking for.
    const start = offset ?? Math.max(0, activeIndex - prev)
    const window = cues.slice(start, start + prev + 1 + pending)

    state.banks[bank] = {
      bank,
      list,
      prev,
      pending,
      offset: start,
      rows: window.map((cue, index) => ({
        index: index + 1,
        cue: cue.number,
        label: cue.label,
        notes: cue.notes ?? '',
        scene: cue.scene ?? '',
        duration: Math.round((cue.upTime ?? 0) * 1000)
      }))
    }

    // The dictionary types <total cues> as a String and its own example sends 10
    // unquoted; the example is what a client parses, so an int goes on the wire.
    send({ address: `/eos/out/cuelist/${bank}`, args: [entry?.label ?? `Cue List ${list}`, cues.length, 0] })
    for (const row of state.banks[bank].rows) {
      const args: OscArg[] = [
        `${row.cue} ${row.label}`, // <OSC label>: the cue number and the label
        String(row.cue),
        row.label,
        row.notes,
        row.scene,
        false, // scene end
        row.duration,
        -1 // remaining: -1 when the cue is not counting down
      ]
      send({ address: `/eos/out/cuelist/${bank}/${row.index}`, args })
    }
  }

  function handle(message: OscMessage, from: Target): void {
    const raw = message.address
    const equals = raw.indexOf('=')
    const segments = (equals === -1 ? raw : raw.slice(0, equals)).split('/')
    // ETC writes a message's first argument as `address=value`. Whether that value is in
    // the address or in the argument list is up to the client's OSC library, so both
    // spellings are read here: `/eos/subscribe=1` and `/eos/subscribe` with an int 1.
    const inline = equals === -1 ? null : raw.slice(equals + 1)
    const at = (...expected: string[]): boolean => expected.every((value, index) => segments[index + 2] === value)

    if (segments[1] !== 'eos') return

    if (segments.length === 3 && at('ping')) {
      send({ address: '/eos/out/ping', args: message.args })
      return
    }

    if (segments.length === 4 && at('get', 'version')) {
      send({ address: '/eos/out/get/version', args: [state.version, state.fixtureLibraryVersion, 0] })
      return
    }

    if (segments.length === 5 && at('get', 'cuelist', 'count')) {
      send({ address: '/eos/out/get/cuelist/count', args: [listNumbers.length] })
      return
    }

    if (at('get', 'cue') && segments.length === 6 && segments[5] === 'count') {
      const list = segment(segments[4])
      if (list === null) return
      send({ address: `/eos/out/get/cue/${list}/count`, args: [lists.get(list)?.cues.length ?? 0] })
      return
    }

    if (at('get', 'cue') && (segments.length === 6 || segments.length === 7)) {
      const list = segment(segments[4])
      const cue = segment(segments[5])
      const part = segments.length === 7 ? segment(segments[6]) : 0
      if (list === null || cue === null || part === null) return
      answerCue(list, cue, part)
      return
    }

    if (segments.length === 4 && at('cue', 'fire')) {
      // `/eos/cue/fire=<cue>`, where <cue> is a cue number on its own or the
      // `<list>/<cue>[/<part>]` form the other spellings use. Assumption: a bare number
      // is a cue on the first cue list, which is the one a console has selected.
      const target = inline ?? (typeof message.args[0] === 'number' ? String(message.args[0]) : null)
      if (target === null) return
      const [list, cue, part] = target.split('/')
      const listNumber = segment(list)
      const cueNumber = segment(cue)
      if (listNumber === null) return
      if (cueNumber === null) {
        fire(listNumbers[0] ?? listNumber, listNumber, segment(part ?? '0') ?? 0)
        return
      }
      fire(listNumber, cueNumber, segment(part ?? '0') ?? 0)
      return
    }

    if (at('cue') && segments[segments.length - 1] === 'fire' && (segments.length === 5 || segments.length === 6 || segments.length === 7)) {
      const [list, cue, part] =
        segments.length === 5
          ? [listNumbers[0] ?? 1, segment(segments[3]), 0]
          : segments.length === 6
            ? [segment(segments[3]), segment(segments[4]), 0]
            : [segment(segments[3]), segment(segments[4]), segment(segments[5])]
      if (list === null || cue === null || part === null) return
      fire(list, cue, part)
      return
    }

    if (segments.length === 4 && at('key')) {
      pressKey(segments[3])
      return
    }

    if (segments.length === 3 && at('cmd')) {
      const command = typeof message.args[0] === 'string' ? message.args[0] : null
      if (command === null) return
      state.lastCommand = command
      // The dictionary's output is `"LIVE: Cue 1 : Chan 1 #", 0` — the command line as
      // the console took it, and an error flag. This peer has no command line to echo,
      // so it repeats what it was handed, terminated the way a console terminates one.
      send({ address: '/eos/out/cmd', args: [command.endsWith('#') ? command : `${command} #`, 0] })
      return
    }

    if (at('cuelist') && segments[4] === 'config' && (segments.length === 8 || segments.length === 9)) {
      const bank = segment(segments[3])
      const list = segment(segments[5])
      const prev = segment(segments[6])
      const pending = segment(segments[7])
      const offset = segments.length === 9 ? segment(segments[8]) : null
      if (bank === null || list === null || prev === null || pending === null) return
      configureBank(bank, list, prev, pending, offset)
      return
    }

    if (segments.length === 3 && at('subscribe')) {
      const flag = inline === null ? message.args[0] : Number(inline)
      if (flag !== 0 && flag !== 1) return
      from.subscribed = flag === 1
      state.subscribers = [...targets.values()].filter((target) => target.subscribed).length
      return
    }
    // Anything else — a typo, an address this peer does not implement, a target it has
    // never heard of — is what a device does with it: nothing.
  }

  socket.on('message', (packet: Buffer, rinfo: RemoteInfo) => {
    const key = `${rinfo.address}:${rinfo.port}`
    let target = targets.get(key)
    if (!target) {
      target = { address: rinfo.address, port: rinfo.port, subscribed: false }
      targets.set(key, target)
    }
    lastSender = target

    for (const message of decodeOscPacket(packet)) {
      received.push({ ...message, at: Date.now(), from: { address: rinfo.address, port: rinfo.port } })
      log?.(`< ${describe(message)}`)
      try {
        handle(message, target)
      } catch (error) {
        state.lastError = `${message.address}: ${error instanceof Error ? error.message : String(error)}`
        log?.(`! ${state.lastError}`)
      }
    }
  })

  // A socket error after binding is not something a peer can recover from, but it must
  // not become an uncaught exception in the spec process either.
  socket.on('error', (error: Error) => {
    state.lastError = `socket: ${error.message}`
    log?.(`! ${state.lastError}`)
  })

  let control: HttpServer | null = null
  let controlPort: number | null = null
  if (options.controlPort !== undefined) {
    control = createServer((request, response) => {
      if ((request.url ?? '').split('?')[0] !== '/state') {
        response.writeHead(404, { 'content-type': 'text/plain' })
        response.end('the peer serves its state at /state\n')
        return
      }
      const body = {
        ...state,
        tx: options.tx ?? null,
        cues: [...lists.values()].flatMap((list) => list.cues),
        received: received.slice(-20),
        sent: sent.slice(-20)
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(`${JSON.stringify(body, null, 2)}\n`)
    })
    await new Promise<void>((resolve, reject) => {
      control?.once('error', reject)
      control?.listen(options.controlPort, host, () => {
        control?.off('error', reject)
        resolve()
      })
    })
    controlPort = boundPort(control, 'the control endpoint')
  }

  return {
    host,
    port,
    controlPort,
    tx: options.tx ?? null,
    received,
    sent,
    state,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        if (!control) {
          resolve()
          return
        }
        // A keep-alive connection would otherwise hold the close open, and a spec that
        // cannot shut its peer down hangs instead of failing.
        control.closeAllConnections()
        control.close(() => resolve())
      })
      await new Promise<void>((resolve) => socket.close(() => resolve()))
    }
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `An ETC Eos console on the wire.

  node integration/peers/eos.ts [--port N] [--host H] [--control N] [--cue-send-string S]
                                [--tx-host H --tx-port N]

  --port N              UDP port for OSC; 0, the default, takes an ephemeral one
  --host H              address to bind; 127.0.0.1 by default
  --control N           serve the peer's state as JSON on http://H:N/state
  --cue-send-string S   OSC Cue Send String, e.g. '/go/%1'
  --tx-host H           OSC UDP TX IP Address: where output goes, as a console with an
  --tx-port N           OSC destination configured sends it - Setup > System > Show
                        Control > OSC. Both are needed; without them the peer answers
                        whoever is talking to it, which is what hand-driving wants.`

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const equals = arg.indexOf('=')
    if (equals === -1) flags.set(arg.slice(2), argv[++index] ?? '')
    else flags.set(arg.slice(2, equals), arg.slice(equals + 1))
  }
  return flags
}

async function runCli(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  if (flags.has('help')) {
    console.log(USAGE)
    return
  }
  const numeric = (name: string): number | undefined => {
    const value = flags.get(name)
    return value === undefined ? undefined : Number(value)
  }
  const txHost = flags.get('tx-host')
  const txPort = numeric('tx-port')

  const peer = await startEosPeer({
    host: flags.get('host'),
    port: numeric('port'),
    controlPort: numeric('control'),
    cueSendString: flags.get('cue-send-string'),
    tx: txHost !== undefined && txPort !== undefined ? { host: txHost, port: txPort } : undefined,
    log: (line) => console.log(`${new Date().toISOString().slice(11, 23)} ${line}`)
  })

  console.log(`eos peer: osc udp ${peer.host}:${peer.port}`)
  if (peer.tx) console.log(`eos peer: output udp ${peer.tx.host}:${peer.tx.port}`)
  if (peer.controlPort !== null) console.log(`eos peer: state http://${peer.host}:${peer.controlPort}/state`)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void peer.close().then(() => process.exit(0))
    })
  }
}

// Running the file starts the peer; importing it — which is what a spec does — starts
// nothing.
if (process.argv[1]?.endsWith('eos.ts')) {
  runCli().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
