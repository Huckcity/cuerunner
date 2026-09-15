// What goes on the wire for a show control cue, and what is read back off it.
//
// The cases are the vendors' own worked examples rather than this module's opinion: ETC
// publishes `F0 7F 03 02 01 01 35 2E 34 00 39 39` as "Go cue 5.4 of list 99", and Allen &
// Heath publish `F0 7F 7F 02 7F 01 31 32 00 F7` for an SQ's "Go cue 12". A show control
// message is only right if a console's document says so.
import { describe, it, expect } from 'vitest'
import {
  MSC_ALL_CALL,
  describeMsc,
  encodeMsc,
  mscBytes,
  mscCueData,
  parseMsc,
  type MscMessage
} from './msc'

function msc(overrides: Partial<MscMessage> = {}): MscMessage {
  return {
    deviceId: MSC_ALL_CALL,
    format: 'all',
    command: 'go',
    cueNumber: '',
    cueList: '',
    ...overrides
  }
}

/** The body as a console sees it: what the MIDI engines frame between F0 and F7. */
function framed(message: MscMessage): number[] {
  const encoded = encodeMsc(message)
  if (encoded.kind !== 'sysex') throw new Error('a show control message is a sysex')
  return [0xf0, ...encoded.data, 0xf7]
}

describe('a show control message', () => {
  it('is the structure the specification writes', () => {
    // ETC: "sending Device ID 3 a GO command for cue 5.4 in list 99".
    expect(framed(msc({
      deviceId: 3,
      format: 'lighting',
      command: 'go',
      cueNumber: '5.4',
      cueList: '99'
    }))).toEqual([
      0xf0, 0x7f, 0x03, 0x02, 0x01, 0x01,
      0x35, 0x2e, 0x34, 0x00, 0x39, 0x39,
      0xf7
    ])
  })

  it('is how the desks write "go, whoever is listening"', () => {
    // Allen & Heath's own SQ example, which is also what a cue nobody has addressed yet
    // sends: the all-call device ID and the all-types format.
    expect(framed(msc({ command: 'go', cueNumber: '12' }))).toEqual([
      0xf0, 0x7f, 0x7f, 0x02, 0x7f, 0x01, 0x31, 0x32, 0x00, 0xf7
    ])
  })

  it('carries the cue number, the list, or the delimiter that says which was left out', () => {
    // "Cue 1 (no cue list provided)": the number and the delimiter.
    expect(mscCueData('1', '')).toEqual([0x31, 0x00])
    // "Cue 3/ (no cue number provided — play next cue in list 3)": the empty field first.
    expect(mscCueData('', '3')).toEqual([0x00, 0x33])
    // A command that names no cue at all carries no data.
    expect(mscCueData('', '')).toEqual([])
    // Anything a console could not read as a number is dropped rather than sent: the
    // specification's fields are ASCII, and a stray byte in a sysex is a broken message.
    expect(mscCueData('1\u0007', '')).toEqual([0x31, 0x00])
  })

  it('reads back as the message it was, framed or not', () => {
    const message = msc({ deviceId: 12, format: 'sound', command: 'load', cueNumber: '4/7', cueList: '2' })

    expect(parseMsc(encodeMsc(message))).toEqual(message)
  })

  it('takes the trailing delimiter the specification tells devices to accept', () => {
    // `31 00` is cue 1 with the delimiter and no list; a console that pads the message
    // with more delimiters before F7 is within the specification, and is read the same.
    const padded = { kind: 'sysex' as const, data: [0x7f, 0x7f, 0x02, 0x7f, 0x01, 0x31, 0x00, 0x00] }

    expect(parseMsc(padded)).toEqual(msc({ command: 'go', cueNumber: '1' }))
  })

  it('refuses anything that is not a message this app understands', () => {
    // A sysex for something else entirely.
    expect(parseMsc({ kind: 'sysex', data: [0x00, 0x20, 0x33, 0x02] })).toBeNull()
    // An extension-level command, which the specification reserves: a console's future
    // command must not be read as one of ours.
    expect(parseMsc({ kind: 'sysex', data: [0x7f, 0x7f, 0x02, 0x00, 0x01] })).toBeNull()
    expect(parseMsc({ kind: 'sysex', data: [0x7f, 0x7f, 0x02, 0x7f, 0x00] })).toBeNull()
    // A command this app does not send — a SET, a FIRE — is not a cue firing.
    expect(parseMsc({ kind: 'sysex', data: [0x7f, 0x7f, 0x02, 0x7f, 0x07, 0x11] })).toBeNull()
    // Truncated before the command byte.
    expect(parseMsc({ kind: 'sysex', data: [0x7f, 0x7f, 0x02] })).toBeNull()
    // Not a sysex at all.
    expect(parseMsc({ kind: 'noteOn', channel: 1, note: 60, velocity: 127 })).toBeNull()
  })

  it('is written in the words a console’s own front panel uses', () => {
    expect(describeMsc(msc({ cueNumber: '12.5', cueList: '2' }))).toBe('Go cue 12.5 list 2')
    expect(describeMsc(msc({ command: 'reset' }))).toBe('Reset')
    expect(mscBytes(msc({ command: 'reset' }))).toEqual([0x7f, 0x7f, 0x02, 0x7f, 0x0a])
  })
})
