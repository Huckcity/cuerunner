// A service that cannot reach its hardware must not be able to stop a cue firing, so
// the host's job is isolation: one failure stays one failure, and every command that
// cannot work is refused rather than accepted and silently dropped.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ServiceHost } from './ServiceHost'
import type { ServiceContext, ShowService } from './ServiceHost'
import { ShowBus } from './ShowBus'
import type { ShowAlert, ShowSettings } from '../../renderer/src/types/show'
import { defaultShowSettings } from '../../renderer/src/types/show'

function showSettings(): ShowSettings {
  return defaultShowSettings()
}

interface FakeOptions {
  id: string
  label?: string
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
})
