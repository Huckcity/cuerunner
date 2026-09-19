// A service that cannot reach its hardware must not be able to stop a cue firing, so
// the host's job is isolation: one failure stays one failure, and every command that
// cannot work is refused rather than accepted and silently dropped.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ServiceHost } from './ServiceHost'
import type { ServiceContext, ShowService } from './ServiceHost'
import { ShowBus } from './ShowBus'
import type { ShowAlert, ShowSettings } from '../../shared/show'
import { defaultShowSettings } from '../../shared/show'

function showSettings(): ShowSettings {
  return defaultShowSettings()
}

/** The same value with every object's keys written in the other order — never a change. */
function reorderedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderedKeys) as T
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const flipped: Record<string, unknown> = {}
    for (const key of Object.keys(source).reverse()) flipped[key] = reorderedKeys(source[key])
    return flipped as T
  }
  return value
}

interface FakeOptions {
  id: string
  label?: string
  /** The settings sections the fake reads — the id is deliberately not what decides. */
  sections?: readonly (keyof ShowSettings)[]
  start?: (context: ServiceContext, settings: ShowSettings) => void | Promise<void>
  stop?: () => void | Promise<void>
  command?: (action: string, payload?: unknown) => unknown
  withCommand?: boolean
  pro?: true
}

const running = (context: ServiceContext): void => context.setState('running', 'up')
const quiet = (): void => {}
const answer = (_action: string, _payload?: unknown): unknown => 'ok'

function fakeService(options: FakeOptions) {
  const startImpl: (context: ServiceContext, settings: ShowSettings) => void | Promise<void> =
    options.start ?? running
  const stopImpl: () => void | Promise<void> = options.stop ?? quiet
  const commandImpl: (action: string, payload?: unknown) => unknown = options.command ?? answer
  const start = vi.fn(startImpl)
  const stop = vi.fn(stopImpl)
  const command = vi.fn(commandImpl)
  const service: ShowService = {
    id: options.id,
    label: options.label ?? options.id,
    settingsSections: options.sections ?? [],
    start,
    stop,
    ...(options.pro === true ? { pro: true as const } : {}),
    ...(options.withCommand === false ? {} : { command })
  }
  return { service, start, stop, command }
}

interface Harness {
  host: ServiceHost
  bus: ShowBus
  alerts(): ShowAlert[]
}

function harness(options: { entitled?: () => boolean } = {}): Harness {
  const bus = new ShowBus({ now: () => 1000 })
  const host = new ServiceHost(bus, options.entitled ?? (() => true))
  return { host, bus, alerts: () => bus.snapshot().alerts }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ServiceHost — status', () => {
  it('shows a registered service as stopped before anything starts', () => {
    const { host } = harness()
    host.register(fakeService({ id: 'osc-in', label: 'OSC input' }).service)

    expect(host.status('osc-in')).toMatchObject({
      id: 'osc-in',
      label: 'OSC input',
      state: 'stopped',
      detail: 'not started'
    })
    expect(host.statuses()).toHaveLength(1)
  })

  it('has no status for a service that was never registered', () => {
    const { host } = harness()
    expect(host.status('nope')).toBeUndefined()
    expect(host.statuses()).toEqual([])
  })
})

