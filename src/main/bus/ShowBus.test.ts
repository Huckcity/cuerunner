// A poller hands the bus a fresh reading on every pass, so the bus is what stands
// between the devices and the operator: an unchanged reading is not news, a changed one
// cannot arrive fifty times a second, and a device going offline cannot wait.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ShowBus } from './ShowBus'
import type { ShowBusOptions } from './ShowBus'
import type { DeviceState, OscInEvent, ShowEvent } from '../../shared/show'

const FLUSH_MS = 50
const DEVICE_INTERVAL_MS = 500

function oscEvent(address: string, at = 1000): OscInEvent {
  return { kind: 'osc', at, from: '127.0.0.1:8000', address, args: [] }
}

function deviceState(overrides: Partial<DeviceState> = {}): DeviceState {
  return {
    id: 'shure:pack-1',
    service: 'shure',
    name: 'Pack 1',
    model: 'ADX1',
    online: true,
    lastSeen: 1000,
    ...overrides
  }
}

interface Clock {
  now(): number
  advance(ms: number): void
}

/** Moves the wall clock and the timer queue together, in that order. */
function createClock(start = 1000): Clock {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
      vi.advanceTimersByTime(ms)
    }
  }
}

interface Setup {
  bus: ShowBus
  batches: ShowEvent[][]
  clock: Clock
  unsubscribe: () => void
}

function setup(options: ShowBusOptions = {}): Setup {
  const clock = createClock()
  const bus = new ShowBus({ flushMs: FLUSH_MS, ...options, now: clock.now })
  const batches: ShowEvent[][] = []
  const unsubscribe = bus.subscribe(events => {
    batches.push(events)
  })
  return { bus, batches, clock, unsubscribe }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ShowBus — batching', () => {
  it('holds events until the flush window closes', () => {
    const { bus, batches, clock } = setup()
    bus.publish(oscEvent('/cue/1/go'))

    expect(batches).toEqual([])

    clock.advance(FLUSH_MS)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1)
  })

  it('delivers everything published in one window as a single batch', () => {
    const { bus, batches, clock } = setup()
    bus.publish(oscEvent('/a'))
    bus.publish(oscEvent('/b'))
    bus.publish(oscEvent('/c'))

    clock.advance(FLUSH_MS)

    expect(batches).toEqual([
      [
        expect.objectContaining({ kind: 'osc', address: '/a' }),
        expect.objectContaining({ kind: 'osc', address: '/b' }),
        expect.objectContaining({ kind: 'osc', address: '/c' })
      ]
    ])
  })

  it('starts a new batch for events published after a flush', () => {
    const { bus, batches, clock } = setup()
    bus.publish(oscEvent('/a'))
    clock.advance(FLUSH_MS)
    bus.publish(oscEvent('/b'))
    clock.advance(FLUSH_MS)

    expect(batches.map(batch => batch.length)).toEqual([1, 1])
    expect(batches[1][0]).toMatchObject({ kind: 'osc', address: '/b' })
  })

  it('stops delivering to a listener that unsubscribes', () => {
    const { bus, batches, clock, unsubscribe } = setup()
    unsubscribe()
    bus.publish(oscEvent('/a'))
    clock.advance(FLUSH_MS)

    expect(batches).toEqual([])
  })
})

