// MIDI out to the ports this machine has, and to the desks that answer on the network.
// Both directions of a cue's MIDI cross here: `send` opens a local port, `sendTcp` writes
// to a socket, and the answer says whether anything was reached — a cue that reached
// nothing has to read differently from one that worked.

import type { MidiMessageKind } from '../cue'
import type { MidiAvailability } from '../midi'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const MIDI_CHANNELS = {
  listPorts: 'midi:listPorts',
  listInputPorts: 'midi:listInputPorts',
  /** Whether MIDI can work at all in this build, and why not when it cannot. */
  status: 'midi:status',
  send: 'midi:send',
  /** MIDI to a desk on the network, which is where an SQ and an Avantis listen. */
  sendTcp: 'midi:sendTcp'
} as const

/** A message to a port this machine opened. */
export interface MidiSendPayload {
  portName: string
  messages: MidiMessageKind[]
}

/** The same bytes, to a desk at an address. */
export interface MidiSendTcpPayload {
  host: string
  port: number
  messages: MidiMessageKind[]
}

/** What the engine did: false with a reason is a cue that reached nothing. */
export interface MidiSendResult {
  ok: boolean
  error?: string
}

/** MIDI output, as the renderer reads it (`window.cuerunner.midi`). */
export interface MidiBridge {
  listPorts(): Promise<string[]>
  listInputPorts(): Promise<string[]>
  /** Whether MIDI can work at all in this build, and why not when it cannot. */
  status(): Promise<MidiAvailability>
  send(cmd: MidiSendPayload): Promise<MidiSendResult>
  /** MIDI to a desk on the network, which is where an SQ and an Avantis listen. */
  sendTcp(cmd: MidiSendTcpPayload): Promise<MidiSendResult>
}
