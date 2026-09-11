// Incoming MIDI is described with the same message shapes a MIDI cue sends, so a note
// arriving and a note leaving are the same object with different directions. Anything
// the cue model cannot express is dropped rather than crammed into a bucket.
import { describe, it, expect } from 'vitest'
import { decodeMidiMessage } from './decode'

describe('decodeMidiMessage', () => {
  it('decodes a note on', () => {
    expect(decodeMidiMessage([0x90, 60, 100])).toEqual({
      kind: 'noteOn',
      channel: 1,
      note: 60,
      velocity: 100
    })
  })

  it('reads the channel from the low nibble, one-based', () => {
    expect(decodeMidiMessage([0x9f, 60, 100])).toMatchObject({ kind: 'noteOn', channel: 16 })
    expect(decodeMidiMessage([0x95, 60, 100])).toMatchObject({ kind: 'noteOn', channel: 6 })
  })

  it('decodes a note off', () => {
    expect(decodeMidiMessage([0x80, 60, 0])).toEqual({
      kind: 'noteOff',
      channel: 1,
      note: 60,
      velocity: 0
    })
  })

  it('treats a note on at zero velocity as a note off', () => {
    expect(decodeMidiMessage([0x90, 60, 0])).toEqual({
      kind: 'noteOff',
      channel: 1,
      note: 60,
      velocity: 0
    })
  })

  it('decodes a control change', () => {
    expect(decodeMidiMessage([0xb0, 7, 42])).toEqual({
      kind: 'cc',
      channel: 1,
      controller: 7,
      value: 42
    })
  })

  it('decodes a program change', () => {
    expect(decodeMidiMessage([0xc3, 12])).toEqual({
      kind: 'programChange',
      channel: 4,
      program: 12
    })
  })

  it('decodes sysex without its delimiters', () => {
    expect(decodeMidiMessage([0xf0, 0x7e, 0x01, 0xf7])).toEqual({
      kind: 'sysex',
      data: [0x7e, 0x01]
    })
    // A sender that forgot the trailing F7 still gets its bytes through.
    expect(decodeMidiMessage([0xf0, 0x7e, 0x01])).toEqual({
      kind: 'sysex',
      data: [0x7e, 0x01]
    })
    expect(decodeMidiMessage([0xf0])).toEqual({ kind: 'sysex', data: [] })
  })

  it('ignores clock, active sensing and the rest of the system messages', () => {
    for (const status of [0xf1, 0xf2, 0xf3, 0xf6, 0xf8, 0xfa, 0xfb, 0xfc, 0xfe, 0xff]) {
      expect(decodeMidiMessage([status, 0, 0])).toBeNull()
    }
  })

  it('ignores status nibbles the show has no use for', () => {
    for (const status of [0xa0, 0xd0, 0xe0, 0x70, 0x00, 0x40]) {
      expect(decodeMidiMessage([status, 1, 2])).toBeNull()
    }
  })

  it('ignores a truncated message', () => {
    expect(decodeMidiMessage([])).toBeNull()
    expect(decodeMidiMessage([0x90, 60])).toBeNull()
    expect(decodeMidiMessage([0x80, 60])).toBeNull()
    expect(decodeMidiMessage([0xb0, 7])).toBeNull()
    expect(decodeMidiMessage([0xc0])).toBeNull()
  })
})
