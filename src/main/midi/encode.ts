/**
 * A MIDI message as it crosses the IPC boundary: the cue's own fields, flattened,
 * because the receiving side gets data rather than a union it can trust.
 */
export interface MidiMessage {
  kind: string
  channel?: number
  note?: number
  velocity?: number
  controller?: number
  value?: number
  program?: number
  data?: number[]
}

/**
 * The bytes a message is on the wire.
 *
 * One encoder for every path that sends MIDI — the port-based engine and the desk link
 * over TCP — because two encoders for one protocol are two chances to disagree about a
 * status byte, and the disagreement would only ever show up on a desk.
 */
export function encodeMidiMessage(message: MidiMessage): number[] {
  const ch = (message.channel ?? 1) - 1
  if (message.kind === 'noteOn') return [0x90 | ch, message.note!, message.velocity!]
  if (message.kind === 'noteOff') return [0x80 | ch, message.note!, message.velocity!]
  if (message.kind === 'cc') return [0xb0 | ch, message.controller!, message.value!]
  if (message.kind === 'programChange') return [0xc0 | ch, message.program!]
  if (message.kind === 'sysex') return [0xf0, ...message.data!, 0xf7]
  // Anything else is a message this app does not send; nothing goes on the wire for it.
  return []
}
