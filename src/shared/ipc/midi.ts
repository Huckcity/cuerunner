// MIDI out to the ports this machine has, and to the desks that answer on the network.
// Both directions of a cue's MIDI cross here: `send` opens a local port, `sendTcp` writes
// to a socket, and the answer says whether anything was reached — a cue that reached
// nothing has to read differently from one that worked.

import type { MidiMessageKind } from '../cue'
import type { MidiAvailability } from '../midi'
import type { MidiFileOptions } from '../midiFile'
import type { SmfSummary } from '../smf'
import type { Refusal } from './refusal'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const MIDI_CHANNELS = {
  listPorts: 'midi:listPorts',
  listInputPorts: 'midi:listInputPorts',
  /** Whether MIDI can work at all in this build, and why not when it cannot. */
  status: 'midi:status',
  send: 'midi:send',
  /** MIDI to a desk on the network, which is where an SQ and an Avantis listen. */
  sendTcp: 'midi:sendTcp',
  /** A MIDI file chosen in a dialog, for a MIDI File cue. */
  pickFile: 'midi:pickFile',
  /** What a MIDI file holds — its tracks, channels, tempo and length — read by main. */
  fileInspect: 'midi:fileInspect',
  /** A MIDI File cue's file, played from main to its port. */
  filePlay: 'midi:filePlay',
  filePause: 'midi:filePause',
  fileResume: 'midi:fileResume',
  fileStop: 'midi:fileStop'
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

/** A file to read, by its path on this machine. */
export interface MidiFileInspectPayload {
  filePath: string
}

/** What the file holds, or why it is not a file this app can play. */
export type MidiFileInspectResult = Refusal | { ok: true; summary: SmfSummary }

/** A MIDI File cue's run: whose, which file, where to, how, and how far in. */
export interface MidiFilePlayPayload {
  cueId: string
  filePath: string
  portName: string
  options: MidiFileOptions
  /** Played ms into the run to start at: a timeline seek or a takeover, 0 for a GO. */
  offsetMs: number
}

/**
 * The run started, and how long it has left — null for one that loops until it is stopped —
 * or why it did not: a file that is not there or not MIDI, a port that is not plugged in.
 */
export type MidiFilePlayResult = Refusal | { ok: true; remainingMs: number | null; passMs: number }

/** A cue whose file is playing, by its id. */
export interface MidiFileCuePayload {
  cueId: string
}

/** Where a held run is, played ms; refused for a cue whose file is not playing. */
export type MidiFilePauseResult = Refusal | { ok: true; positionMs: number }

/** How long a resumed run has left; refused for a cue whose file is not playing. */
export type MidiFileResumeResult = Refusal | { ok: true; remainingMs: number | null }

/** MIDI output, as the renderer reads it (`window.cuerunner.midi`). */
export interface MidiBridge {
  listPorts(): Promise<string[]>
  listInputPorts(): Promise<string[]>
  /** Whether MIDI can work at all in this build, and why not when it cannot. */
  status(): Promise<MidiAvailability>
  send(cmd: MidiSendPayload): Promise<MidiSendResult>
  /** MIDI to a desk on the network, which is where an SQ and an Avantis listen. */
  sendTcp(cmd: MidiSendTcpPayload): Promise<MidiSendResult>
  /** A MIDI file chosen in a dialog; null when the dialog was cancelled. */
  pickFile(): Promise<string | null>
  fileInspect(cmd: MidiFileInspectPayload): Promise<MidiFileInspectResult>
  filePlay(cmd: MidiFilePlayPayload): Promise<MidiFilePlayResult>
  filePause(cmd: MidiFileCuePayload): Promise<MidiFilePauseResult>
  fileResume(cmd: MidiFileCuePayload): Promise<MidiFileResumeResult>
  /** Stops a cue's file and releases what it holds; false when it was not playing. */
  fileStop(cmd: MidiFileCuePayload): Promise<boolean>
}
