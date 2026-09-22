/**
 * A peer that stands in for an Allen & Heath SQ or Avantis mixer on the desk's MIDI-over-TCP
 * service, port 51325. It is an independent implementation of "SQ MIDI Protocol" Issue 5
 * (firmware V1.5+) and "Avantis MIDI TCP/IP Protocol" (firmware V2.0+), so a test can drive
 * real sockets, and it is a usable tool on its own:
 *
 *   node integration/peers/desk.ts --profile sq --port 51325
 *   node integration/peers/desk.ts --profile avantis --port 0 --control 8099
 *
 * Everything asserted against it is either bytes on the wire or the desk's own state; the
 * peer never reports on itself. Everything the desk receives is logged as it arrives, decoded
 * where the profile decodes it and raw where it does not — a message the desk ignores is still
 * a raw entry, because that a message came in and changed nothing is what a harness has to be
 * able to show.
 *
 * Assumptions the vendor documents do not settle, called out where they are made below:
 *  - the `get` reply is sent in the same NRPN form that sets the parameter (the document says
 *    a get "returns the current value" without showing the reply);
 *  - the 255-step audio fader law carries 8 bits split coarse/fine (the document's own audio
 *    examples, 0 dB = `06 62 26 00` and +10 dB = `06 7F 26 40`, put the 8th bit at the top of
 *    the fine byte);
 *  - what a unit sends when a connection is accepted is not in the MIDI document at all, so
 *    `emitConnectBurst()` reports the peer's own state in the profile's own messages;
 *  - the LR mute parameter is `MSB 00 LSB 44` per the mute section and its reference table;
 *    the "Getting values" example that calls `MSB 00 LSB 00` "LR Mute" contradicts the table
 *    on the same page, so nothing here is built on that reading and no spec asserts it.
 */

import { createServer as createHttpServer } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { createServer } from 'node:net'
import type { AddressInfo, Server, Socket } from 'node:net'

export type DeskProfile = 'sq' | 'avantis'

/** SQ "NRPN Fader Law" (Utility > General > MIDI). Linear is 16384 steps, audio 255. */
export type FaderLaw = 'linear' | 'audio'

export interface DeskPeerOptions {
  /** Which desk to be. Defaults to 'sq'. */
  profile?: DeskProfile
  /** 0 (the default) takes an ephemeral port, so specs never fight over 51325. */
  port?: number
  /** Loopback by default; pass 0.0.0.0 to let another machine drive the peer. */
  host?: string
  /**
   * The channel the desk is set to, 1..16 as its Utility screen shows it: the SQ defaults to
   * channel 1, the Avantis to channel 12. The wire nibble is one less.
   */
  midiChannel?: number
  /** SQ only. An Avantis level is a single 7-bit byte either way. */
  faderLaw?: FaderLaw
  /** Read-only JSON view of `state` on this port. Off unless set. */
  controlPort?: number
  /** Report the desk's state as soon as a client connects, as a real SQ does. */
  connectBurst?: boolean
  /**
   * Refuse a second client the way a real SQ's MIDI service does: accept the connection and
   * reset it at once, before anything on it is read, whatever the new client sends or does not
   * send. Measured on an SQ-6, firmware 1.6.1 (2026-09-21) — the desk ahead of a hardware run
   * refuses a second connection, which is why that lane relays (`INTEGRATION-HARNESS.md` §6).
   *
   * Off by default, because this peer's own model is a desk that answers several: the app lane
   * stands in for the desk's side of a conversation, and the client count is wider here than on
   * the desk. A spec that is standing in for the desk's *service* — the relay's, in
   * `harness-desk-relay.spec.ts`, or a lane that wants the desk's own refusal — says so with this.
   */
  singleClient?: boolean
  /** How many decoded messages `received` keeps before dropping the oldest. */
  receivedLimit?: number
}

/** The desk transmits this, and a client may send it, when a scene is recalled. */
export interface DeskSceneMessage {
  kind: 'scene'
  /** Epoch milliseconds when the bytes arrived. */
  at: number
  /** The exact wire bytes of the message. */
  bytes: number[]
  /** MIDI channel nibble of the program change, as in every other decoded message. */
  channel: number
  bank: number
  program: number
  /** 1-based scene number; absent for SQ cue-list banks 0A-0C, which are not scenes. */
  scene?: number
}

export interface DeskMuteMessage {
  kind: 'mute'
  at: number
  bytes: number[]
  /** MIDI channel nibble from the status byte. */
  channel: number
  /**
   * SQ: the NRPN parameter LSB. Avantis: the CH note, which is what selects the channel.
   * `page` is SQ's NRPN parameter MSB; Avantis selects a channel with one byte, so it
   * carries the same value as `note` there.
   */
  note: number
  page: number
  on: boolean
  /** Vendor channel name, when the address is one the reference tables name. */
  label?: string
}

export interface DeskFaderMessage {
  kind: 'fader'
  at: number
  bytes: number[]
  channel: number
  /** SQ: the parameter LSB addressed on the level page. Avantis: the CH note. */
  note: number
  /** SQ: the NRPN parameter MSB (0x40 for input to LR). Avantis: the CH note. */
  page: number
  /** SQ: 0-16383 linear or 0-255 audio. Avantis: 0-127. */
  value: number
  label?: string
}

export interface DeskAssignMessage {
  kind: 'assign'
  at: number
  bytes: number[]
  channel: number
  note: number
  page: number
  /**
   * The NRPN parameter: Avantis's 0x18 main-mix assign or 0x40 DCA/mute-group assign; on SQ
   * the parameter LSB, which is also `note`, because an SQ address is a page and a parameter.
   */
  parameter: number
  /** The raw value byte. */
  value: number
  on: boolean
  /** What is assigned: 'Main', 'DCA 3', 'Mute Group 3'. */
  label: string
}

/** SQ soft keys are note messages: a press is note on at 7F, a release is note off. */
export interface DeskSoftKeyMessage {
  kind: 'softkey'
  at: number
  bytes: number[]
  channel: number
  note: number
  on: boolean
  label: string
}

