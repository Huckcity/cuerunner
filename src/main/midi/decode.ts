import type { MidiMessageKind } from '../../shared/cue'

/**
 * Turns a raw MIDI byte stream into the same message shapes a MIDI cue sends, so an
 * incoming note and an outgoing one are described the same way.
 *
 * Returns null for anything the show has no use for — clock, active sensing,
 * aftertouch, pitch bend — rather than inventing a bucket to put them in.
 */
export function decodeMidiMessage(bytes: number[]): MidiMessageKind | null {
  const [status, ...rest] = bytes
  if (status === undefined) return null

  // System messages have no channel, which is why they are checked before the nibble.
  if (status === 0xf0) {
    // A sysex cue is stored without its delimiters (MidiEngine adds them back), so an
    // incoming message is stored the same way — one rule for both directions.
    const body = bytes.slice(1)
    if (body[body.length - 1] === 0xf7) body.pop()
    return { kind: 'sysex', data: body }
  }
  if (status >= 0xf0) return null

  const channel = (status & 0x0f) + 1
  const kind = status & 0xf0
  const [data1, data2] = rest

  switch (kind) {
    case 0x80:
      if (data1 === undefined || data2 === undefined) return null
      return { kind: 'noteOff', channel, note: data1, velocity: data2 }
    case 0x90:
      if (data1 === undefined || data2 === undefined) return null
      // A note-on at zero velocity is a note-off: every keyboard sends them, and the
      // cue model has no fourth state to record it in.
      return data2 === 0
        ? { kind: 'noteOff', channel, note: data1, velocity: 0 }
        : { kind: 'noteOn', channel, note: data1, velocity: data2 }
    case 0xb0:
      if (data1 === undefined || data2 === undefined) return null
      return { kind: 'cc', channel, controller: data1, value: data2 }
    case 0xc0:
      if (data1 === undefined) return null
      return { kind: 'programChange', channel, program: data1 }
    default:
      return null
  }
}