describe('ShowBus — device readings', () => {
  it('reports a device the first time it is seen', () => {
    const { bus, batches, clock } = setup()
    bus.device(deviceState())

    clock.advance(FLUSH_MS)

    expect(batches).toEqual([[expect.objectContaining({ kind: 'device' })]])
    expect(bus.snapshot().devices.map(device => device.id)).toEqual(['shure:pack-1'])
  })

  it('reports nothing when only lastSeen has moved', () => {
    const { bus, batches, clock } = setup()
    bus.device(deviceState({ lastSeen: 1000 }))
    clock.advance(FLUSH_MS)

    bus.device(deviceState({ lastSeen: 2000 }))
    clock.advance(FLUSH_MS)

    expect(batches).toHaveLength(1)
    // The registry still tracks the latest sighting, even though there was no news.
    expect(bus.snapshot().devices[0].lastSeen).toBe(2000)
  })

  it('reports a changed reading once the device interval has passed', () => {
    const { bus, batches, clock } = setup()
    bus.device(deviceState({ rf: { level: -40, unit: 'dBm' } }))
    clock.advance(FLUSH_MS)

    clock.advance(DEVICE_INTERVAL_MS)
    bus.device(deviceState({ rf: { level: -55, unit: 'dBm' }, lastSeen: 1600 }))
    clock.advance(FLUSH_MS)

    expect(batches).toHaveLength(2)
    expect(batches[1][0]).toMatchObject({ kind: 'device', device: { rf: { level: -55 } } })
  })

  it('holds a changed reading back until the device interval has passed', () => {
    const { bus, batches, clock } = setup()
    bus.device(deviceState({ rf: { level: -40, unit: 'dBm' } }))
    clock.advance(FLUSH_MS) // emitted, interval starts at t=1000

    clock.advance(100) // t=1100, still inside the interval
    bus.device(deviceState({ rf: { level: -55, unit: 'dBm' }, lastSeen: 1100 }))
    clock.advance(100) // t=1200, flushed but too early to report

    expect(batches).toHaveLength(1)

    clock.advance(300) // t=1500, the interval is up
    expect(batches).toHaveLength(2)
    expect(batches[1][0]).toMatchObject({ device: { rf: { level: -55 } } })
  })

  it('reports a device going offline immediately', () => {
    const { bus, batches, clock } = setup()
    bus.device(deviceState({ online: true }))
    clock.advance(FLUSH_MS) // t=1000

    clock.advance(100) // t=1100, inside the interval
    bus.device(deviceState({ online: false, lastSeen: 1100 }))
    clock.advance(FLUSH_MS) // t=1150

    expect(batches).toHaveLength(2)
    expect(batches[1][0]).toMatchObject({ kind: 'device', device: { online: false } })
  })

  it('reports a device coming back online immediately', () => {
    const { bus, batches, clock } = setup()
    bus.device(deviceState({ online: false }))
    clock.advance(FLUSH_MS)

    clock.advance(100)
    bus.device(deviceState({ online: true, lastSeen: 1100 }))
    clock.advance(FLUSH_MS)

    expect(batches).toHaveLength(2)
    expect(batches[1][0]).toMatchObject({ kind: 'device', device: { online: true } })
  })

  it('reports a device that has gained a detail reading', () => {
    const { bus, batches, clock } = setup()
    bus.device(deviceState())
    clock.advance(FLUSH_MS)

    clock.advance(DEVICE_INTERVAL_MS)
    bus.device(deviceState({ lastSeen: 1600, detail: { frequency: '470.100' } }))
    clock.advance(FLUSH_MS)

    expect(batches).toHaveLength(2)
    expect(batches[1][0]).toMatchObject({
      kind: 'device',
      device: { detail: { frequency: '470.100' } }
    })
  })

  it('reports a device when what it complains of changes, and not when it says the same again', () => {
    const { bus, batches, clock } = setup()
    bus.device(deviceState())
    clock.advance(FLUSH_MS)

    clock.advance(DEVICE_INTERVAL_MS)
    bus.device(deviceState({ lastSeen: 1600, warnings: [{ text: 'audio clipping' }] }))
    clock.advance(FLUSH_MS)
    expect(batches).toHaveLength(2)
    expect(batches[1][0]).toMatchObject({ device: { warnings: [{ text: 'audio clipping' }] } })

    clock.advance(DEVICE_INTERVAL_MS)
    bus.device(deviceState({ lastSeen: 2200, warnings: [{ text: 'audio clipping' }] }))
    clock.advance(FLUSH_MS)
    expect(batches).toHaveLength(2)

    // The same words made critical are a different complaint.
    clock.advance(DEVICE_INTERVAL_MS)
    bus.device(deviceState({ lastSeen: 2800, warnings: [{ text: 'audio clipping', critical: true }] }))
    clock.advance(FLUSH_MS)
    expect(batches).toHaveLength(3)
  })
})

describe('ShowBus — history, alerts and snapshot', () => {
  it('caps the event history at the configured limit', () => {
    const { bus } = setup({ historyLimit: 3 })
    for (const address of ['/1', '/2', '/3', '/4', '/5']) bus.publish(oscEvent(address))

    expect(bus.snapshot().events.map(event => (event.kind === 'osc' ? event.address : event.kind))).toEqual(
      ['/3', '/4', '/5']
    )
  })

  it('returns the current devices alongside the history', () => {
    const { bus, clock } = setup()
    bus.publish(oscEvent('/a'))
    bus.device(deviceState({ id: 'shure:1' }))
    clock.advance(FLUSH_MS)

    const snapshot = bus.snapshot()
    expect(snapshot.events.map(event => event.kind)).toEqual(['osc', 'device'])
    expect(snapshot.devices.map(device => device.id)).toEqual(['shure:1'])
  })

  it('caps stored alerts at 200, keeping the newest', () => {
    const { bus } = setup()
    for (let i = 0; i < 205; i++) bus.alert('warning', 'shure', `alert ${i}`)

    const alerts = bus.snapshot().alerts
    expect(alerts).toHaveLength(200)
    expect(alerts[0].id).toBe(6)
    expect(alerts[199].id).toBe(205)
    expect(alerts[199].message).toBe('alert 204')
  })

  it('stamps an alert with the device it came from', () => {
    const { bus } = setup()
    bus.alert('critical', 'shure', 'battery empty', 'shure:1')

    expect(bus.snapshot().alerts).toEqual([
      expect.objectContaining({
        level: 'critical',
        source: 'shure',
        message: 'battery empty',
        deviceId: 'shure:1',
        at: 1000
      })
    ])
  })

  it('leaves deviceId off an alert that has no device', () => {
    const { bus } = setup()
    bus.alert('info', 'midi-in', 'ready')

    expect('deviceId' in bus.snapshot().alerts[0]).toBe(false)
  })

  it('returns the alert it created so the caller can trace it', () => {
    const { bus } = setup()
    const alert = bus.alert('warning', 'osc-in', 'port in use')

    expect(bus.snapshot().alerts).toContainEqual(alert)
    expect(alert.id).toBe(1)
  })
})

describe('ShowBus — close', () => {
  it('drops queued events when closed', () => {
    const { bus, batches, clock } = setup()
    bus.publish(oscEvent('/a'))
    bus.close()
    clock.advance(FLUSH_MS)

    expect(batches).toEqual([])
  })

  it('does not deliver events published after close', () => {
    const { bus, batches, clock } = setup()
    bus.close()
    bus.publish(oscEvent('/a'))
    clock.advance(FLUSH_MS)

    expect(batches).toEqual([])
  })
})