describe('ServiceHost — startAll', () => {
  it('starts every registered service with the same settings', async () => {
    const { host } = harness()
    const osc = fakeService({ id: 'osc-in' })
    const midi = fakeService({ id: 'midi-in' })
    host.register(osc.service)
    host.register(midi.service)

    const settings = showSettings()
    await host.startAll(settings)

    expect(osc.start).toHaveBeenCalledTimes(1)
    expect(midi.start).toHaveBeenCalledTimes(1)
    expect(osc.start.mock.calls[0][1]).toBe(settings)
    expect(midi.start.mock.calls[0][1]).toBe(settings)
    expect(host.statuses().map(status => status.state)).toEqual(['running', 'running'])
  })

  it('stops each service before starting it again with new settings', async () => {
    const { host } = harness()
    const osc = fakeService({ id: 'osc-in' })
    host.register(osc.service)

    await host.startAll(showSettings())
    await host.startAll({ ...showSettings(), oscIn: { enabled: true, port: 53001 } })

    expect(osc.start).toHaveBeenCalledTimes(2)
    expect(osc.stop).toHaveBeenCalledTimes(1)
    // The stop that makes the reconfigure clean lands before the second start.
    expect(osc.stop.mock.invocationCallOrder[0]).toBeLessThan(osc.start.mock.invocationCallOrder[1])
    expect(osc.start.mock.calls[1][1].oscIn.port).toBe(53001)
  })

  it('starts the others even when one refuses to stop', async () => {
    const { host, alerts } = harness()
    const bad = fakeService({
      id: 'bad',
      label: 'Bad service',
      stop: () => {
        throw new Error('stuck')
      }
    })
    const good = fakeService({ id: 'good' })
    host.register(bad.service)
    host.register(good.service)

    await host.startAll(showSettings())
    await host.startAll({ ...showSettings(), oscIn: { enabled: true, port: 53001 } })

    expect(bad.start).toHaveBeenCalledTimes(2)
    expect(good.start).toHaveBeenCalledTimes(2)
    expect(host.status('good')?.state).toBe('running')
    expect(alerts()).toEqual([
      expect.objectContaining({
        level: 'warning',
        source: 'bad',
        message: 'Bad service failed to stop: stuck'
      })
    ])
  })

  it('marks a service as starting, with no detail of its own, before it runs', async () => {
    const { host } = harness()
    let observed: { state: string; detail: string } | undefined
    host.register(
      fakeService({
        id: 'osc-in',
        start: context => {
          const status = host.status('osc-in')
          observed = status && { state: status.state, detail: status.detail }
          context.setState('running', 'up')
        }
      }).service
    )

    await host.startAll(showSettings())

    expect(observed).toEqual({ state: 'starting', detail: '' })
  })

  it('records a throwing service as failed and still starts the rest', async () => {
    const { host } = harness()
    const bad = fakeService({
      id: 'bad',
      label: 'Bad service',
      start: () => {
        throw new Error('no driver')
      }
    })
    const good = fakeService({ id: 'good' })
    host.register(bad.service)
    host.register(good.service)

    await host.startAll(showSettings())

    expect(host.status('bad')).toMatchObject({ state: 'failed', detail: 'no driver', error: 'no driver' })
    expect(host.status('good')?.state).toBe('running')
    expect(good.start).toHaveBeenCalledTimes(1)
  })

  it('raises one warning when a service fails to start', async () => {
    const { host, alerts } = harness()
    host.register(
      fakeService({
        id: 'bad',
        label: 'Bad service',
        start: () => {
          throw new Error('no driver')
        }
      }).service
    )

    await host.startAll(showSettings())

    expect(alerts()).toEqual([
      expect.objectContaining({
        level: 'warning',
        source: 'bad',
        message: 'Bad service failed: no driver'
      })
    ])
  })
})

