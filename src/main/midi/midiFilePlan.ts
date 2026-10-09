// What a MIDI File cue changes about the messages its file holds, and what a port has to be
// told before playing from the middle of one.
//
// Both are pure: a message in, the message that goes out (or none); a position in, the
// messages that put every channel where the file had it there. The player in
// `midiFilePlayer.ts` is the only caller, and these are kept apart from it so each can be
// held true with nothing but bytes.

import type { SmfEvent } from '../../shared/smf'
import { MIDI_FILE_DRUM_CHANNEL, type MidiFileOptions } from '../../shared/midiFile'

/** A message as the port is given it, or null for one the cue's options leave out. */
export type MidiFileTransform = (data: number[]) => number[] | null

/**
 * The cue's channel map and transposition, applied to one message.
 *
 * A system message (SysEx, the escape form) has no channel and goes out untouched. A channel
 * message goes out on the channel the map gives its own, or not at all where the map says
 * none. A note — on, off, or its key pressure — moves by the transposition, except on the
 * file's channel 10 unless the cue asks for that too; a note moved off the keyboard (below 0
 * or above 127) is not sent, and because its release is moved by the same amount, that
 * release is not sent either, so nothing is left hanging.
 */
export function midiFileTransform(options: MidiFileOptions): MidiFileTransform {
  const drums = MIDI_FILE_DRUM_CHANNEL - 1
  return data => {
    const status = data[0]
    if (status >= 0xf0) return data
    const channel = status & 0x0f
    const out = options.channelMap[channel]
    if (out === 0 || out === undefined) return null
    const kind = status & 0xf0
    const moved = [kind | (out - 1), ...data.slice(1)]
    const isNote = kind === 0x80 || kind === 0x90 || kind === 0xa0
    if (isNote && options.transpose !== 0 && (channel !== drums || options.transposeDrums)) {
      const note = data[1] + options.transpose
      if (note < 0 || note > 127) return null
      moved[1] = note
    }
    return moved
  }
}

/** Controllers that are not a channel's state but a command, or are chased by their own rule. */
const BANK_MSB = 0
const BANK_LSB = 32
const DATA_ENTRY_MSB = 6
const DATA_ENTRY_LSB = 38
const NRPN_LSB = 98
const NRPN_MSB = 99
const RPN_LSB = 100
const RPN_MSB = 101
/** Data increment and decrement: a nudge, not a value, so there is nothing to chase. */
const DATA_STEP = new Set([96, 97])
/** 120–127 are channel mode messages — all sound off, reset, local, all notes off, modes. */
const FIRST_MODE_CONTROLLER = 120

interface Parameter {
  registered: boolean
  msb: number
  lsb: number
  value: number | null
  fine: number | null
}

interface ChannelState {
  program: number | null
  /** The bank select in force when the program last changed: the bank that program is from. */
  programBank: [number | null, number | null]
  bank: [number | null, number | null]
  controllers: Map<number, number>
  /** RPNs and NRPNs, by which parameter: what each was last set to. */
  parameters: Map<string, Parameter>
  /** The parameter data entry is addressed to right now, as the file last selected it. */
  selected: { registered: boolean; msb: number | null; lsb: number | null } | null
  bend: [number, number] | null
  pressure: number | null
}

function freshChannel(): ChannelState {
  return {
    program: null,
    programBank: [null, null],
    bank: [null, null],
    controllers: new Map(),
    parameters: new Map(),
    selected: null,
    bend: null,
    pressure: null
  }
}

function controllerChange(state: ChannelState, controller: number, value: number): void {
  if (controller === BANK_MSB) { state.bank[0] = value; return }
  if (controller === BANK_LSB) { state.bank[1] = value; return }
  if (controller === RPN_MSB || controller === RPN_LSB || controller === NRPN_MSB || controller === NRPN_LSB) {
    const registered = controller === RPN_MSB || controller === RPN_LSB
    const previous = state.selected !== null && state.selected.registered === registered ? state.selected : null
    const isMsb = controller === RPN_MSB || controller === NRPN_MSB
    state.selected = {
      registered,
      msb: isMsb ? value : previous?.msb ?? null,
      lsb: isMsb ? previous?.lsb ?? null : value
    }
    return
  }
  if (controller === DATA_ENTRY_MSB || controller === DATA_ENTRY_LSB) {
    const selected = state.selected
    // Data entry with nothing selected, or with the null parameter (127/127) selected, sets
    // nothing — that is what the null parameter is for.
    if (selected === null || selected.msb === null || selected.lsb === null) return
    if (selected.msb === 127 && selected.lsb === 127) return
    const key = `${selected.registered ? 'r' : 'n'}:${selected.msb}:${selected.lsb}`
    const parameter = state.parameters.get(key)
      ?? { registered: selected.registered, msb: selected.msb, lsb: selected.lsb, value: null, fine: null }
    if (controller === DATA_ENTRY_MSB) parameter.value = value
    else parameter.fine = value
    // Re-inserted, so the replay sets parameters in the order the file last touched them.
    state.parameters.delete(key)
    state.parameters.set(key, parameter)
    return
  }
  if (DATA_STEP.has(controller) || controller >= FIRST_MODE_CONTROLLER) return
  state.controllers.set(controller, value)
}