/** Any SysEx run, reassembled to its F7, with the header still in `data`. */
export interface DeskSysExMessage {
  kind: 'sysex'
  at: number
  bytes: number[]
  data: number[]
}

/**
 * A MIDI Show Control command, which is what an SQ's cue list answers
 * ("SQ MIDI Protocol", firmware V1.6). The bytes are the specification's:
 * `F0 7F <device> 02 <format> <command> <data> F7`, with the cue number and cue list in
 * ASCII and `00` between the fields.
 */
export interface DeskMscMessage {
  kind: 'msc'
  at: number
  bytes: number[]
  deviceId: number
  /** The command format byte as it arrived: 7F is the specification's all-types. */
  format: number
  /** The specification's own name for the command, or `other` for one it does not define. */
  command: string
  cueNumber: string
  cueList: string
}

/** Anything not decoded: unknown controllers, stray data bytes, unterminated SysEx. */
export interface DeskRawMessage {
  kind: 'raw'
  at: number
  bytes: number[]
}

export type DeskReceived =
  | DeskSceneMessage
  | DeskMuteMessage
  | DeskFaderMessage
  | DeskAssignMessage
  | DeskSoftKeyMessage
  | DeskMscMessage
  | DeskSysExMessage
  | DeskRawMessage

/**
 * Keys are the two bytes the profile addresses an element with, two hex digits each:
 * SQ `page:lsb` — '00:00' is Ip1's mute, '00:44' is LR's, '02:07' is DCA8's, '40:00' is
 * Ip1 to LR's level; Avantis `channel:note` — '0b:00' is Input 1, the N of the status byte
 * and the CH note. Names and colours are keyed the same way, from the SysEx `0N`/`CH` pair.
 */
export interface DeskState {
  /** 1-based scene, null until one is recalled. */
  scene: number | null
  /**
   * The cue the desk's own cue list is standing on, once MIDI Show Control has moved it
   * (an SQ answers GO, GO with a cue, LOAD and RESET); null until then. A GO naming no cue
   * moves on by one, which is what the specification says it means.
   */
  cue: string | null
  mutes: Record<string, { on: boolean; label: string }>
  faders: Record<string, { value: number; label: string }>
  /** SQ mix assignments (NRPN page 60); the desk toggles them like mutes. */
  assigns: Record<string, { on: boolean; label: string }>
  names: Record<string, string>
  colours: Record<string, number>
}

export interface DeskPeer {
  /** The port actually bound, so a spec started on 0 can connect to it. */
  port: number
  profile: DeskProfile
  /** The desk's MIDI channel, 1..16. */
  midiChannel: number
  /** The HTTP view's port, when one was asked for. */
  controlPort?: number
  /** The other end's messages, in arrival order. Capped at `receivedLimit`. */
  received: DeskReceived[]
  /** One desk: a second client sees the same scene, mutes, faders and names. */
  state: DeskState
  /**
   * How many clients are attached now. Wider than the desk's own MIDI service, which refuses a
   * second connection — `DeskPeerOptions.singleClient` models the desk's rule, and
   * `INTEGRATION-HARNESS.md` §6 has the measurement.
   */
  clients: number
  /** Recall a scene as the desk's own screen would, desk state included. */
  recallScene(scene: number): void
  /**
   * Mute on/off as the desk's own mute key would. `channel` is the status byte's channel
   * **nibble** — the desk's own channel 1 is 0, where `midiChannel` above is the 1-based
   * setting a Utility screen shows — and `note` the addressed element (Avantis CH, SQ parameter
   * LSB). `page` is SQ's parameter MSB, needed only for DCAs (02) and mute groups (04), whose
   * LSBs collide with the inputs'; input, group, aux, LR and matrix mutes default to page 00.
   */
  setMute(channel: number, note: number, on: boolean, page?: number): void
  /** Move a fader as the desk's own surface would: `note` is the addressed channel. */
  moveFader(channel: number, value: number, note?: number): void
  /**
   * A Soft Key on the desk, which is the desk's own configurable button. The SQ only
   * transmits for a key that has been assigned to a MIDI note — "the SQ does not send note
   * on/off messages when a Soft Key is pressed unless the Soft Key is set to a MIDI note
   * on/off function" — so this models a desk somebody has set up that way, which is what an
   * operator pointing a show at a desk does. Each key is a note from C3 (0x30) upward, a
   * press at velocity 7F and a release at 00; this sends the whole tap.
   *
   * A key *assigned to a function* — a mute group, say — performs that function instead and
   * transmits the function's own message (a mute is the NRPN sequence `B0 63 MB B0 62 LB
   * B0 06 00 B0 26 01`), which is a message this peer can be made to send but that no
   * trigger in the app reads yet. That gap is in `INTEGRATION-HARNESS.md`, not hidden here.
   */
  pressSoftKey(key: number): void
  /** Raw bytes on the wire, for drips, SysEx and hand-built running-status streams. */
  emit(bytes: number[] | Uint8Array): void
  /**
   * Report the whole state, the way an SQ does when a client connects: scene, then every mute
   * and fader the desk knows, with repeated status bytes left out. `connectBurst` sends this
   * on its own whenever a client connects.
   */
  emitConnectBurst(): void
  close(): Promise<void>
}

/* ---------------------------------------------------------------- byte helpers */

const hex = (value: number): string => value.toString(16).padStart(2, '0')
const keyOf = (a: number, b: number): string => `${hex(a)}:${hex(b)}`

/* --------------------------------------------------------- MIDI Show Control */

/** The specification's command names, for the commands a desk's cue list answers. */
const MSC_COMMANDS: Record<number, string> = {
  0x01: 'go',
  0x02: 'stop',
  0x03: 'resume',
  0x04: 'timedGo',
  0x05: 'load',
  0x0a: 'reset'
}

/** The universal system exclusive and the show control sub-ID every message carries. */
const MSC_UNIVERSAL = 0x7f
const MSC_SUB_ID = 0x02

/** TIMED_GO carries a five-byte time before its cue data ("3.2, Standard Time Code"). */
const MSC_TIME_BYTES = 5

interface MscFields {
  deviceId: number
  format: number
  command: string
  cueNumber: string
  cueList: string
}

