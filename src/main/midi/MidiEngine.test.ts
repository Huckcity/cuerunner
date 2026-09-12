// A MIDI cue that reached nothing used to look exactly like one that worked, because
// the engine returned without a word. It now reports what happened, a device that
// vanished mid-show cannot poison the cached handle, and a build without the optional
// native module says so instead of pretending the port was wrong.
import { describe, it, expect, beforeEach } from 'vitest'
import { MidiEngine, type MidiModuleLoader } from './MidiEngine'

/** Stands in for the `midi` package: an output port the test can read back. */
interface FakeMidi {
  loader: MidiModuleLoader
  /** Every message the engine sent through any handle it opened. */
  sent: number[][]
  /** Make the next send fail, as a device unplugged mid-show does. */
  failSendsWith(error: Error | null): void
}

/** A machine where the module is installed and these output ports exist. */
function withPorts(ports: string[] = []): FakeMidi {
  const sent: number[][] = []
  let failure: Error | null = null

  const loader: MidiModuleLoader = () => ({
    Output: class {
      getPortCount(): number { return ports.length }
      getPortName(index: number): string { return ports[index] }
      openPort(): void {}
      closePort(): void {}
      sendMessage(message: number[]): void {
        if (failure) throw failure
        sent.push(message)
      }
    },
    Input: class {
      getPortCount(): number { return ports.length }
      getPortName(index: number): string { return ports[index] }
      closePort(): void {}
    }
  })

  return { loader, sent, failSendsWith: error => { failure = error } }
}

/** A build where the optional native dependency is not there. */
const withoutModule: MidiModuleLoader = () => {
  throw new Error("Cannot find module 'midi'")
}

describe('MidiEngine', () => {
  describe('availability', () => {
    it('reports the module as available on a machine that has it', () => {
      const engine = new MidiEngine(withPorts(['Stage Rack']).loader)

      expect(engine.status()).toEqual({ available: true, error: null })
    })

    it('reports the module as unavailable, in words an operator can act on', () => {
      const engine = new MidiEngine(withoutModule)

      const status = engine.status()
      expect(status.available).toBe(false)
      expect(status.error).toMatch(/not installed/i)
    })

    it('says MIDI is unavailable rather than blaming the port when a cue fires', () => {
      const engine = new MidiEngine(withoutModule)

      const result = engine.send('Stage Rack', [{ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }])

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/MIDI is unavailable/)
    })

    it('lists no ports when the module is missing, rather than throwing', () => {
      const engine = new MidiEngine(withoutModule)

      expect(engine.listOutputPorts()).toEqual([])
      expect(engine.listInputPorts()).toEqual([])
    })
  })

  describe('send', () => {
    let fake: FakeMidi
    let engine: MidiEngine

    beforeEach(() => {
      fake = withPorts(['Stage Rack'])
      engine = new MidiEngine(fake.loader)
    })

    it('says so when the cue names a port that is not there', () => {
      const result = engine.send('Upstage', [{ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }])

      expect(result.ok).toBe(false)
      expect(result.error).toContain('Upstage')
    })

    it('says so when no port is configured at all', () => {
      const result = engine.send('', [{ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }])

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/no midi output port is set/i)
    })

    it('encodes each message kind on the channel the cue asks for', () => {
      const result = engine.send('Stage Rack', [
        { kind: 'noteOn', channel: 2, note: 60, velocity: 100 },
        { kind: 'noteOff', channel: 2, note: 60, velocity: 0 },
        { kind: 'cc', channel: 1, controller: 7, value: 42 },
        { kind: 'programChange', channel: 3, program: 12 },
        { kind: 'sysex', data: [0x7e, 0x01] }
      ])

      expect(result).toEqual({ ok: true })
      expect(fake.sent).toEqual([
        [0x91, 60, 100],
        [0x81, 60, 0],
        [0xb0, 7, 42],
        [0xc2, 12],
        [0xf0, 0x7e, 0x01, 0xf7]
      ])
    })

    it('drops a handle that throws, so the next send looks for the port again', () => {
      fake.failSendsWith(new Error('Cannot send message on closed port'))

      const failed = engine.send('Stage Rack', [{ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }])

      expect(failed).toEqual({ ok: false, error: 'Cannot send message on closed port' })

      // The broken handle is gone: the next send opens the port again and succeeds.
      fake.failSendsWith(null)
      const retried = engine.send('Stage Rack', [{ kind: 'noteOn', channel: 1, note: 61, velocity: 100 }])

      expect(retried).toEqual({ ok: true })
      expect(fake.sent).toEqual([[0x90, 61, 100]])
    })
  })
})
