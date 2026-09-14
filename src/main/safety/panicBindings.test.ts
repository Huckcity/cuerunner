// The two bindings that let a desk or a keyboard stop the show: OSC /winslab/panic and
// MIDI all-sound-off. Both are decided here, away from sockets and interfaces, because
// the decision is the part that has to be right at 20:05.
import { describe, it, expect } from 'vitest'
import { MIDI_ALL_SOUND_OFF, panicFromShowEvent } from './panicBindings'
import type { ShowEvent } from '../../renderer/src/types/show'

const osc = (address: string): ShowEvent => ({
  kind: 'osc', at: 1, from: '192.168.1.24:8000', address, args: []
})

const cc = (controller: number, value: number): ShowEvent => ({
  kind: 'midi',
  at: 1,
  device: 'Stage Rack',
  message: { kind: 'cc', channel: 1, controller, value }
})

describe('panicFromShowEvent', () => {
  it('reads /winslab/panic as a panic, whoever sent it', () => {
    expect(panicFromShowEvent(osc('/winslab/panic'))).toEqual({
      source: 'osc',
      reason: 'OSC /winslab/panic from 192.168.1.24:8000'
    })
  })

  it('leaves every other OSC address to the cue stack', () => {
    expect(panicFromShowEvent(osc('/winslab/go'))).toBeNull()
    expect(panicFromShowEvent(osc('/dca/1/mute'))).toBeNull()
  })

  it('reads CC 120 at zero as all-sound-off', () => {
    expect(panicFromShowEvent(cc(MIDI_ALL_SOUND_OFF, 0))).toEqual({
      source: 'midi',
      reason: 'MIDI all-sound-off on Stage Rack'
    })
  })

  it('ignores the same controller at any other value, and other controllers', () => {
    expect(panicFromShowEvent(cc(MIDI_ALL_SOUND_OFF, 1))).toBeNull()
    expect(panicFromShowEvent(cc(MIDI_ALL_SOUND_OFF, 127))).toBeNull()
    expect(panicFromShowEvent(cc(7, 0))).toBeNull()
  })

  it('ignores everything that is not an input message', () => {
    expect(panicFromShowEvent({
      kind: 'midi', at: 1, device: 'Stage Rack',
      message: { kind: 'noteOn', channel: 1, note: 60, velocity: 100 }
    })).toBeNull()
    expect(panicFromShowEvent({
      kind: 'alert', at: 1,
      alert: { id: 1, at: 1, level: 'info', source: 'osc-in', message: 'listening' }
    })).toBeNull()
  })
})