/**
 * A show control command read off a SysEx run, or null when the run is not one — which
 * includes the extension-level forms (`00` in the command or format position), which no
 * device here implements.
 */
function mscOf(data: number[]): MscFields | null {
  const [universal, deviceId, subId, format, command] = data
  if (universal !== MSC_UNIVERSAL || subId !== MSC_SUB_ID) return null
  if (deviceId === undefined || format === undefined || command === undefined) return null
  if (format === 0x00 || command === 0x00) return null

  const body = command === 0x04 ? data.slice(5 + MSC_TIME_BYTES) : data.slice(5)
  const fields: string[] = []
  let field = ''
  for (const byte of body) {
    // `00` ends a field, and `F7` would have ended the run; the specification's fields
    // are ASCII, and anything else in one is a byte this desk does not read.
    if (byte === 0x00) {
      fields.push(field)
      field = ''
      continue
    }
    if (byte >= 0x20 && byte <= 0x7e) field += String.fromCharCode(byte)
  }
  fields.push(field)

  return {
    deviceId,
    format,
    command: MSC_COMMANDS[command] ?? 'other',
    cueNumber: fields[0] ?? '',
    cueList: fields[1] ?? ''
  }
}

/**
 * Join whole MIDI messages into one byte stream. With `runningStatus`, a status byte that
 * repeats the previous message's is dropped — what the Avantis document's own example does
 * for three mutes in a row, and what a desk does when reporting several parameters at once.
 */
export function encodeMessages(messages: number[][], runningStatus = false): number[] {
  const out: number[] = []
  let previous = 0
  for (const [status, ...data] of messages) {
    // Running status is a channel-message rule; a system message must carry its status.
    if (!runningStatus || status >= 0xf0 || status !== previous) out.push(status)
    out.push(...data)
    previous = status
  }
  return out
}

/* ------------------------------------------------------------------- the parser */

interface MidiMessage {
  status: number
  data: number[]
  /** SysEx is the only message whose length is not known up front; false if F7 never came. */
  complete: boolean
}

/** Data bytes a status byte is followed by. Channel messages are fixed length. */
function messageLength(status: number): number {
  switch (status & 0xf0) {
    case 0xc0:
    case 0xd0:
      return 2
    case 0x80:
    case 0x90:
    case 0xa0:
    case 0xb0:
    case 0xe0:
      return 3
    default:
      break
  }
  switch (status) {
    case 0xf1:
    case 0xf3:
      return 2
    case 0xf2:
      return 3
    default:
      return 1
  }
}

/**
 * One TCP byte stream in, whole MIDI messages out. A message may be split across segments,
 * several may arrive in one, a status byte may be omitted when it repeats the previous
 * message's (running status), and a SysEx run is an unknown length ended by F7.
 */
class MidiStreamParser {
  private status = 0
  private data: number[] = []
  private sysex: number[] | null = null
  private readonly onMessage: (message: MidiMessage) => void

  constructor(onMessage: (message: MidiMessage) => void) {
    this.onMessage = onMessage
  }

  push(bytes: ArrayLike<number>): void {
    for (let index = 0; index < bytes.length; index += 1) this.byte(bytes[index])
  }

  private byte(value: number): void {
    // Realtime bytes carry no data and may appear anywhere, including inside a SysEx run.
    if (value >= 0xf8) return

    if (this.sysex) {
      if (value === 0xf7) {
        this.onMessage({ status: 0xf0, data: this.sysex, complete: true })
        this.sysex = null
        return
      }
      if (value < 0x80) {
        this.sysex.push(value)
        return
      }
      // A status byte inside a run abandons it. Report what arrived so the log shows it,
      // then treat this byte as the start of something new.
      this.onMessage({ status: 0xf0, data: this.sysex, complete: false })
      this.sysex = null
    }

    if (value >= 0x80) {
      this.status = value
      this.data = []
      if (value === 0xf0) this.sysex = []
      else if (messageLength(value) === 1) this.emit()
      return
    }

    if (this.status === 0) {
      // Running status with nothing to run on: a data byte with no previous status byte.
      this.onMessage({ status: 0, data: [value], complete: true })
      return
    }

    this.data.push(value)
    if (this.data.length === messageLength(this.status) - 1) this.emit()
  }

  /** Running status: `status` is deliberately kept for the message after this one. */
  private emit(): void {
    this.onMessage({ status: this.status, data: this.data, complete: true })
    this.data = []
  }
}

/* ------------------------------------------------------------- SQ reference tables */

interface SqParameter {
  kind: 'mute' | 'level' | 'assign'
  label: string
}

// SQ MIDI Protocol Issue 5, reference tables page 21: mute page MSB 00 runs through the
// inputs, groups, FX returns, LR, auxes, FX sends and matrices; DCAs and mute groups have
// pages of their own. The whole page as a table, rather than 88 rows of it.
const SQ_MUTE_PAGE: Array<{ lsb: number; count: number; label: (index: number) => string }> = [
  { lsb: 0x00, count: 48, label: (n) => `Ip${n}` },
  { lsb: 0x30, count: 12, label: (n) => `Grp${n}` },
  { lsb: 0x3c, count: 8, label: (n) => `FX${n}Rtn` },
  { lsb: 0x44, count: 1, label: () => 'LR' },
  { lsb: 0x45, count: 12, label: (n) => `Aux${n}` },
  { lsb: 0x51, count: 4, label: (n) => `FX${n}Snd` },
  { lsb: 0x55, count: 3, label: (n) => `Mtx${n}` }
]

/** Level page 40 is input (and group) to LR; the aux, pan and assign pages are not modelled. */
const SQ_LEVEL_PAGE = 0x40
const SQ_ASSIGN_PAGE = 0x60

function sqParameter(page: number, lsb: number): SqParameter | undefined {
  if (page === 0x00) {
    for (const entry of SQ_MUTE_PAGE) {
      if (lsb >= entry.lsb && lsb < entry.lsb + entry.count) {
        return { kind: 'mute', label: entry.label(lsb - entry.lsb + 1) }
      }
    }
  }
  if (page === 0x02 && lsb <= 7) return { kind: 'mute', label: `DCA${lsb + 1}` }
  if (page === 0x04 && lsb <= 7) return { kind: 'mute', label: `Mute Grp${lsb + 1}` }
  if (page === SQ_LEVEL_PAGE && lsb <= 0x2f) return { kind: 'level', label: `Ip${lsb + 1} to LR` }
  if (page === SQ_ASSIGN_PAGE && lsb <= 0x2f) return { kind: 'assign', label: `Ip${lsb + 1} to LR` }
  return undefined
}

