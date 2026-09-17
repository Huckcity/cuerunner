// The MIDI listener has to run on a machine where the optional `midi` package will not
// even build, and it has to notice a USB interface leaving mid-show — both before the
// cue that needed it does.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { MidiInputService } from './MidiInputService'
import type { ServiceContext } from '../bus/ServiceHost'
import { ShowBus } from '../bus/ShowBus'
import type { ShowEvent, ShowSettings } from '../../shared/show'
import { defaultShowSettings } from '../../shared/show'

type MidiEvent = Extract<ShowEvent, { kind: 'midi' }>

/** Stands in for the optional `midi` package's Input, against a scripted port list. */
class FakeMidiInput {
  openedPort = -1
  closed = false
  ignored: [boolean, boolean, boolean] | null = null
  private messageListener: ((deltaTime: number, message: number[]) => void) | null = null

  constructor(private readonly os: FakeMidiOs) {}

  getPortCount(): number {
    return this.os.ports.length
  }

  getPortName(index: number): string {
    return this.os.ports[index]
  }

  openPort(index: number): void {
    if (index < 0 || index >= this.os.ports.length) throw new Error(`no port at index ${index}`)
    this.openedPort = index
  }

  closePort(): void {
    this.openedPort = -1
    this.closed = true
  }

  ignoreTypes(sysex: boolean, timing: boolean, activeSense: boolean): void {
    this.ignored = [sysex, timing, activeSense]
  }

  on(_event: 'message', listener: (deltaTime: number, message: number[]) => void): void {
    this.messageListener = listener
  }

  emit(message: number[]): void {
    this.messageListener?.(0, message)
  }
}

class FakeMidiOs {
  ports: string[] = []
  failWith: Error | null = null
  readonly inputs: FakeMidiInput[] = []

  create(): FakeMidiInput {
    if (this.failWith) throw this.failWith
    const input = new FakeMidiInput(this)
    this.inputs.push(input)
    return input
  }

  /** The port the service currently has open under this name, if any. */
  openInput(name: string): FakeMidiInput | undefined {
    const index = this.ports.indexOf(name)
    return this.inputs.find(input => input.openedPort === index && !input.closed)
  }
}

function settings(enabled: boolean, portNames: string[]): ShowSettings {
  return { ...defaultShowSettings(), oscIn: { enabled: false, port: 53000 }, midiIn: { enabled, portNames } }
}

function midiEvents(bus: ShowBus): MidiEvent[] {
  return bus.snapshot().events.filter((event): event is MidiEvent => event.kind === 'midi')
}

interface Harness {
  service: MidiInputService
  os: FakeMidiOs
  context: ServiceContext
  setState: Mock
  bus: ShowBus
}

