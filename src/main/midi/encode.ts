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
  // The cue body is stored without its delimiters (see decodeMidiMessage: an incoming
  // message is stripped the same way, and encodeMsc builds bodies, not frames), but the
  // inspector's placeholder tells the operator to type `F0 … F7`, so a hand-typed body
  // keeps them. Framing twice puts `F0 F0 … F7 F7` on the wire, which receivers discard
  // as a nested message while midi.send reports ok — so the delimiters are stripped
  // here, where learned and typed cues become the same bytes.
  if (message.kind === 'sysex') {
    const body = [...(message.data ?? [])]
    if (body[0] === 0xf0) body.shift()
    if (body[body.length - 1] === 0xf7) body.pop()
    return [0xf0, ...body, 0xf7]
  }
  // Anything else is a message this app does not send; nothing goes on the wire for it.
  return []
}