// SQ MIDI Protocol Issue 5, section 3.1: three banks over scenes 1-300. Cue-list positions
// use banks 0A-0C, which the document gives without a range, so no scene number is derived
// for them and the bank is reported as it arrived.
const SQ_SCENE_BANKS = [0x00, 0x01, 0x02]
const SQ_SCENES = 300
/** Soft key 1 is C3, 0x30, and they run upward from there. */
const SQ_SOFT_KEYS = 0x30
const SQ_SOFT_KEY_COUNT = 16

/* -------------------------------------------------------- Avantis reference tables */

// Avantis MIDI TCP/IP Protocol, "Channel Selection": the audio channel type is the offset
// of the MIDI channel from the base, and the channel within that type is the note number.
const AVANTIS_CHANNELS: Array<{
  offset: number
  from: number
  to: number
  name: string
  /** Index of the first channel in the range, so `note + index` reads as the channel. */
  index: number
}> = [
  { offset: 0, from: 0x00, to: 0x5f, name: 'Input', index: 1 },
  { offset: 1, from: 0x00, to: 0x35, name: 'Mono Group', index: 1 },
  { offset: 1, from: 0x40, to: 0x5a, name: 'Stereo Group', index: -0x3f },
  { offset: 2, from: 0x00, to: 0x35, name: 'Mono Aux', index: 1 },
  { offset: 2, from: 0x40, to: 0x5a, name: 'Stereo Aux', index: -0x3f },
  { offset: 3, from: 0x00, to: 0x35, name: 'Mono Matrix', index: 1 },
  { offset: 3, from: 0x40, to: 0x5a, name: 'Stereo Matrix', index: -0x3f },
  { offset: 4, from: 0x00, to: 0x0b, name: 'Mono FX Send', index: 1 },
  { offset: 4, from: 0x10, to: 0x1b, name: 'Stereo FX Send', index: -0x0f },
  { offset: 4, from: 0x20, to: 0x2b, name: 'FX Return', index: -0x1f },
  { offset: 4, from: 0x30, to: 0x32, name: 'Main', index: -0x2f },
  { offset: 4, from: 0x36, to: 0x45, name: 'DCA', index: -0x35 },
  { offset: 4, from: 0x46, to: 0x4d, name: 'Mute Group', index: -0x45 },
  { offset: 4, from: 0x56, to: 0x5d, name: 'Stereo UFX Send', index: -0x55 },
  { offset: 4, from: 0x5e, to: 0x65, name: 'Stereo UFX Return', index: -0x5d }
]

function avantisLabel(channel: number, note: number, base: number): string | undefined {
  const offset = channel - base
  for (const range of AVANTIS_CHANNELS) {
    if (range.offset === offset && note >= range.from && note <= range.to) {
      return `${range.name} ${note + range.index}`
    }
  }
  return undefined
}

// Avantis parameter IDs, and the note velocities that mean mute on and off. Velocity 0 and
// note off are ignored: that is how the desk is told a mute message has ended.
const AV_FADER_PARAM = 0x17
const AV_MAIN_ASSIGN_PARAM = 0x18
const AV_DCA_ASSIGN_PARAM = 0x40
const AV_MUTE_ON = 0x40
const AV_MUTE_OFF = 0x3f

const AVANTIS_SYSEX_HEADER = [0xf0, 0x00, 0x00, 0x1a, 0x50, 0x10, 0x01, 0x00]
/** The header without its F0: the parser hands over a run with neither F0 nor F7. */
const AVANTIS_SYSEX_BODY = AVANTIS_SYSEX_HEADER.slice(1)
const AV_NAME_GET = 0x01
const AV_NAME_REPLY = 0x02
const AV_NAME_SET = 0x03
const AV_COLOUR_GET = 0x04
const AV_COLOUR_REPLY = 0x05
const AV_COLOUR_SET = 0x06
/** A strip LCD shows eight characters. */
const AV_NAME_LIMIT = 8

const AVANTIS_SCENE_BANKS = [0x00, 0x01, 0x02, 0x03]
const AVANTIS_SCENES = 500

/* ------------------------------------------------------------------ the peer itself */

/** Channel 1 is the SQ's default and channel 12 (0x0B on the wire) the Avantis's. */
const DEFAULT_MIDI_CHANNEL: Record<DeskProfile, number> = { sq: 1, avantis: 12 }

interface Connection {
  socket: Socket
  /** NRPN latch and scene bank are per stream: MIDI state belongs to the connection. */
  nrpn: { page: number; note: number | null; coarse: number | null }
  /**
   * The bytes of the parameter message being assembled. A vendor message is a sequence of
   * MIDI messages — `B0 63 00 B0 62 00 B0 06 00 B0 26 01` is one mute — so the log reports
   * the whole sequence, which is the form the documents write it in.
   */
  sequence: number[]
  /** The bank select message, which is the first half of a scene change. */
  bankBytes: number[]
  bank: number
}