function harness(): Harness {
  const os = new FakeMidiOs()
  const service = new MidiInputService(() => os.create())
  const bus = new ShowBus({ now: () => 1000 })
  const setState = vi.fn()
  return { service, os, context: { bus, setState }, setState, bus }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('MidiInputService', () => {
  it('opens nothing when MIDI input is disabled', () => {
    const { service, os, context, setState } = harness()

    service.start(context, settings(false, []))

    expect(os.inputs).toHaveLength(0)
    expect(setState).toHaveBeenCalledWith('stopped', 'disabled')
  })

  it('degrades rather than throwing when the MIDI dependency is missing', () => {
    const { service, os, context, setState } = harness()
    os.failWith = new Error('midi is not installed')

    expect(() => service.start(context, settings(true, []))).not.toThrow()

    expect(setState).toHaveBeenCalledWith('degraded', 'midi is not installed')
  })

  it('opens the configured ports and reports them', () => {
    const { service, os, context, setState, bus } = harness()
    os.ports = ['Stage Rack', 'Keys']

    service.start(context, settings(true, ['Stage Rack']))

    const input = os.openInput('Stage Rack')
    expect(input).toBeDefined()
    // Sysex is kept; clock and active sensing are dropped.
    expect(input?.ignored).toEqual([false, true, true])
    expect(os.openInput('Keys')).toBeUndefined()
    expect(setState).toHaveBeenCalledWith('running', 'listening on "Stage Rack"')
    expect(
      bus.snapshot().devices.find(device => device.id === 'midi-in:Stage Rack')
    ).toMatchObject({
      service: 'midi-in',
      name: 'Stage Rack',
      model: 'MIDI input',
      online: true
    })
  })

  it('opens every available port when none is configured', () => {
    const { service, os, context, setState } = harness()
    os.ports = ['Stage Rack', 'Keys']

    service.start(context, settings(true, []))

    expect(os.openInput('Stage Rack')).toBeDefined()
    expect(os.openInput('Keys')).toBeDefined()
    expect(setState).toHaveBeenCalledWith('running', 'listening on "Stage Rack", "Keys"')
  })

  it('degrades and names a configured port that is not available', () => {
    const { service, os, context, setState } = harness()
    os.ports = ['Keys']

    service.start(context, settings(true, ['Stage Rack']))

    expect(setState).toHaveBeenCalledWith('degraded', 'no input port named "Stage Rack"')
    expect(os.openInput('Stage Rack')).toBeUndefined()
  })

  it('runs but waits for a missing port when another one opened', () => {
    const { service, os, context, setState } = harness()
    os.ports = ['Keys']

    service.start(context, settings(true, ['Keys', 'Stage Rack']))

    expect(os.openInput('Keys')).toBeDefined()
    expect(setState).toHaveBeenCalledWith('running', 'listening on 1 port, waiting for "Stage Rack"')
  })

  it('publishes a midi event for each decodable message and nothing for the rest', () => {
    const { service, os, context, bus } = harness()
    os.ports = ['Stage Rack']
    service.start(context, settings(true, ['Stage Rack']))
    const input = os.openInput('Stage Rack')
    if (!input) throw new Error('Stage Rack did not open')

    input.emit([0x90, 60, 100]) // note on
    input.emit([0xf8]) // clock: nothing the show needs
    input.emit([0x90, 60]) // truncated
    input.emit([0x80, 60, 0]) // note off

    expect(midiEvents(bus)).toEqual([
      expect.objectContaining({
        kind: 'midi',
        device: 'Stage Rack',
        message: { kind: 'noteOn', channel: 1, note: 60, velocity: 100 }
      }),
      expect.objectContaining({
        kind: 'midi',
        device: 'Stage Rack',
        message: { kind: 'noteOff', channel: 1, note: 60, velocity: 0 }
      })
    ])
  })

  it('closes a port that disappears, reports it offline and warns', () => {
    const { service, os, context, bus } = harness()
    os.ports = ['Stage Rack']
    service.start(context, settings(true, ['Stage Rack']))
    const input = os.openInput('Stage Rack')
    if (!input) throw new Error('Stage Rack did not open')

    os.ports = [] // the interface is unplugged
    vi.advanceTimersByTime(2000)

    expect(input.closed).toBe(true)
    expect(
      bus.snapshot().devices.find(device => device.id === 'midi-in:Stage Rack')?.online
    ).toBe(false)
    expect(bus.snapshot().alerts).toEqual([
      expect.objectContaining({
        level: 'warning',
        source: 'midi-in',
        message: 'MIDI input "Stage Rack" disconnected'
      })
    ])
  })

  it('reconciles immediately and returns the open ports on rescan', () => {
    const { service, os, context } = harness()
    os.ports = ['Stage Rack']
    service.start(context, settings(true, ['Stage Rack', 'Keys']))

    os.ports = ['Stage Rack', 'Keys']
    expect(service.command('rescan')).toEqual({ ports: ['Stage Rack', 'Keys'] })
    expect(os.openInput('Keys')).toBeDefined()
  })

  it('throws on an unknown action', () => {
    const { service } = harness()
    expect(() => service.command('reboot')).toThrow('Unknown action "reboot"')
  })

  it('closes every open port on stop', () => {
    const { service, os, context } = harness()
    os.ports = ['A', 'B']
    service.start(context, settings(true, []))
    const a = os.openInput('A')
    const b = os.openInput('B')
    if (!a || !b) throw new Error('ports did not open')

    service.stop()

    expect(a.closed).toBe(true)
    expect(b.closed).toBe(true)
  })

  it('publishes the offline rows before the context is gone', () => {
    const { service, os, context, bus } = harness()
    os.ports = ['A']
    service.start(context, settings(true, []))
    if (!os.openInput('A')) throw new Error('port did not open')

    service.stop()

    const rows = bus.snapshot().devices.filter(d => d.id === 'midi-in:A')
    expect(rows).toHaveLength(1)
    expect(rows[0].online).toBe(false)
  })
})