/**
 * The messages that put every channel where the file had it at `uptoMs`, before anything at
 * that moment plays: the state a port would be in had it heard the file from the start.
 *
 * Per channel, in an order a synthesizer reads correctly: the bank select that was in force
 * when the program last changed and then that program; any bank select since; every RPN and
 * NRPN the file set, each selected and written (the pitch bend range is one, and it has to
 * arrive before the bend it ranges), then the selection the file had left open, or the null
 * parameter where it had none, so a stray data entry later changes nothing; then every other
 * controller at its last value; then pitch bend and channel pressure.
 *
 * Notes are not chased. A note already sounding at `uptoMs` started in the past, and playing
 * it now would be a new attack in the wrong place; key pressure goes with them. SysEx is not
 * chased either: it may be a reset, a dump, or a message to another device, and replaying it
 * at a seek would do any of those again.
 *
 * The messages are the file's own: the cue's channel map is applied by the caller, like any
 * other message's.
 */
export function chaseMessages(events: readonly SmfEvent[], uptoMs: number): number[][] {
  const channels: (ChannelState | null)[] = Array.from({ length: 16 }, () => null)
  for (const event of events) {
    if (event.ms >= uptoMs) break
    const [status, first, second] = event.data
    if (status >= 0xf0) continue
    const channel = status & 0x0f
    const state = channels[channel] ?? (channels[channel] = freshChannel())
    switch (status & 0xf0) {
      case 0xb0:
        controllerChange(state, first, second)
        break
      case 0xc0:
        state.program = first
        state.programBank = [state.bank[0], state.bank[1]]
        break
      case 0xd0:
        state.pressure = first
        break
      case 0xe0:
        state.bend = [first, second]
        break
    }
  }

  const out: number[][] = []
  channels.forEach((state, channel) => {
    if (state === null) return
    const cc = (controller: number, value: number): void => { out.push([0xb0 | channel, controller, value]) }
    if (state.program !== null) {
      if (state.programBank[0] !== null) cc(BANK_MSB, state.programBank[0])
      if (state.programBank[1] !== null) cc(BANK_LSB, state.programBank[1])
      out.push([0xc0 | channel, state.program])
    }
    if (state.bank[0] !== null && state.bank[0] !== state.programBank[0]) cc(BANK_MSB, state.bank[0])
    if (state.bank[1] !== null && state.bank[1] !== state.programBank[1]) cc(BANK_LSB, state.bank[1])
    for (const parameter of state.parameters.values()) {
      cc(parameter.registered ? RPN_MSB : NRPN_MSB, parameter.msb)
      cc(parameter.registered ? RPN_LSB : NRPN_LSB, parameter.lsb)
      if (parameter.value !== null) cc(DATA_ENTRY_MSB, parameter.value)
      if (parameter.fine !== null) cc(DATA_ENTRY_LSB, parameter.fine)
    }
    if (state.parameters.size > 0 || state.selected !== null) {
      const selected = state.selected
      if (selected !== null && selected.msb !== null && selected.lsb !== null) {
        cc(selected.registered ? RPN_MSB : NRPN_MSB, selected.msb)
        cc(selected.registered ? RPN_LSB : NRPN_LSB, selected.lsb)
      } else {
        cc(RPN_MSB, 127)
        cc(RPN_LSB, 127)
      }
    }
    for (const controller of [...state.controllers.keys()].sort((a, b) => a - b)) {
      cc(controller, state.controllers.get(controller)!)
    }
    if (state.bend !== null) out.push([0xe0 | channel, state.bend[0], state.bend[1]])
    if (state.pressure !== null) out.push([0xd0 | channel, state.pressure])
  })
  return out
}