export async function startDeskPeer(options: DeskPeerOptions = {}): Promise<DeskPeer> {
  const profile = options.profile ?? 'sq'
  const host = options.host ?? '127.0.0.1'
  // The desk is set to a channel; only the status byte cares that the wire has four bits.
  const channelNibble = Math.max(0, Math.min(15, (options.midiChannel ?? DEFAULT_MIDI_CHANNEL[profile]) - 1))
  const midiChannel = channelNibble + 1
  const faderLaw: FaderLaw = options.faderLaw ?? 'linear'
  const receivedLimit = options.receivedLimit ?? 5000
  const state: DeskState = {
    scene: null,
    cue: null,
    mutes: {},
    faders: {},
    assigns: {},
    names: {},
    colours: {}
  }
  const received: DeskReceived[] = []
  const connections = new Set<Connection>()

  /** The desk's own channel, for the messages it sends about itself. */
  const statusByte = (kind: number): number => (kind & 0xf0) | channelNibble
  const levelMaximum = profile === 'avantis' ? 0x7f : faderLaw === 'linear' ? 16383 : 255

  /** A level in range to the byte pair the profile puts on the wire. */
  function levelBytes(level: number): number[] {
    if (profile === 'avantis') return [level]
    // 255 steps over the same coarse/fine pair, the 8th bit at the top of the fine byte:
    // the document's audio examples are 0 dB = `06 62 26 00` and +10 dB = `06 7F 26 40`.
    if (faderLaw === 'audio') return [level >> 1, (level & 1) << 6]
    return [level >> 7, level & 0x7f]
  }

  function levelValue(coarse: number, fine: number): number {
    if (profile === 'avantis') return coarse
    return faderLaw === 'audio' ? (coarse << 1) | (fine >> 6) : (coarse << 7) | fine
  }

  function send(bytes: number[]): void {
    if (!bytes.length) return
    const buffer = Buffer.from(bytes)
    for (const connection of connections) connection.socket.write(buffer)
  }

  function remember(message: DeskReceived): void {
    received.push(message)
    if (received.length > receivedLimit) received.splice(0, received.length - receivedLimit)
  }

  /** The mute message of the profile, which is also what the desk sends when its key is hit. */
  function muteMessages(channel: number, note: number, on: boolean, page: number): number[][] {
    if (profile === 'avantis') {
      const noteOn = 0x90 | (channel & 0x0f)
      return [
        [noteOn, note, on ? 0x7f : AV_MUTE_OFF],
        [noteOn, note, 0x00]
      ]
    }
    const cc = 0xb0 | (channel & 0x0f)
    return [
      [cc, 0x63, page],
      [cc, 0x62, note],
      [cc, 0x06, 0x00],
      [cc, 0x26, on ? 0x01 : 0x00]
    ]
  }

  /** The level message of the profile, on the input-to-LR page for SQ. */
  function faderMessages(channel: number, note: number, level: number): number[][] {
    const cc = 0xb0 | (channel & 0x0f)
    if (profile === 'avantis') {
      return [
        [cc, 0x63, note],
        [cc, 0x62, AV_FADER_PARAM],
        [cc, 0x06, level]
      ]
    }
    const [coarse, fine] = levelBytes(level)
    return [
      [cc, 0x63, SQ_LEVEL_PAGE],
      [cc, 0x62, note],
      [cc, 0x06, coarse],
      [cc, 0x26, fine]
    ]
  }

  function sceneMessages(scene: number): number[][] {
    const banks = profile === 'avantis' ? AVANTIS_SCENE_BANKS : SQ_SCENE_BANKS
    const bank = Math.floor((scene - 1) / 128)
    if (bank >= banks.length) return []
    return [
      [statusByte(0xb0), 0x00, banks[bank]],
      [statusByte(0xc0), (scene - 1) % 128]
    ]
  }

  /* ------------------------------------------------------------- profile: SQ */

  function decodeSq(connection: Connection, message: MidiMessage, at: number): void {
    const channel = message.status & 0x0f
    const bytes = [message.status, ...message.data]
    const kind = message.status & 0xf0

    if (kind === 0x90 || kind === 0x80) {
      const [note, velocity] = message.data
      const on = kind === 0x90 && velocity > 0
      if (note >= SQ_SOFT_KEYS && note < SQ_SOFT_KEYS + SQ_SOFT_KEY_COUNT) {
        remember({
          kind: 'softkey',
          at,
          bytes,
          channel,
          note,
          on,
          label: `SoftKey ${note - SQ_SOFT_KEYS + 1}`
        })
        return
      }
      remember({ kind: 'raw', at, bytes })
      return
    }

    if (kind === 0xc0) {
      const program = message.data[0]
      const scene = connection.bank < SQ_SCENE_BANKS.length ? connection.bank * 128 + program + 1 : undefined
      const known = scene !== undefined && scene <= SQ_SCENES
      remember({
        kind: 'scene',
        at,
        bytes: [...connection.bankBytes, ...bytes],
        channel,
        bank: connection.bank,
        program,
        ...(known ? { scene: scene as number } : {})
      })
      if (known) state.scene = scene as number
      return
    }

    if (kind !== 0xb0) {
      remember({ kind: 'raw', at, bytes })
      return
    }

    const [controller, value] = message.data
    switch (controller) {
      case 0x00:
        // A bank select only means something with the program change that follows it, and
        // that is where the scene is reported. Its bytes belong to that scene message.
        connection.bank = value
        connection.bankBytes = bytes
        connection.sequence = []
        return
      case 0x63:
        connection.nrpn = { page: value, note: null, coarse: null }
        connection.sequence = bytes
        return
      case 0x62:
        connection.nrpn.note = value
        connection.sequence.push(...bytes)
        return
      case 0x06:
        connection.nrpn.coarse = value
        connection.sequence.push(...bytes)
        return
      case 0x26: {
        const { page, note, coarse } = connection.nrpn
        const sequence = [...connection.sequence, ...bytes]
        connection.sequence = []
        if (note === null || coarse === null) {
          remember({ kind: 'raw', at, bytes: sequence })
          return
        }
        const parameter = sqParameter(page, note)
        if (!parameter) {
          remember({ kind: 'raw', at, bytes: sequence })
          return
        }
        const key = keyOf(page, note)
        // The mute and assign forms carry their state in the fine byte (`06 00` then
        // `26 01`); the level form is that same pair read as a 14-bit or 255-step value.
        if (parameter.kind === 'level') {
          const level = levelValue(coarse, value)
          state.faders[key] = { value: level, label: parameter.label }
          remember({ kind: 'fader', at, bytes: sequence, channel, note, page, value: level, label: parameter.label })
          return
        }
        const on = value !== 0
        if (parameter.kind === 'mute') {
          state.mutes[key] = { on, label: parameter.label }
          remember({ kind: 'mute', at, bytes: sequence, channel, note, page, on, label: parameter.label })
        } else {
          state.assigns[key] = { on, label: parameter.label }
          remember({
            kind: 'assign',
            at,
            bytes: sequence,
            channel,
            note,
            page,
            parameter: note,
            value,
            on,
            label: parameter.label
          })
        }
        return
      }
      case 0x60:
      case 0x61: {
        const { page, note } = connection.nrpn
        const sequence = [...connection.sequence, ...bytes]
        connection.sequence = []
        if (note === null) {
          remember({ kind: 'raw', at, bytes: sequence })
          return
        }
        const parameter = sqParameter(page, note)
        if (!parameter) {
          remember({ kind: 'raw', at, bytes: sequence })
          return
        }
        if (value === 0x7f) {
          // "A 'get' command can be sent to the SQ in order to return the current value of
          // any mute, level, pan/balance or assignment parameter."
          const key = keyOf(page, note)
          if (parameter.kind === 'level') {
            send(encodeMessages(faderMessages(channel, note, state.faders[key]?.value ?? 0)))
            return
          }
          const on = parameter.kind === 'mute' ? state.mutes[key]?.on ?? false : state.assigns[key]?.on ?? false
          send(
            encodeMessages([
              [0xb0 | (channel & 0x0f), 0x63, page],
              [0xb0 | (channel & 0x0f), 0x62, note],
              [0xb0 | (channel & 0x0f), 0x06, 0x00],
              [0xb0 | (channel & 0x0f), 0x26, on ? 0x01 : 0x00]
            ])
          )
          return
        }
        // "The SQ will toggle the mute state when either an increment or decrement message is
        // received" — the controller number only picks a direction, the state flips either way.
        if (parameter.kind === 'level') {
          remember({ kind: 'raw', at, bytes: sequence })
          return
        }
        const key = keyOf(page, note)
        const on = !(parameter.kind === 'mute' ? state.mutes[key]?.on ?? false : state.assigns[key]?.on ?? false)
        if (parameter.kind === 'mute') {
          state.mutes[key] = { on, label: parameter.label }
          remember({ kind: 'mute', at, bytes: sequence, channel, note, page, on, label: parameter.label })
        } else {
          state.assigns[key] = { on, label: parameter.label }
          remember({
            kind: 'assign',
            at,
            bytes: sequence,
            channel,
            note,
            page,
            parameter: note,
            value,
            on,
            label: parameter.label
          })
        }
        return
      }
      default:
        remember({ kind: 'raw', at, bytes })
    }
  }

  /* --------------------------------------------------------- profile: Avantis */

  function decodeAvantis(connection: Connection, message: MidiMessage, at: number): void {
    const channel = message.status & 0x0f
    const bytes = [message.status, ...message.data]
    const kind = message.status & 0xf0

    if (kind === 0x90) {
      const [note, velocity] = message.data
      // "Velocity 00 and NOTE OFF messages are ignored." The desk acts on neither, but the
      // log keeps the trace: a harness has to be able to show that a message arrived and was
      // ignored, which a dropped one cannot.
      if (velocity === 0) {
        remember({ kind: 'raw', at, bytes })
        return
      }
      const on = velocity >= AV_MUTE_ON
      const label = avantisLabel(channel, note, channelNibble)
      state.mutes[keyOf(channel, note)] = { on, label: label ?? '' }
      remember({
        kind: 'mute',
        at,
        bytes,
        channel,
        note,
        page: note,
        on,
        ...(label ? { label } : {})
      })
      return
    }

    if (kind === 0x80) {
      remember({ kind: 'raw', at, bytes })
      return
    }

    if (kind === 0xc0) {
      const program = message.data[0]
      const scene =
        connection.bank < AVANTIS_SCENE_BANKS.length ? connection.bank * 128 + program + 1 : undefined
      const known = scene !== undefined && scene <= AVANTIS_SCENES
      remember({
        kind: 'scene',
        at,
        bytes: [...connection.bankBytes, ...bytes],
        channel,
        bank: connection.bank,
        program,
        ...(known ? { scene: scene as number } : {})
      })
      if (known) state.scene = scene as number
      return
    }

    if (kind === 0xf0) {
      handleAvantisSysex(message.data)
      return
    }

    if (kind !== 0xb0) {
      remember({ kind: 'raw', at, bytes })
      return
    }

    const [controller, value] = message.data
    switch (controller) {
      case 0x00:
        connection.bank = value
        connection.bankBytes = bytes
        connection.sequence = []
        return
      case 0x63:
        connection.nrpn = { page: value, note: null, coarse: null }
        connection.sequence = bytes
        return
      case 0x62:
        connection.nrpn.note = value
        connection.sequence.push(...bytes)
        return
      case 0x06: {
        // Avantis has no data fine byte: the value is complete when it arrives.
        const { page, note } = connection.nrpn
        const sequence = [...connection.sequence, ...bytes]
        connection.sequence = []
        if (note === null) {
          remember({ kind: 'raw', at, bytes: sequence })
          return
        }
        const label = avantisLabel(channel, page, channelNibble)
        if (note === AV_FADER_PARAM) {
          state.faders[keyOf(channel, page)] = { value, label: label ?? '' }
          remember({
            kind: 'fader',
            at,
            bytes: sequence,
            channel,
            note: page,
            page,
            value,
            ...(label ? { label } : {})
          })
          return
        }
        if (note === AV_MAIN_ASSIGN_PARAM) {
          remember({
            kind: 'assign',
            at,
            bytes: sequence,
            channel,
            note: page,
            page,
            parameter: note,
            value,
            on: value >= AV_MUTE_ON,
            label: 'Main'
          })
          return
        }
        if (note === AV_DCA_ASSIGN_PARAM) {
          const assign = avantisAssign(value)
          if (!assign) {
            remember({ kind: 'raw', at, bytes: sequence })
            return
          }
          remember({
            kind: 'assign',
            at,
            bytes: sequence,
            channel,
            note: page,
            page,
            parameter: note,
            value,
            on: assign.on,
            label: assign.label
          })
          return
        }
        remember({ kind: 'raw', at, bytes: sequence })
        return
      }
      default:
        remember({ kind: 'raw', at, bytes })
    }
  }

  /** DCA and mute-group assignment share Parameter ID 40; the value says which, and whether. */
  function avantisAssign(value: number): { on: boolean; label: string } | undefined {
    if (value >= 0x40 && value <= 0x4f) return { on: true, label: `DCA ${value - 0x3f}` }
    if (value >= 0x00 && value <= 0x0f) return { on: false, label: `DCA ${value + 1}` }
    if (value >= 0x50 && value <= 0x57) return { on: true, label: `Mute Group ${value - 0x4f}` }
    if (value >= 0x10 && value <= 0x17) return { on: false, label: `Mute Group ${value - 0x0f}` }
    return undefined
  }

  /** The name, colour and send messages, in the header the document gives them. */
  function handleAvantisSysex(data: number[]): void {
    const headerMatches =
      data.length >= AVANTIS_SYSEX_BODY.length + 3 &&
      AVANTIS_SYSEX_BODY.every((byte, index) => data[index] === byte)
    if (!headerMatches) return
    const channel = data[AVANTIS_SYSEX_BODY.length]
    const operation = data[AVANTIS_SYSEX_BODY.length + 1]
    const target = data[AVANTIS_SYSEX_BODY.length + 2]
    const key = keyOf(channel, target)
    const text = data
      .slice(AVANTIS_SYSEX_BODY.length + 3)
      .map((byte) => String.fromCharCode(byte & 0x7f))
      .join('')

    switch (operation) {
      case AV_NAME_GET: {
        // The stored name, empty if the desk was never told one. Names are ASCII, which is
        // what the document's own `VOCAL` and `GTR 1` examples carry.
        const name = [...state.names[key] ?? ''].map((character) => character.charCodeAt(0) & 0x7f)
        send([...AVANTIS_SYSEX_HEADER, channel, AV_NAME_REPLY, target, ...name, 0xf7])
        return
      }
      case AV_NAME_SET:
      case AV_NAME_REPLY:
        // "up to 8 characters", so a longer one is cut the way the strip LCD would cut it.
        state.names[key] = text.slice(0, AV_NAME_LIMIT)
        return
      case AV_COLOUR_GET:
        send([...AVANTIS_SYSEX_HEADER, channel, AV_COLOUR_REPLY, target, state.colours[key] ?? 0x00, 0xf7])
        return
      case AV_COLOUR_SET:
      case AV_COLOUR_REPLY:
        state.colours[key] = data[AVANTIS_SYSEX_BODY.length + 3] & 0x07
        return
      default:
        // Sends (0x0D) and the rest are logged as SysEx; they carry nothing this peer models.
        return
    }
  }

  /* --------------------------------------------------------------- connection */

  const server: Server = createServer((socket) => {
    // The desk's own rule, measured on hardware rather than read out of a document: the second
    // connection is accepted at the TCP level and reset at once, without a byte of it being
    // read. A client sees ECONNRESET, not a refusal, which the app tells apart from a dial
    // nobody answered and says so where the recall failed (`MidiTcpEngine`); a lane that wants
    // that sentence points a show at this peer (`INTEGRATION-HARNESS.md` §6).
    if (options.singleClient === true && connections.size > 0) {
      socket.resetAndDestroy()
      return
    }
    socket.setNoDelay(true)
    const connection: Connection = {
      socket,
      nrpn: { page: 0, note: null, coarse: null },
      sequence: [],
      bankBytes: [],
      bank: 0x00
    }
    const parser = new MidiStreamParser((message) => {
      const at = Date.now()
      if (message.status === 0xf0) {
        // Every run is logged as it arrived, whatever the profile makes of it; one that a
        // status byte interrupted never became a message, so it is raw.
        if (message.complete) {
          const run = [0xf0, ...message.data, 0xf7]
          // An SQ's cue list answers MIDI Show Control (firmware V1.6), so a command is
          // read as one and moves the list; the Avantis document this peer was written
          // from gives it no MSC, so a run there is left as the SysEx it arrived as.
          const msc = profile === 'sq' ? mscOf(message.data) : null
          if (msc !== null) {
            remember({ kind: 'msc', at, bytes: run, ...msc })
            applyMsc(msc)
          } else {
            remember({ kind: 'sysex', at, bytes: run, data: run })
            if (profile === 'avantis') handleAvantisSysex(message.data)
          }
        } else {
          remember({ kind: 'raw', at, bytes: [0xf0, ...message.data] })
        }
        return
      }
      if (profile === 'sq') decodeSq(connection, message, at)
      else decodeAvantis(connection, message, at)
    })
    connections.add(connection)
    if (options.connectBurst) emitConnectBurst()
    socket.on('close', () => connections.delete(connection))
    socket.on('error', () => connections.delete(connection))
    socket.on('data', (chunk) => {
      try {
        parser.push(chunk)
      } catch {
        // A malformed stream must not take the peer down with it: the spec's failure message
        // is worth more than a dead process.
      }
    })
  })

  /**
   * What the command does to the desk. Only the commands that move the cue list are
   * modelled: a STOP or a RESUME holds or releases the cue that is running, which is a
   * state this peer has no other reason to carry.
   */
  function applyMsc(msc: MscFields): void {
    if (msc.command === 'go') {
      // "If no Cue Number is specified, the next cue in numerical sequence GOes."
      state.cue = msc.cueNumber !== ''
        ? msc.cueNumber
        : state.cue === null
          ? '1'
          : String(Number(state.cue) + 1)
      return
    }
    // LOAD puts a cue in standby and RESET "returns to the first item in the Cue List":
    // both leave the list standing somewhere, which is what this records.
    if (msc.command === 'load' && msc.cueNumber !== '') state.cue = msc.cueNumber
    if (msc.command === 'reset') state.cue = '1'
  }

  function recallScene(scene: number): void {
    // Scenes that do not exist are simply not recalled, which is what the desk does with a
    // number outside its 300 (SQ) or 500 (Avantis) saved scenes.
    const count = profile === 'avantis' ? AVANTIS_SCENES : SQ_SCENES
    if (!Number.isInteger(scene) || scene < 1 || scene > count) return
    send(encodeMessages(sceneMessages(scene)))
    state.scene = scene
  }

  function setMute(channel: number, note: number, on: boolean, page?: number): void {
    const resolvedPage = profile === 'avantis' ? note : page ?? 0x00
    send(encodeMessages(muteMessages(channel, note, on, resolvedPage)))
    // A mute key changes the desk's own state too, which is what the key on the surface does.
    const label =
      profile === 'avantis'
        ? avantisLabel(channel, note, channelNibble) ?? ''
        : sqParameter(resolvedPage, note)?.label ?? ''
    state.mutes[keyOf(profile === 'avantis' ? channel : resolvedPage, note)] = { on, label }
  }

  function moveFader(channel: number, value: number, note = 0x00): void {
    const level = Math.max(0, Math.min(levelMaximum, Math.round(value)))
    send(encodeMessages(faderMessages(channel, note, level)))
    const label =
      profile === 'avantis' ? avantisLabel(channel, note, channelNibble) ?? '' : sqParameter(SQ_LEVEL_PAGE, note)?.label ?? ''
    state.faders[keyOf(profile === 'avantis' ? channel : SQ_LEVEL_PAGE, note)] = { value: level, label }
  }

  function pressSoftKey(key: number): void {
    // Every range this peer stands in for has soft keys; only the SQ's are modelled, since
    // the Avantis document gives its controls no note messages to send.
    if (profile !== 'sq') return
    const note = SQ_SOFT_KEYS + Math.max(0, key - 1)
    if (key < 1 || key > SQ_SOFT_KEY_COUNT) return
    send([0x90 | channelNibble, note, 0x7f])
    send([0x80 | channelNibble, note, 0x00])
  }

  function emitConnectBurst(): void {
    const messages: number[][] = []
    if (state.scene !== null) messages.push(...sceneMessages(state.scene))
    // SQ keys are `page:lsb` on the desk's own channel; Avantis keys are `channel:note`, which
    // is the channel the message itself has to carry.
    for (const key of Object.keys(state.mutes).sort()) {
      const [first, second] = key.split(':').map((part) => Number.parseInt(part, 16))
      const channel = profile === 'avantis' ? first : channelNibble
      messages.push(...muteMessages(channel, second, state.mutes[key].on, profile === 'avantis' ? second : first))
    }
    for (const key of Object.keys(state.faders).sort()) {
      const [first, second] = key.split(':').map((part) => Number.parseInt(part, 16))
      const channel = profile === 'avantis' ? first : channelNibble
      messages.push(...faderMessages(channel, second, state.faders[key].value))
    }
    // Running status is what the Avantis document shows for a burst on one MIDI channel, and
    // what a desk does when it reports several parameters at once.
    send(encodeMessages(messages, true))
  }

  const listening = Promise.withResolvers<void>()
  server.once('error', listening.reject)
  server.listen(options.port ?? 0, host, () => {
    server.off('error', listening.reject)
    listening.resolve()
  })
  await listening.promise
  const port = (server.address() as AddressInfo).port

  let control: HttpServer | undefined
  let controlPort: number | undefined
  if (options.controlPort !== undefined) {
    const view = createHttpServer((request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405).end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ profile, port, midiChannel, state }, null, 2))
    })
    const controlListening = Promise.withResolvers<void>()
    view.once('error', controlListening.reject)
    view.listen(options.controlPort, host, () => {
      view.off('error', controlListening.reject)
      controlListening.resolve()
    })
    await controlListening.promise
    control = view
    controlPort = (view.address() as AddressInfo).port
  }

  return {
    port,
    profile,
    midiChannel,
    ...(controlPort === undefined ? {} : { controlPort }),
    received,
    state,
    get clients(): number {
      return connections.size
    },
    recallScene,
    setMute,
    moveFader,
    pressSoftKey,
    emit(bytes) {
      send([...bytes])
    },
    emitConnectBurst,
    async close() {
      for (const connection of connections) connection.socket.destroy()
      connections.clear()
      const closed = Promise.withResolvers<void>()
      server.close(() => closed.resolve())
      await closed.promise
      if (control) {
        const stopped = Promise.withResolvers<void>()
        control.close(() => stopped.resolve())
        await stopped.promise
      }
    }
  }
}

