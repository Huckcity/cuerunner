// The stand-in port the end-to-end suite reads a MIDI File cue's output from: it has to look
// to the engine like the native module, and write down what it was sent.

import { afterEach, describe, expect, it } from 'vitest'
import { MidiEngine } from './MidiEngine'
import { createMidiLoopback, installMidiLoopback } from './loopback'

afterEach(() => {
  globalThis.__cuerunnerMidiLoopback = undefined
})

describe('the loopback port', () => {
  it('is the one output port the engine finds, and records what is sent to it', () => {
    const { load, harness } = createMidiLoopback('cuerunner-feat-midi-file-cue')
    const engine = new MidiEngine(load)
    expect(engine.status()).toEqual({ available: true, error: null })
    expect(engine.listOutputPorts()).toEqual(['cuerunner-feat-midi-file-cue'])
    expect(engine.sendRaw('cuerunner-feat-midi-file-cue', [[0x90, 60, 100], [0x80, 60, 0]])).toEqual({ ok: true })
    expect(harness.messages().map(message => message.bytes)).toEqual([[0x90, 60, 100], [0x80, 60, 0]])
    harness.clear()
    expect(harness.messages()).toEqual([])
  })

  it('is reachable from main’s global scope once installed', () => {
    installMidiLoopback('cuerunner-feat-midi-file-cue')
    expect(globalThis.__cuerunnerMidiLoopback?.portName).toBe('cuerunner-feat-midi-file-cue')
  })
})
