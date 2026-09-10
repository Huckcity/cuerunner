// A MIDI cue that reached nothing used to look exactly like one that worked, because
// the engine returned without a word. It now reports what happened, and a device that
// vanished mid-show cannot poison the cached handle.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MidiEngine } from './MidiEngine'

interface FakeOutput {
  sendMessage(message: number[]): void
}

/** The engine caches open ports; tests stand in for a real device through them. */
function portsOf(engine: MidiEngine): Map<string, FakeOutput> {
  // The port map is private. Reading it is the point of this helper, so it is taken
  // through an unknown view and checked before use.
  const fields = engine as unknown as Record<string, unknown>
  const outputs = fields.outputs
  if (!(outputs instanceof Map)) {
    throw new Error('MidiEngine.outputs is not reachable — this test needs updating')
  }
  return outputs as Map<string, FakeOutput>
}

describe('MidiEngine.send', () => {
  let engine: MidiEngine

  beforeEach(() => {
    engine = new MidiEngine()
  })

  it('says so when the cue names a port that is not there', () => {
    const result = engine.send('Stage Rack', [{ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }])

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Stage Rack')
  })

  it('says so when no port is configured at all', () => {
    const result = engine.send('', [{ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }])

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no midi output port is set/i)
  })

  it('encodes each message kind on the channel the cue asks for', () => {
    const sendMessage = vi.fn()
    portsOf(engine).set('Stage Rack', { sendMessage })

    const result = engine.send('Stage Rack', [
      { kind: 'noteOn', channel: 2, note: 60, velocity: 100 },
      { kind: 'noteOff', channel: 2, note: 60, velocity: 0 },
      { kind: 'cc', channel: 1, controller: 7, value: 42 },
      { kind: 'programChange', channel: 3, program: 12 },
      { kind: 'sysex', data: [0x7e, 0x01] }
    ])

    expect(result).toEqual({ ok: true })
    expect(sendMessage.mock.calls).toEqual([
      [[0x91, 60, 100]],
      [[0x81, 60, 0]],
      [[0xb0, 7, 42]],
      [[0xc2, 12]],
      [[0xf0, 0x7e, 0x01, 0xf7]]
    ])
  })

  it('drops a handle that throws, so the next send looks for the port again', () => {
    const sendMessage = vi.fn(() => { throw new Error('Cannot send message on closed port') })
    portsOf(engine).set('Stage Rack', { sendMessage })

    const failed = engine.send('Stage Rack', [{ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }])

    expect(failed).toEqual({ ok: false, error: 'Cannot send message on closed port' })
    expect(portsOf(engine).has('Stage Rack')).toBe(false)
  })
})