describe('ServiceHost — startChanged', () => {
  it('restarts the services whose declared section moved, and not the others', async () => {
    const { host } = harness()
    const osc = fakeService({ id: 'osc-in', sections: ['oscIn'] })
    const midi = fakeService({ id: 'midi-in', sections: ['midiIn'] })
    host.register(osc.service)
    host.register(midi.service)
    await host.startAll(showSettings())

    const moved = { ...showSettings(), oscIn: { enabled: true, port: 53001 } }
    await host.startChanged(moved)

    expect(osc.start).toHaveBeenCalledTimes(2)
    expect(osc.stop).toHaveBeenCalledTimes(1)
    // The restart is handed what just arrived, not the settings it came up on.
    expect(osc.start.mock.calls[1][1]).toBe(moved)
    expect(midi.start).toHaveBeenCalledTimes(1)
    expect(midi.stop).not.toHaveBeenCalled()
  })

  it('restarts nothing when a declared section says the same thing in another key order', async () => {
    // Key order is who built the object — the renderer rebuilds the settings on every
    // publish and a workspace read back from disk carries the file's order — so a
    // configure that moved no value must not restart a service for it.
    const { host } = harness()
    const osc = fakeService({ id: 'osc-in', sections: ['oscIn'] })
    const desk = fakeService({ id: 'midi-tcp', sections: ['desk'] })
    const rf = fakeService({ id: 'rf', sections: ['rf', 'cast'] })
    host.register(osc.service)
    host.register(desk.service)
    host.register(rf.service)
    const before = showSettings()
    await host.startAll(before)

    // `cast` is the section with the arrays of records, and it is `rf`'s second declared
    // section — both the array recursion and the second section must be reached.
    const reordered = {
      ...before,
      oscIn: reorderedKeys(before.oscIn),
      desk: reorderedKeys(before.desk),
      rf: reorderedKeys(before.rf),
      cast: reorderedKeys(before.cast)
    }
    // A reorder only bites while the bytes differ too: a one-key section would compare
    // equal either way and the case would hold nothing.
    for (const section of ['oscIn', 'desk', 'rf', 'cast'] as const) {
      expect(JSON.stringify(reordered[section])).not.toBe(JSON.stringify(before[section]))
    }

    await host.startChanged(reordered)

    expect(osc.start).toHaveBeenCalledTimes(1)
    expect(osc.stop).not.toHaveBeenCalled()
    expect(desk.start).toHaveBeenCalledTimes(1)
    expect(desk.stop).not.toHaveBeenCalled()
    expect(rf.start).toHaveBeenCalledTimes(1)
    expect(rf.stop).not.toHaveBeenCalled()
  })

  it('still restarts when an array inside a declared section is reordered', async () => {
    // Array order is content — the order input ports are opened in — where object key
    // order is not, so a reorder that moves an array is a move.
    const { host } = harness()
    const midi = fakeService({ id: 'midi-in', sections: ['midiIn'] })
    host.register(midi.service)
    await host.startAll({ ...showSettings(), midiIn: { enabled: true, portNames: ['Keys', 'Pad'] } })

    await host.startChanged({ ...showSettings(), midiIn: { enabled: true, portNames: ['Pad', 'Keys'] } })

    expect(midi.start).toHaveBeenCalledTimes(2)
    expect(midi.stop).toHaveBeenCalledTimes(1)
  })

  it('leaves a failed service to the real levers: a moved section retries it', async () => {
    // Dropping the byte comparison also drops an accidental retry: a reorder-only
    // configure used to thrash a service that failed, and now it does not. A declared
    // section that really moved still brings it up, and the operator's by-id restart is
    // the other lever.
    const { host } = harness()
    let broken = true
    const osc = fakeService({
      id: 'osc-in',
      sections: ['oscIn'],
      start: context => {
        if (broken) throw new Error('no driver')
        context.setState('running', 'up')
      }
    })
    host.register(osc.service)
    const before = showSettings()
    await host.startAll(before)
    expect(host.status('osc-in')?.state).toBe('failed')

    await host.startChanged({ ...before, oscIn: reorderedKeys(before.oscIn) })
    expect(osc.start).toHaveBeenCalledTimes(1)
    expect(host.status('osc-in')?.state).toBe('failed')

    broken = false
    await host.startChanged({ ...before, oscIn: { enabled: true, port: 53001 } })
    expect(osc.start).toHaveBeenCalledTimes(2)
    expect(host.status('osc-in')?.state).toBe('running')
  })

  it('leaves a service alone when a section it has not declared moved', async () => {
    // The arm this replaces claimed `script`, which CompanionService.start never reads,
    // so a script edit dropped the tablet's stream for nothing.
    const { host } = harness()
    const companion = fakeService({ id: 'companion', sections: ['companion'] })
    host.register(companion.service)
    await host.startAll(showSettings())

    await host.startChanged({
      ...showSettings(),
      script: { path: '/shows/hamlet.txt', fontSize: 20 }
    })

    expect(companion.start).toHaveBeenCalledTimes(1)
    expect(companion.stop).not.toHaveBeenCalled()
  })

  it('never restarts a service that declares no sections', async () => {
    // Redundancy reads the machine's settings rather than the show's, so a configure
    // must not drop the pair's link.
    const { host } = harness()
    const redundancy = fakeService({ id: 'redundancy', sections: [] })
    host.register(redundancy.service)
    await host.startAll(showSettings())

    await host.startChanged({
      ...showSettings(),
      oscIn: { enabled: true, port: 53001 },
      script: { path: '/shows/hamlet.txt', fontSize: 20 }
    })

    expect(redundancy.start).toHaveBeenCalledTimes(1)
    expect(redundancy.stop).not.toHaveBeenCalled()
  })

  it('restarts a two-section service whichever of its sections moved, and remembers what it applied', async () => {
    const { host } = harness()
    const rf = fakeService({ id: 'rf', sections: ['rf', 'cast'] })
    const midi = fakeService({ id: 'midi-in', sections: ['midiIn'] })
    host.register(rf.service)
    host.register(midi.service)
    await host.startAll(showSettings())

    // The second declared section: a comparison that stopped at the first would leave the
    // service watching a cast it no longer matches.
    const cast = { ...defaultShowSettings().cast, ensembles: [{ id: 'chorus', name: 'Chorus', members: [] }] }
    const movedCast = { ...showSettings(), cast }
    await host.startChanged(movedCast)

    expect(rf.start).toHaveBeenCalledTimes(2)
    expect(rf.start.mock.calls[1][1]).toBe(movedCast)
    expect(midi.start).toHaveBeenCalledTimes(1)

    // A later change somewhere else compares against what was last applied, not against
    // the first settings: the service whose own sections have not moved since stays up.
    await host.startChanged({ ...movedCast, midiIn: { enabled: true, portNames: ['Keys'] } })

    expect(midi.start).toHaveBeenCalledTimes(2)
    expect(rf.start).toHaveBeenCalledTimes(2)
  })

  it('brings every service up when no settings have been applied yet', async () => {
    // The first configure: there is nothing to compare against, so the declaration cannot
    // decide anything and every service — including one that declares nothing — comes up.
    const { host } = harness()
    const redundancy = fakeService({ id: 'redundancy', sections: [] })
    const osc = fakeService({ id: 'osc-in', sections: ['oscIn'] })
    host.register(redundancy.service)
    host.register(osc.service)

    await host.startChanged(showSettings())

    expect(redundancy.start).toHaveBeenCalledTimes(1)
    expect(osc.start).toHaveBeenCalledTimes(1)
    expect(host.status('osc-in')?.state).toBe('running')
  })

  it('restarts and answers a service registered by its declaration alone', async () => {
    // Nothing in the host was built knowing this id: the declaration is what says whether
    // a configure reaches it, and the by-id routes work for whatever was registered.
    const { host } = harness()
    const late = fakeService({ id: 'late-service', sections: ['oscIn'] })
    host.register(late.service)
    await host.startAll(showSettings())

    await host.startChanged({ ...showSettings(), oscIn: { enabled: true, port: 53001 } })

    expect(late.start).toHaveBeenCalledTimes(2)
    expect(late.stop).toHaveBeenCalledTimes(1)
    expect(await host.restart('late-service')).toEqual({ ok: true })
    expect(await host.command('late-service', 'rescan')).toEqual({ ok: true, result: 'ok' })
  })
})

