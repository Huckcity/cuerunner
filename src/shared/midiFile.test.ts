// The MIDI File cue's options: the bounds each is held to, and how long a run of them takes.

import { describe, expect, it } from 'vitest'
import {
  MIDI_FILE_IDENTITY_MAP,
  midiFileOptionsProblem,
  midiFilePassMs,
  midiFileRegion,
  midiFileTotalMs,
  type MidiFileOptions
} from './midiFile'

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

describe('MIDI File cue options', () => {
  it('accepts the options a new cue is born with', () => {
    expect(midiFileOptionsProblem(options())).toBeNull()
  })

  it('refuses each option outside what the inspector offers, with a sentence', () => {
    expect(midiFileOptionsProblem(options({ rate: 0 }))).toMatch(/rate/)
    expect(midiFileOptionsProblem(options({ rate: 4.5 }))).toMatch(/rate/)
    expect(midiFileOptionsProblem(options({ startMs: -1 }))).toMatch(/start/)
    expect(midiFileOptionsProblem(options({ startMs: 500, endMs: 500 }))).toMatch(/end time/)
    expect(midiFileOptionsProblem(options({ loopCount: 1.5 }))).toMatch(/loop/)
    expect(midiFileOptionsProblem(options({ channelMap: [1, 2, 3] }))).toMatch(/channel map/)
    expect(midiFileOptionsProblem(options({ channelMap: [...MIDI_FILE_IDENTITY_MAP.slice(1), 17] }))).toMatch(/channel map/)
    expect(midiFileOptionsProblem(options({ transpose: 49 }))).toMatch(/transposition/)
    expect(midiFileOptionsProblem(options({ transpose: 0.5 }))).toMatch(/transposition/)
  })

  it('plays the region the options name, cut at the end of the file', () => {
    expect(midiFileRegion(10_000, options({ startMs: 2000, endMs: 4000 }))).toEqual({ startMs: 2000, endMs: 4000 })
    expect(midiFileRegion(10_000, options({ startMs: 2000, endMs: 60_000 }))).toEqual({ startMs: 2000, endMs: 10_000 })
    // A start at or past the end of the file is a region with nothing in it.
    expect(midiFileRegion(10_000, options({ startMs: 10_000 }))).toBeNull()
  })

  it('takes the region’s length at the rate, every pass, or no length for a loop until stopped', () => {
    expect(midiFilePassMs(10_000, options({ rate: 2 }))).toBe(5000)
    expect(midiFileTotalMs(10_000, options({ rate: 2, loopCount: 2 }))).toBe(15_000)
    expect(midiFileTotalMs(10_000, options({ startMs: 1000, endMs: 3000, rate: 0.5 }))).toBe(4000)
    expect(midiFileTotalMs(10_000, options({ loopCount: -1 }))).toBeNull()
  })
})
