import type { Dca, DeskMessage, DeskSettings } from '../types/show'

/**
 * How the desk is driven.
 *
 * The show has one connection and a DCA's message is derived from its number, so a
 * twelve-mic show is not twelve patches to type. A DCA that carries an override — a desk
 * that numbers its DCAs differently, a mute group on another address — is sent that
 * instead, and only for the connection it belongs to.
 */

/** The number a DCA's own message carries: DCA 1 is note 1, and the DCA's place in the list. */
export function dcaNumber(index: number): number {
  return index + 1
}

/**
 * The address a DCA's own number makes. `{n}` is the number; a pattern without one has
 * the number appended, so `/dca/` and `/dca` both reach `/dca/4` — nobody has to learn
 * the placeholder to use the field.
 */
export function dcaAddress(pattern: string, index: number): string {
  const number = dcaNumber(index)
  if (pattern.includes('{n}')) return pattern.replaceAll('{n}', String(number))
  const trimmed = pattern.trim()
  if (trimmed === '') return `/${number}`
  return trimmed.endsWith('/') ? `${trimmed}${number}` : `${trimmed}/${number}`
}

/** The ordinary desk arrangement for a wireless group: one note, on for open and off for closed. */
export function midiNoteMessages(
  portName: string,
  channel: number,
  note: number
): { mute: MidiDeskMessage; unmute: MidiDeskMessage } {
  return {
    unmute: { kind: 'midi', portName, message: { kind: 'noteOn', channel, note, velocity: 127 } },
    mute: { kind: 'midi', portName, message: { kind: 'noteOff', channel, note, velocity: 0 } }
  }
}

/** The same arrangement over OSC: one address, open value and close value. */
export function oscMessages(
  host: string,
  port: number,
  address: string,
  open: number[] = [1],
  close: number[] = [0]
): { mute: OscDeskMessage; unmute: OscDeskMessage } {
  return {
    unmute: { kind: 'osc', host, port, address, args: open },
    mute: { kind: 'osc', host, port, address, args: close }
  }
}

/**
 * The MIDI arrangement, over the desk's network port instead of a cable: the same note
 * on the same channel, addressed at the desk rather than at a port this machine has
 * opened. Where the bytes go is the whole difference; what they are is the desk's.
 */
export function tcpNoteMessages(
  host: string,
  port: number,
  channel: number,
  note: number
): { mute: MidiTcpDeskMessage; unmute: MidiTcpDeskMessage } {
  return {
    unmute: { kind: 'midi-tcp', host, port, message: { kind: 'noteOn', channel, note, velocity: 127 } },
    mute: { kind: 'midi-tcp', host, port, message: { kind: 'noteOff', channel, note, velocity: 0 } }
  }
}

/** A message over one of the ways this app speaks to a desk. */
export type MidiDeskMessage = Extract<DeskMessage, { kind: 'midi' }>
export type MidiTcpDeskMessage = Extract<DeskMessage, { kind: 'midi-tcp' }>
export type OscDeskMessage = Extract<DeskMessage, { kind: 'osc' }>

/**
 * What a DCA sends: its own patch when it carries an override for this connection,
 * otherwise the message its number makes. Null when the show drives no desk — and when
 * it drives a MIDI desk whose port has not been chosen, because a message to nowhere is
 * worse than none: the recall would report a failure that means nothing.
 */
export function deskMessages(
  dca: Dca,
  index: number,
  desk: DeskSettings
): { mute: DeskMessage; unmute: DeskMessage } | null {
  if (desk.kind === 'midi') {
    if (desk.midiPort === '') return null
    return midiNoteMessages(desk.midiPort, desk.midiChannel, dca.note ?? dcaNumber(index))
  }
  if (desk.kind === 'midi-tcp') {
    // No address typed is the same nothing as no port chosen: the recall would report a
    // failure that means less than the silence did.
    if (desk.host.trim() === '') return null
    return tcpNoteMessages(desk.host, desk.tcpPort, desk.midiChannel, dca.note ?? dcaNumber(index))
  }
  if (desk.kind === 'osc') {
    return oscMessages(desk.host, desk.port, dca.address ?? dcaAddress(desk.address, index))
  }
  return null
}

export function describeDeskMessage(message: DeskMessage | null): string {
  if (message === null) return 'nothing'
  if (message.kind === 'osc') {
    return `OSC ${message.address} ${message.args.join(' ')} → ${message.host}:${message.port}`
  }
  if (message.kind === 'midi-tcp') {
    const where = `${message.host}:${message.port}`
    if (message.message.kind === 'sysex') {
      return `sysex ${message.message.data.length} bytes → ${where}`
    }
    return `${message.message.kind} ch${message.message.channel} → ${where}`
  }
  if (message.message.kind === 'sysex') {
    return `sysex ${message.message.data.length} bytes → "${message.portName}"`
  }
  return `${message.message.kind} ch${message.message.channel} → "${message.portName}"`
}
