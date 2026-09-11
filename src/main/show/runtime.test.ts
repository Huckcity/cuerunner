// The runtime is what the IPC layer talks to: it owns the bus and the service host, so
// the window plumbing never has to know which services exist.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createShowRuntime } from './runtime'
import { defaultShowSettings } from '../../renderer/src/types/show'
import type { CommandResult, ServiceContext, ShowService } from '../bus/ServiceHost'
import type { ShowEvent, ShowSettings } from '../../renderer/src/types/show'

class FakeService implements ShowService {
  readonly id: string
  readonly label: string
  starts = 0
  stops = 0
  command?: (action: string, payload?: unknown) => unknown

  constructor(id = 'fake', label = 'Fake service') {
    this.id = id
    this.label = label
  }

  start(context: ServiceContext): void {
    this.starts++
    context.setState('running', 'ready')
  }

  stop(): void {
    this.stops++
  }
}

class DeviceService implements ShowService {
  readonly id = 'devices'
  readonly label = 'Devices'

  start(context: ServiceContext): void {
    context.bus.device({
      id: 'devices:1',
      service: this.id,
      name: 'Pack 1',
      online: true,
      lastSeen: Date.now(),
      battery: { percent: 42 }
    })
    context.bus.alert('warning', this.id, 'Pack 1 is down to 42%')
    context.setState('running', 'watching 1 device')
  }

  stop(): void {}
}

function movedPort(port: number): ShowSettings {
  return { ...defaultShowSettings(), oscIn: { enabled: true, port } }
}

describe('createShowRuntime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts the services it was given and reports them in the snapshot', async () => {
    vi.useFakeTimers()
    const service = new FakeService()
    const runtime = createShowRuntime([service])

    await runtime.configure(defaultShowSettings())

    expect(service.starts).toBe(1)
    const snapshot = runtime.snapshot()
    expect(snapshot.services).toEqual([
      expect.objectContaining({ id: 'fake', label: 'Fake service', state: 'running', detail: 'ready' })
    ])
    expect(snapshot.at).toBeGreaterThan(0)
    runtime.close()
  })

  it('leaves the services alone when the same settings come back', async () => {
    vi.useFakeTimers()
    const service = new FakeService()
    const runtime = createShowRuntime([service])

    // The renderer re-sends its settings on every autosave tick; rebinding a UDP port
    // each time would drop whatever is mid-flight.
    await runtime.configure(defaultShowSettings())
    await runtime.configure(defaultShowSettings())

    expect(service.starts).toBe(1)
    expect(service.stops).toBe(0)
    runtime.close()
  })

  it('restarts the services when the settings actually change', async () => {
    vi.useFakeTimers()
    const service = new FakeService()
    const runtime = createShowRuntime([service])

    await runtime.configure(defaultShowSettings())
    await runtime.configure(movedPort(53001))

    expect(service.starts).toBe(2)
    expect(service.stops).toBe(1)
    runtime.close()
  })

  it('announces an OSC port move rather than moving the listener silently', async () => {
    vi.useFakeTimers()
    const runtime = createShowRuntime([new FakeService()])
    const batches: ShowEvent[][] = []
    runtime.subscribe(batch => batches.push(batch))

    await runtime.configure(defaultShowSettings())
    await runtime.configure(movedPort(53007))
    vi.advanceTimersByTime(100)

    const alerts = batches.flat().flatMap(event => event.kind === 'alert' ? [event.alert] : [])
    expect(alerts.map(alert => alert.message)).toEqual([
      expect.stringContaining('53007')
    ])
    runtime.close()
  })

  it('carries what the services published into the snapshot', async () => {
    vi.useFakeTimers()
    const runtime = createShowRuntime([new DeviceService()])

    await runtime.configure(defaultShowSettings())
    const snapshot = runtime.snapshot()

    expect(snapshot.devices).toEqual([
      expect.objectContaining({ id: 'devices:1', name: 'Pack 1', online: true })
    ])
    expect(snapshot.alerts).toEqual([
      expect.objectContaining({ level: 'warning', message: 'Pack 1 is down to 42%' })
    ])
    // The service's own state transitions ride the same bus, so the snapshot carries
    // them too — they are what the monitor's services strip is built from.
    expect(snapshot.events.filter(event => event.kind !== 'service').map(event => event.kind))
      .toEqual(['device', 'alert'])
    runtime.close()
  })

  it('routes a command to the service that owns it, and stops the services on close', async () => {
    vi.useFakeTimers()
    const commands: string[] = []
    const service = new FakeService()
    service.command = (action: string): CommandResult => {
      commands.push(action)
      return { ok: true }
    }
    const runtime = createShowRuntime([service])

    await runtime.configure(defaultShowSettings())
    const result = await runtime.command('fake', 'rescan')

    expect(result).toEqual({ ok: true, result: { ok: true } })
    expect(commands).toEqual(['rescan'])

    runtime.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.stops).toBe(1)
  })
})
