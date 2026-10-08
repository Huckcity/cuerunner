// What a MIDI File cue does to its file's messages, and the state it puts a port in before
// playing from part-way through.

import { describe, expect, it } from 'vitest'
import type { SmfEvent } from '../../shared/smf'
import { MIDI_FILE_IDENTITY_MAP, type MidiFileOptions } from '../../shared/midiFile'
import { chaseMessages, midiFileTransform } from './midiFilePlan'

const options = (over: Partial<MidiFileOptions> = {}): MidiFileOptions => ({
  rate: 1,
  startMs: 0,
  endMs: null,
  loopCount: 0,
  channelMap: [...MIDI_FILE_IDENTITY_MAP],
  transpose: 0,
  transposeDrums: false,
  ...over
})

/** Events at the given times, all on track 0. */
function events(...timed: [number, ...number[]][]): SmfEvent[] {
  return timed.map(([ms, ...data]) => ({ ms, track: 0, data }))
}

describe('the channel map and transposition', () => {
  it('leaves the file as written by default', () => {
    const transform = midiFileTransform(options())
    expect(transform([0x93, 60, 100])).toEqual([0x93, 60, 100])
    expect(transform([0xe0, 0, 64])).toEqual([0xe0, 0, 64])
  })

  it('sends a channel out as the channel the map gives it, and not at all where it says none', () => {
    const channelMap = [...MIDI_FILE_IDENTITY_MAP]
    channelMap[0] = 5
    channelMap[1] = 0
    const transform = midiFileTransform(options({ channelMap }))
    expect(transform([0x90, 60, 100])).toEqual([0x94, 60, 100])
    expect(transform([0xb0, 7, 90])).toEqual([0xb4, 7, 90])
    expect(transform([0x91, 60, 100])).toBeNull()
    expect(transform([0xc1, 3])).toBeNull()
  })

  it('moves notes, their releases and their key pressure, and nothing else', () => {
    const transform = midiFileTransform(options({ transpose: -3 }))
    expect(transform([0x90, 60, 100])).toEqual([0x90, 57, 100])
    expect(transform([0x80, 60, 0])).toEqual([0x80, 57, 0])
    expect(transform([0xa0, 60, 30])).toEqual([0xa0, 57, 30])
    expect(transform([0xb0, 60, 30])).toEqual([0xb0, 60, 30])
    expect(transform([0xc0, 60])).toEqual([0xc0, 60])
  })

  it('leaves channel 10 where it is unless the cue asks for the drums to move too', () => {
    expect(midiFileTransform(options({ transpose: 2 }))([0x99, 36, 100])).toEqual([0x99, 36, 100])
    expect(midiFileTransform(options({ transpose: 2, transposeDrums: true }))([0x99, 36, 100])).toEqual([0x99, 38, 100])
    // It is the file's channel 10 that is exempt, wherever the map sends it.
    const channelMap = [...MIDI_FILE_IDENTITY_MAP]
    channelMap[9] = 11
    expect(midiFileTransform(options({ transpose: 2, channelMap }))([0x99, 36, 100])).toEqual([0x9a, 36, 100])
  })

  it('drops a note moved off the keyboard, and its release with it', () => {
    const transform = midiFileTransform(options({ transpose: 12 }))
    expect(transform([0x90, 120, 100])).toBeNull()
    expect(transform([0x80, 120, 0])).toBeNull()
    expect(transform([0x90, 115, 100])).toEqual([0x90, 127, 100])
  })

  it('sends a SysEx untouched', () => {
    const transform = midiFileTransform(options({ transpose: 5, channelMap: Array(16).fill(0) }))
    expect(transform([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7])).toEqual([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7])
  })
})

describe('chasing the channels to a place in the file', () => {
  it('sends the program a channel had, with the bank it was chosen from', () => {
    const file = events(
      [0, 0xb0, 0, 1], [0, 0xb0, 32, 2], [0, 0xc0, 10],
      // A bank select after the last program: the device holds it, so the chase does too,
      // after the program it does not apply to.
      [100, 0xb0, 0, 5]
    )
    expect(chaseMessages(file, 200)).toEqual([[0xb0, 0, 1], [0xb0, 32, 2], [0xc0, 10], [0xb0, 0, 5]])
  })

  it('sends each controller at its last value, and leaves out the mode messages', () => {
    const file = events(
      [0, 0xb1, 7, 100], [10, 0xb1, 10, 30], [20, 0xb1, 7, 80], [30, 0xb1, 64, 127],
      [40, 0xb1, 123, 0], [50, 0xb1, 121, 0]
    )
    expect(chaseMessages(file, 100)).toEqual([[0xb1, 7, 80], [0xb1, 10, 30], [0xb1, 64, 127]])
  })

  it('sets the pitch bend range before the bend it ranges, and closes the parameter after', () => {
    const file = events(
      [0, 0xb0, 101, 0], [0, 0xb0, 100, 0], [0, 0xb0, 6, 12], [0, 0xb0, 38, 0],
      [0, 0xb0, 101, 127], [0, 0xb0, 100, 127],
      [10, 0xe0, 0, 96]
    )
    expect(chaseMessages(file, 100)).toEqual([
      [0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 12], [0xb0, 38, 0],
      [0xb0, 101, 127], [0xb0, 100, 127],
      [0xe0, 0, 96]
    ])
  })

  it('restores the parameter the file left selected, an NRPN as readily as an RPN', () => {
    const file = events([0, 0xb2, 99, 1], [0, 0xb2, 98, 8], [0, 0xb2, 6, 70])
    expect(chaseMessages(file, 1)).toEqual([
      [0xb2, 99, 1], [0xb2, 98, 8], [0xb2, 6, 70],
      [0xb2, 99, 1], [0xb2, 98, 8]
    ])
  })

  it('sends the last bend and channel pressure', () => {
    const file = events([0, 0xe3, 0, 70], [5, 0xe3, 0, 64], [6, 0xd3, 40])
    expect(chaseMessages(file, 10)).toEqual([[0xe3, 0, 64], [0xd3, 40]])
  })

  it('never replays a note, key pressure or a SysEx', () => {
    const file = events([0, 0x90, 60, 100], [0, 0xa0, 60, 20], [0, 0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7])
    expect(chaseMessages(file, 10)).toEqual([])
  })

  it('reads only what comes before the place: what is at it plays in its turn', () => {
    const file = events([0, 0xc0, 1], [100, 0xc0, 2])
    expect(chaseMessages(file, 100)).toEqual([[0xc0, 1]])
    expect(chaseMessages(file, 0)).toEqual([])
  })
})