describe('ServiceHost — command', () => {
  it('refuses a command to an unknown service', async () => {
    const { host } = harness()
    expect(await host.command('nope', 'rescan')).toEqual({
      ok: false,
      error: 'Unknown service "nope"'
    })
  })

  it('refuses a command to a service that takes none', async () => {
    const { host } = harness()
    host.register(fakeService({ id: 'plain', withCommand: false }).service)
    await host.startAll(showSettings())

    expect(await host.command('plain', 'go')).toEqual({
      ok: false,
      error: 'Service "plain" takes no commands'
    })
  })

  it('does not call a failed service', async () => {
    const { host, alerts } = harness()
    const bad = fakeService({
      id: 'bad',
      start: () => {
        throw new Error('no driver')
      }
    })
    host.register(bad.service)
    await host.startAll(showSettings())

    expect(await host.command('bad', 'rescan')).toEqual({
      ok: false,
      error: 'Service "bad" is not running'
    })
    expect(bad.command).not.toHaveBeenCalled()
    // The only alarm is the start failure; the refused command adds none.
    expect(alerts()).toHaveLength(1)
  })

  it('passes the action and payload through and returns the result', async () => {
    const { host } = harness()
    const midi = fakeService({ id: 'midi-in', command: () => ({ ports: ['Keys'] }) })
    host.register(midi.service)
    await host.startAll(showSettings())

    expect(await host.command('midi-in', 'rescan', { force: true })).toEqual({
      ok: true,
      result: { ports: ['Keys'] }
    })
    expect(midi.command).toHaveBeenCalledWith('rescan', { force: true })
  })

  it('reports a throwing command and raises a warning', async () => {
    const { host, alerts } = harness()
    const midi = fakeService({
      id: 'midi-in',
      command: () => {
        throw new Error('no such port')
      }
    })
    host.register(midi.service)
    await host.startAll(showSettings())

    expect(await host.command('midi-in', 'rescan')).toEqual({ ok: false, error: 'no such port' })
    expect(alerts()).toEqual([
      expect.objectContaining({
        level: 'warning',
        source: 'midi-in',
        message: 'Command "rescan" failed: no such port'
      })
    ])
  })
})