/* ---------------------------------------------------------------------------- CLI */

function usage(): string {
  return [
    'usage: node integration/peers/desk.ts [options]',
    '',
    '  --profile sq|avantis     which desk to be (default sq)',
    '  --port N                 TCP port, 0 for an ephemeral one (default 0)',
    '  --host ADDRESS           interface to bind (default 127.0.0.1)',
    '  --midi-channel 1..16     MIDI channel the desk is set to (default 1 SQ, 12 Avantis)',
    '  --fader-law linear|audio SQ NRPN fader law (default linear)',
    '  --control N              serve a read-only JSON view of state on this port',
    '  --connect-burst          report state as soon as a client connects'
  ].join('\n')
}

async function main(argv: string[]): Promise<void> {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  if (argv.includes('--help')) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  const profile = (value('--profile') ?? 'sq') as DeskProfile
  if (profile !== 'sq' && profile !== 'avantis') throw new Error(`unknown profile ${profile}`)
  const channelFlag = value('--midi-channel')
  const lawFlag = value('--fader-law')
  const controlFlag = value('--control')
  const host = value('--host')
  const port = value('--port')

  const peer = await startDeskPeer({
    profile,
    port: port === undefined ? 0 : Number(port),
    ...(host === undefined ? {} : { host }),
    ...(channelFlag === undefined ? {} : { midiChannel: Number(channelFlag) }),
    ...(lawFlag === 'audio' || lawFlag === 'linear' ? { faderLaw: lawFlag } : {}),
    ...(controlFlag === undefined ? {} : { controlPort: Number(controlFlag) }),
    connectBurst: argv.includes('--connect-burst')
  })

  process.stdout.write(`${profile} desk peer listening on port ${peer.port}\n`)
  if (peer.controlPort !== undefined) {
    process.stdout.write(`state: http://${host ?? '127.0.0.1'}:${peer.controlPort}/\n`)
  }

  const stop = (): void => {
    void peer.close().then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (process.argv[1]?.endsWith('desk.ts')) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
