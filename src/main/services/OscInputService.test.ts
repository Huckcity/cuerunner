// The OSC listener is the show's ear: one socket, every desk that talks to it, and a
// port conflict that must degrade rather than take the main process with it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { OscInputService } from './OscInputService'
import type { ServiceContext } from '../bus/ServiceHost'
import { ShowBus } from '../bus/ShowBus'
import type { ShowEvent, ShowSettings } from '../../shared/show'
import { defaultShowSettings } from '../../shared/show'

type OscEvent = Extract<ShowEvent, { kind: 'osc' }>

interface Rinfo {
  address: string
  port: number
}

/** Stands in for node-osc's Server so no UDP port is ever opened. */
class FakeOscServer {
  port: number
  readonly closed = vi.fn()
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

  constructor(port: number) {
    this.port = port
  }

  on(event: 'listening', listener: () => void): void
  on(event: 'message', listener: (message: unknown[], rinfo: Rinfo) => void): void
  on(event: 'bundle', listener: (bundle: { elements: unknown[][] }, rinfo: Rinfo) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: string, listener: (...args: any[]) => void): void {
    const existing = this.listeners[event] ?? []
    existing.push(listener)
    this.listeners[event] = existing
  }

  close(callback?: (error?: Error) => void): void {
    this.closed()
    callback?.()
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners[event] ?? []) listener(...args)
  }
}

function settings(enabled: boolean, port: number): ShowSettings {
  return { ...defaultShowSettings(), oscIn: { enabled, port }, midiIn: { enabled: false, portNames: [] } }
}

function oscEvents(bus: ShowBus): OscEvent[] {
  return bus.snapshot().events.filter((event): event is OscEvent => event.kind === 'osc')
}

interface Harness {
  service: OscInputService
  servers: FakeOscServer[]
  context: ServiceContext
  setState: Mock
  bus: ShowBus
}

function harness(): Harness {
  const servers: FakeOscServer[] = []
  const service = new OscInputService(port => {
    const server = new FakeOscServer(port)
    servers.push(server)
    return server
  })
  const bus = new ShowBus({ now: () => 1000 })
  const setState = vi.fn()
  return { service, servers, context: { bus, setState }, setState, bus }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('OscInputService', () => {
  it('binds nothing when OSC input is disabled', () => {
    const { service, servers, context, setState } = harness()

    service.start(context, settings(false, 53000))

    expect(servers).toHaveLength(0)
    expect(setState).toHaveBeenCalledWith('stopped', 'disabled')
  })

  it('reports the port the socket actually bound, not the one that was asked for', () => {
    const { service, servers, context, setState } = harness()

    service.start(context, settings(true, 53000))

    expect(servers).toHaveLength(1)
    expect(setState).toHaveBeenCalledWith('starting', 'binding 0.0.0.0:53000')

    // The operator asked for 53000; the socket came back on another port.
    servers[0].port = 51234
    servers[0].emit('listening')

    expect(setState).toHaveBeenCalledWith('running', 'listening on port 51234')
  })

  it('publishes a message with its sender and typed arguments', () => {
    const { service, servers, context, bus } = harness()
    service.start(context, settings(true, 53000))

    servers[0].emit(
      'message',
      ['/cue/1/start', 7, 1.5, true, false, 'go'],
      { address: '192.168.1.24', port: 8000 }
    )

    expect(oscEvents(bus)).toEqual([
      expect.objectContaining({
        kind: 'osc',
        from: '192.168.1.24:8000',
        address: '/cue/1/start',
        args: [
          { type: 'i', value: 7 },
          { type: 'f', value: 1.5 },
          { type: 'T', value: true },
          { type: 'F', value: false },
          { type: 's', value: 'go' }
        ]
      })
    ])
  })

  it('publishes one event per bundle element, in order', () => {
    const { service, servers, context, bus } = harness()
    service.start(context, settings(true, 53000))

    servers[0].emit(
      'bundle',
      { elements: [['/a', 1], ['/b', 'x'], ['/c', 2.5]] },
      { address: '10.0.0.2', port: 9000 }
    )

    expect(oscEvents(bus).map(event => event.address)).toEqual(['/a', '/b', '/c'])
    expect(oscEvents(bus).map(event => event.from)).toEqual([
      '10.0.0.2:9000',
      '10.0.0.2:9000',
      '10.0.0.2:9000'
    ])
  })

  it('publishes the messages inside a bundle that holds bundles', () => {
    // OSC 1.0 allows a bundle of bundles, and a message one level down used to be read as
    // a message with no address and dropped without a word.
    const { service, servers, context, bus } = harness()
    service.start(context, settings(true, 53000))

    servers[0].emit(
      'bundle',
      { elements: [['/a', 1], { elements: [{ elements: [['/deep', 2]] }, ['/b', 'x']] }] },
      { address: '10.0.0.2', port: 9000 }
    )

    expect(oscEvents(bus).map(event => event.address)).toEqual(['/a', '/deep', '/b'])
  })

  it('degrades and warns instead of throwing when the socket errors', () => {
    const { service, servers, context, setState, bus } = harness()
    service.start(context, settings(true, 53000))

    expect(() => servers[0].emit('error', new Error('EADDRINUSE'))).not.toThrow()

    expect(setState).toHaveBeenCalledWith('degraded', 'EADDRINUSE')
    expect(bus.snapshot().alerts).toEqual([
      expect.objectContaining({
        level: 'warning',
        source: 'osc-in',
        message: 'OSC input: EADDRINUSE'
      })
    ])
  })

  it('ignores a datagram that is not OSC instead of latching the service degraded', () => {
    // Anyone on the show network may send junk to this port. The listener is fine, so the
    // row stays running and the messages that do arrive keep firing cues; one line says it
    // happened, and a flood of junk is not a flood of alarms.
    const { service, servers, context, setState, bus } = harness()
    service.start(context, settings(true, 53000))
    servers[0].emit('listening')

    const junk = new Error("can't decode incoming message: Malformed Packet")
    servers[0].emit('error', junk, { address: '10.0.0.9', port: 9000 })
    servers[0].emit('error', junk, { address: '10.0.0.9', port: 9000 })
    servers[0].emit('message', ['/go'], { address: '10.0.0.9', port: 9000 })

    expect(setState).not.toHaveBeenCalledWith('degraded', expect.anything())
    expect(setState).toHaveBeenLastCalledWith('running', 'listening on port 53000')
    expect(bus.snapshot().alerts.filter(alert => alert.level === 'info')).toHaveLength(1)
    expect(oscEvents(bus)).toHaveLength(1)
  })

  it('closes the socket on stop, once', () => {
    const { service, servers, context } = harness()
    service.start(context, settings(true, 53000))
    const server = servers[0]

    service.stop()
    service.stop()

    expect(server.closed).toHaveBeenCalledTimes(1)
  })
})