describe('ServiceHost — restart and stop', () => {
  it('restarts a service by stopping then starting it', async () => {
    const { host } = harness()
    const osc = fakeService({ id: 'osc-in' })
    host.register(osc.service)
    await host.startAll(showSettings())

    expect(await host.restart('osc-in')).toEqual({ ok: true })
    expect(osc.stop).toHaveBeenCalledTimes(1)
    expect(osc.start).toHaveBeenCalledTimes(2)
    expect(osc.stop.mock.invocationCallOrder[0]).toBeLessThan(osc.start.mock.invocationCallOrder[1])
    expect(host.status('osc-in')?.state).toBe('running')
  })

  it('refuses a restart of an unknown service', async () => {
    const { host } = harness()
    expect(await host.restart('nope')).toEqual({ ok: false, error: 'Unknown service "nope"' })
  })

  it('refuses a restart before any settings are known', async () => {
    const { host } = harness()
    host.register(fakeService({ id: 'osc-in' }).service)

    const result = await host.restart('osc-in')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('osc-in')
  })

  it('reports a restart that fails again', async () => {
    const { host } = harness()
    let attempts = 0
    const osc = fakeService({
      id: 'osc-in',
      start: context => {
        attempts += 1
        if (attempts > 1) throw new Error('still broken')
        context.setState('running', 'up')
      }
    })
    host.register(osc.service)
    await host.startAll(showSettings())

    expect(await host.restart('osc-in')).toEqual({ ok: false, error: 'still broken' })
    expect(host.status('osc-in')?.state).toBe('failed')
  })

  it('stops every service even when one throws', async () => {
    const { host, alerts } = harness()
    const bad = fakeService({
      id: 'bad',
      label: 'Bad service',
      stop: () => {
        throw new Error('stuck')
      }
    })
    const good = fakeService({ id: 'good' })
    host.register(bad.service)
    host.register(good.service)
    await host.startAll(showSettings())

    await host.stopAll()

    expect(bad.stop).toHaveBeenCalledTimes(1)
    expect(good.stop).toHaveBeenCalledTimes(1)
    expect(alerts()).toEqual([
      expect.objectContaining({
        level: 'warning',
        source: 'bad',
        message: 'Bad service failed to stop: stuck'
      })
    ])
  })

  it('says stopped afterwards, because a snapshot is read after the fact', async () => {
    // Suspending the show (a licence removed, a quit) stops services on the host's
    // instruction, and none of them reports that. A window that asks what is listening
    // must not be told about a port that was closed.
    const { host } = harness()
    host.register(fakeService({ id: 'osc-in' }).service)
    host.register(fakeService({ id: 'companion' }).service)
    await host.startAll(showSettings())

    await host.stopAll()

    expect(host.statuses().map(status => [status.id, status.state, status.detail])).toEqual([
      ['osc-in', 'stopped', 'not started'],
      ['companion', 'stopped', 'not started']
    ])
  })

  it('does not claim a service stopped when its stop failed', async () => {
    // It may still be holding the socket it could not close.
    const { host } = harness()
    host.register(
      fakeService({
        id: 'bad',
        stop: () => {
          throw new Error('stuck')
        }
      }).service
    )
    await host.startAll(showSettings())

    await host.stopAll()

    expect(host.status('bad')?.state).toBe('running')
  })
})

