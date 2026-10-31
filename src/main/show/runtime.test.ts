// The runtime is what the IPC layer talks to: it owns the bus and the service host, so
// the window plumbing never has to know which services exist.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createShowRuntime } from './runtime'
import { defaultShowSettings } from '../../shared/show'
import type { CommandResult, ServiceContext, ShowService } from '../bus/ServiceHost'
import type { ShowEvent, ShowSettings } from '../../shared/show'

class FakeService implements ShowService {
  readonly id: string
  readonly label: string
  /** What this fake reads: a fake that declares nothing is never restarted. */
  readonly settingsSections: readonly (keyof ShowSettings)[]
  starts = 0
  stops = 0
  command?: (action: string, payload?: unknown) => unknown

  constructor(
    id = 'fake',
    label = 'Fake service',
    sections: readonly (keyof ShowSettings)[] = []
  ) {
    this.id = id
    this.label = label
    this.settingsSections = sections
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
  readonly settingsSections = [] as const

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
    // each time would drop whatever is mid-flight. The same value twice is what that
    // looks like from here.
    const settings = defaultShowSettings()
    await runtime.configure(settings)
    await runtime.configure(settings)

    expect(service.starts).toBe(1)
    expect(service.stops).toBe(0)
    runtime.close()
  })

  it('restarts nothing when a configure carries the same values in another key order', async () => {
    // The configure is where the operator's edit lands, so the claim is held here too:
    // a rebuilt settings object whose keys moved must reach the host and change nothing.
    vi.useFakeTimers()
    const service = new FakeService('fake', 'Fake service', ['oscIn'])
    const runtime = createShowRuntime([service])

    const settings = defaultShowSettings()
    await runtime.configure(settings)
    await runtime.configure({
      ...settings,
      oscIn: { port: settings.oscIn.port, enabled: settings.oscIn.enabled }
    })

    expect(service.starts).toBe(1)
    expect(service.stops).toBe(0)
    runtime.close()
  })

  it('restarts the services when a section they declare actually changes', async () => {
    vi.useFakeTimers()
    const service = new FakeService('fake', 'Fake service', ['oscIn'])
    const runtime = createShowRuntime([service])

    await runtime.configure(defaultShowSettings())
    await runtime.configure(movedPort(53001))

    expect(service.starts).toBe(2)
    expect(service.stops).toBe(1)
    runtime.close()
  })

  it('leaves the companion alone when only the script moved', async () => {
    // The arm this removes claimed `script`, which the companion's start() never reads:
    // a script edit dropped the tablet's stream for nothing.
    vi.useFakeTimers()
    const companion = new FakeService('companion', 'Companion', ['companion'])
    const runtime = createShowRuntime([companion])

    await runtime.configure(defaultShowSettings())
    await runtime.configure({
      ...defaultShowSettings(),
      script: { path: '/shows/hamlet.txt', fontSize: 20 }
    })

    expect(companion.starts).toBe(1)
    expect(companion.stops).toBe(0)
    runtime.close()
  })

  it('restarts only the service whose declared section changed', async () => {
    vi.useFakeTimers()
    const osc = new FakeService('osc-in', 'OSC input', ['oscIn'])
    const midi = new FakeService('midi-in', 'MIDI input', ['midiIn'])
    const runtime = createShowRuntime([osc, midi])

    await runtime.configure(defaultShowSettings())
    await runtime.configure(movedPort(53001))

    expect(osc.starts).toBe(2)
    expect(osc.stops).toBe(1)
    expect(midi.starts).toBe(1)
    expect(midi.stops).toBe(0)
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

  it('raises a fault the show itself owes, not a service, on the one alarm path', async () => {
    // A device the engine lost belongs to no service, and its alarm still has one home:
    // this surface, which is what main calls when the engine reports a fault. What the
    // operator sees is the engine's own words — the same line the log carries — on the
    // strip and the chip a service's alarm reaches.
    vi.useFakeTimers()
    const runtime = createShowRuntime([new FakeService()])
    const batches: ShowEvent[][] = []
    runtime.subscribe(batch => batches.push(batch))

    runtime.alert('critical', 'audio', 'audio device stopped unexpectedly')
    vi.advanceTimersByTime(100)

    expect(runtime.snapshot().alerts).toEqual([
      expect.objectContaining({ level: 'critical', source: 'audio', message: 'audio device stopped unexpectedly' })
    ])
    expect(batches.flat().flatMap(event => event.kind === 'alert' ? [event.alert.message] : []))
      .toEqual(['audio device stopped unexpectedly'])
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

  it('carries the state a commanded service reports, and leaves the record alone when it reports none', async () => {
    // A command is a request, not an assignment: the host passes it through and the
    // service answers — including by saying what it is doing now — so the record is the
    // service's own answer. That is why a command never writes it: one that reports a
    // state puts that state where every panel reads it, and one that reports nothing
    // leaves the record exactly where `start` left it.
    vi.useFakeTimers()
    let context: ServiceContext | null = null
    const service: ShowService = {
      id: 'fake',
      label: 'Fake service',
      settingsSections: [],
      start: (given: ServiceContext): void => {
        context = given
        given.setState('running', 'ready')
      },
      stop: (): void => {},
      command: (action: string): unknown => {
        if (action === 'rescan') context?.setState('running', 'did rescan')
        return { ok: true }
      }
    }
    const runtime = createShowRuntime([service])
    await runtime.configure(defaultShowSettings())

    const quiet = await runtime.command('fake', 'ping')

    expect(quiet).toEqual({ ok: true, result: { ok: true } })
    expect(runtime.snapshot().services).toEqual([
      expect.objectContaining({ id: 'fake', state: 'running', detail: 'ready' })
    ])

    await runtime.command('fake', 'rescan')

    expect(runtime.snapshot().services).toEqual([
      expect.objectContaining({ id: 'fake', state: 'running', detail: 'did rescan' })
    ])
    runtime.close()
  })

  it('applies a configure that arrives mid-apply after the first, not alongside it', async () => {
    // The renderer's settings effect and redundancy:configure both fire
    // without waiting for an apply in flight. Two applies interleaved at a service's
    // start can leave it on the older settings while the memory records the newer ones,
    // and no later configure then corrects it — the memory says they are in force.
    const held = Promise.withResolvers<void>()
    const heldStarted = Promise.withResolvers<void>()
    const ports: number[] = []
    let starts = 0
    const service: ShowService = {
      id: 'osc-in',
      label: 'OSC input',
      settingsSections: ['oscIn'],
      async start(context: ServiceContext, settings: ShowSettings): Promise<void> {
        starts++
        ports.push(settings.oscIn.port)
        if (starts === 1) {
          heldStarted.resolve()
          await held.promise
        }
        context.setState('running', 'listening')
      },
      stop(): void {}
    }
    const runtime = createShowRuntime([service])

    const first = runtime.configure(movedPort(53000))
    await heldStarted.promise
    const second = runtime.configure(movedPort(53001))

    // Every turn it needs: an apply that did not wait its turn would have started by
    // now, and this one must not reach the service while the first is still in it.
    await new Promise<void>(resolve => {
      setImmediate(resolve)
    })
    expect(ports).toEqual([53000])

    held.resolve()
    await Promise.all([first, second])

    expect(ports).toEqual([53000, 53001])
    expect(runtime.snapshot().services[0]).toMatchObject({ state: 'running' })
    runtime.close()
  })

  it('holds a re-sent configure until the apply it duplicates has settled', async () => {
    // The renderer re-sends its settings on every autosave tick, and the memory is what
    // says a re-send is nothing to do. Answered at once, it says "already applied" while
    // a service is still starting on them.
    const held = Promise.withResolvers<void>()
    const heldStarted = Promise.withResolvers<void>()
    let starts = 0
    const service: ShowService = {
      id: 'osc-in',
      label: 'OSC input',
      settingsSections: ['oscIn'],
      async start(context: ServiceContext): Promise<void> {
        starts++
        if (starts === 1) {
          heldStarted.resolve()
          await held.promise
        }
        context.setState('running', 'listening')
      },
      stop(): void {}
    }
    const runtime = createShowRuntime([service])

    const settings = movedPort(53000)
    const first = runtime.configure(settings)
    await heldStarted.promise

    let duplicateSettled = false
    const duplicate = runtime.configure(settings).then(() => {
      duplicateSettled = true
    })
    await Promise.resolve()
    expect(duplicateSettled).toBe(false)

    held.resolve()
    await Promise.all([first, duplicate])

    // Skipped on honest memory, not waved through while the service was starting.
    expect(starts).toBe(1)
    runtime.close()
  })

  it('leaves each service on the newest settings when a configure and a by-id restart race', async () => {
    // redundancy:configure restarts its one service by id while the renderer's settings
    // effect may be mid-apply; the restart waits its turn, so a service cannot be
    // restated from settings the host is still moving away from.
    const held = Promise.withResolvers<void>()
    const heldStarted = Promise.withResolvers<void>()
    const defaults = defaultShowSettings()
    const events: string[] = []
    const listener: ShowService = {
      id: 'osc-in',
      label: 'OSC input',
      settingsSections: ['oscIn'],
      async start(context: ServiceContext, settings: ShowSettings): Promise<void> {
        events.push(`osc:start:${settings.oscIn.port}`)
        if (settings.oscIn.port === 53001) {
          heldStarted.resolve()
          await held.promise
        }
        context.setState('running', 'listening')
      },
      stop(): void {
        events.push('osc:stop')
      }
    }
    const redundancy: ShowService = {
      id: 'redundancy',
      label: 'Redundancy',
      settingsSections: [],
      start(context: ServiceContext): void {
        events.push('redundancy:start')
        context.setState('running', 'in sync')
      },
      stop(): void {
        events.push('redundancy:stop')
      }
    }
    const runtime = createShowRuntime([listener, redundancy])
    await runtime.configure(defaults)
    expect(events).toEqual([`osc:start:${defaults.oscIn.port}`, 'redundancy:start'])

    const configure = runtime.configure(movedPort(53001))
    await heldStarted.promise
    const restart = runtime.restart('redundancy')
    await Promise.resolve()
    expect(events).toEqual([
      `osc:start:${defaults.oscIn.port}`,
      'redundancy:start',
      'osc:stop',
      'osc:start:53001'
    ])

    held.resolve()
    await Promise.all([configure, restart])

    expect(events).toEqual([
      `osc:start:${defaults.oscIn.port}`,
      'redundancy:start',
      'osc:stop',
      'osc:start:53001',
      'redundancy:stop',
      'redundancy:start'
    ])
    expect(runtime.snapshot().services).toEqual([
      expect.objectContaining({ id: 'osc-in', state: 'running' }),
      expect.objectContaining({ id: 'redundancy', state: 'running' })
    ])
    runtime.close()
  })
})