describe('ServiceHost — entitlement', () => {
  it('starts the free services and leaves the Pro ones stopped, with the reason', async () => {
    const { host } = harness({ entitled: () => false })
    const free = fakeService({ id: 'osc-in' })
    const paid = fakeService({ id: 'rf', label: 'Wireless', pro: true })
    host.register(free.service)
    host.register(paid.service)

    await host.startAll(showSettings())

    expect(free.start).toHaveBeenCalledTimes(1)
    expect(paid.start).not.toHaveBeenCalled()
    expect(host.status('rf')).toMatchObject({
      state: 'stopped',
      detail: 'Wireless is part of Cuerunner Pro'
    })
  })

  it('refuses a Pro service’s command and restart by name, and lets the free one work', async () => {
    const { host } = harness({ entitled: () => false })
    host.register(fakeService({ id: 'rf', label: 'Wireless', pro: true }).service)
    host.register(fakeService({ id: 'osc-in' }).service)
    await host.startAll(showSettings())

    expect(await host.command('rf', 'repoll')).toEqual({
      ok: false, error: 'Wireless is part of Cuerunner Pro'
    })
    expect(await host.restart('rf')).toEqual({
      ok: false, error: 'Wireless is part of Cuerunner Pro'
    })
    expect(await host.command('osc-in', 'anything')).toEqual({ ok: true, result: 'ok' })
  })

  it('answers the licence afresh, so a key arriving brings the Pro half up and losing it puts it down', async () => {
    let licensed = false
    const { host } = harness({ entitled: () => licensed })
    const paid = fakeService({ id: 'rf', label: 'Wireless', pro: true })
    host.register(paid.service)

    await host.startAll(showSettings())
    expect(paid.start).not.toHaveBeenCalled()

    licensed = true
    await host.startAll(showSettings())
    expect(paid.start).toHaveBeenCalledTimes(1)

    licensed = false
    await host.startAll(showSettings())
    expect(paid.stop).toHaveBeenCalledTimes(1)
    expect(host.status('rf')?.state).toBe('stopped')
  })

  it('restarts a service whose slice moved in the same pass as a licence change', async () => {
    // The licence pass leaves the services that are already up alone, so entering a key
    // mid-session does not re-bind every port. A service whose settings moved in that
    // same configure is the exception: its settings are only in force once it has
    // restarted, and the caller records the configure as applied.
    let licensed = false
    const { host } = harness({ entitled: () => licensed })
    const listener = fakeService({ id: 'osc-in', sections: ['oscIn'] })
    const other = fakeService({ id: 'midi-in', sections: ['midiIn'] })
    host.register(listener.service)
    host.register(other.service)
    const before = showSettings()
    await host.startAll(before)

    licensed = true
    const moved = { ...before, oscIn: { enabled: true, port: 53001 } }
    await host.startAll(moved, { entitlementOnly: true })

    expect(listener.start).toHaveBeenCalledTimes(2)
    expect(listener.start).toHaveBeenLastCalledWith(expect.anything(), moved)
    expect(other.start).toHaveBeenCalledTimes(1)
  })
})
