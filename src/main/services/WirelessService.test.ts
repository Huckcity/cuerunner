// The wireless poller has to survive a receiver that stops answering — and notice it —
// with no network and no files anywhere: both ports are injected with fakes, and the
// clock is fake so the offline window can be waited out in a millisecond.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { WirelessService, ewDxOrigin, telemetryPorts } from './WirelessService'
import type { EwDxSession } from './WirelessService'
import { ewDxChannelId } from '../ewdx/mapping'
import { createEwDxCredentials } from '../ewdx/credentials'
import type { ServiceContext } from '../bus/ServiceHost'
import { ShowBus } from '../bus/ShowBus'
import {
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  DEMO_PACK_COUNT,
  DEMO_SOURCE_ID,
  defaultRfThresholds,
  defaultShowSettings,
  demoChannelId
} from '../../shared/show'
import type {
  DeviceEvent,
  DeviceState,
  Performer,
  RfPlot,
  RfThresholds,
  ShowAlert,
  ShowSettings,
  TelemetryChannel,
  TelemetryDocument,
  TelemetrySource
} from '../../shared/show'

const BASE = Date.parse('2026-01-01T00:00:00.000Z')

function demoSource(): TelemetrySource {
  return {
    id: DEMO_SOURCE_ID,
    label: 'Demo rack',
    kind: 'demo',
    target: '',
    pollMs: DEFAULT_POLL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS
  }
}

function httpSource(pollMs = DEFAULT_POLL_MS, timeoutMs = DEFAULT_TIMEOUT_MS): TelemetrySource {
  return {
    id: 'shure-rack',
    label: 'Shure rack',
    kind: 'http',
    target: 'http://10.0.0.9/telemetry',
    pollMs,
    timeoutMs
  }
}

function fileSource(pollMs = DEFAULT_POLL_MS): TelemetrySource {
  return {
    id: 'bridge',
    label: 'Bridge file',
    kind: 'file',
    target: '/var/run/rack.json',
    pollMs,
    timeoutMs: DEFAULT_TIMEOUT_MS
  }
}

function channel(id: string, fields: Partial<TelemetryChannel> = {}): TelemetryChannel {
  return { id, ...fields }
}

function document(...channels: TelemetryChannel[]): TelemetryDocument {
  return { channels }
}

/** A fetch stand-in: `fetch`'s real Response has far more on it than a source needs. */
function response(body: unknown, status = 200): { ok: boolean; status: number; json(): Promise<unknown> } {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function settings(
  sources: TelemetrySource[],
  plot: RfPlot = { packs: [] },
  performers: Performer[] = [],
  thresholds: RfThresholds = defaultRfThresholds()
): ShowSettings {
  const defaults = defaultShowSettings()
  return {
    ...defaults,
    oscIn: { enabled: false, port: 53000 },
    midiIn: { enabled: false, portNames: [] },
    rf: { plot, sources, swaps: [], thresholds },
    cast: { ...defaults.cast, performers }
  }
}

function device(bus: ShowBus, channelId: string): DeviceState | undefined {
  return bus.snapshot().devices.find(candidate => candidate.id === `rf:${channelId}`)
}

function messages(bus: ShowBus): string[] {
  return bus.snapshot().alerts.map((alert: ShowAlert) => alert.message)
}

/** Every device event the bus kept for one channel, in the order it saw them. */
function deviceEvents(bus: ShowBus, channelId: string): DeviceEvent[] {
  return bus
    .snapshot()
    .events.filter(
      (event): event is DeviceEvent => event.kind === 'device' && event.device.id === `rf:${channelId}`
    )
}

interface Harness {
  service: WirelessService
  fetchJson: Mock
  readText: Mock
  context: ServiceContext
  setState: Mock
  bus: ShowBus
}

/**
 * `now` pins the bus's own clock by default, so a test of the service never races it.
 * A test that needs the bus to let ordinary readings through — it rate-limits them —
 * passes a live clock instead.
 */
function harness(now: () => number = () => 1000): Harness {
  const fetchJson = vi.fn()
  const readText = vi.fn()
  const service = new WirelessService({ fetchJson, readText })
  const bus = new ShowBus({ now })
  const setState = vi.fn()
  return { service, fetchJson, readText, context: { bus, setState }, setState, bus }
}

/** Lets the injected fakes settle without letting a poll interval fire. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
})
afterEach(() => vi.useRealTimers())

describe('WirelessService', () => {
  it('stops without polling when the show has no telemetry sources', async () => {
    const { service, fetchJson, readText, context, setState, bus } = harness()

    service.start(context, settings([]))

    expect(setState).toHaveBeenCalledWith('stopped', 'no telemetry sources')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchJson).not.toHaveBeenCalled()
    expect(readText).not.toHaveBeenCalled()
    expect(bus.snapshot().devices).toEqual([])
    expect(messages(bus)).toEqual([])
  })

  it('publishes the demo rack without touching the network or the disk', () => {
    const { service, fetchJson, readText, context, setState, bus } = harness()

    service.start(context, settings([demoSource()]))

    expect(setState).toHaveBeenCalledWith('running', 'polling Demo rack')
    // Twelve packs in the plot, eleven in the document: pack 7 never answers.
    expect(bus.snapshot().devices).toHaveLength(DEMO_PACK_COUNT - 1)
    expect(bus.snapshot().events.filter(event => event.kind === 'device')).toHaveLength(
      DEMO_PACK_COUNT - 1
    )
    expect(device(bus, demoChannelId(7))).toBeUndefined()

    const pack1 = device(bus, demoChannelId(1))
    expect(pack1).toMatchObject({
      service: 'rf',
      name: 'Pack 1',
      online: true,
      battery: { charging: false },
      rf: { unit: 'dBm' },
      audio: { muted: false },
      frequency: 470
    })
    expect(pack1?.battery?.percent).toBeLessThanOrEqual(10)
    expect(pack1?.battery?.minutes).toBeGreaterThan(0)
    expect(pack1?.rf?.level).toBeGreaterThanOrEqual(-70)
    expect(pack1?.audio?.level).toBeGreaterThan(0)
    expect(device(bus, demoChannelId(12))?.frequency).toBe(492)

    expect(messages(bus)).toEqual([
      'Pack 1 battery critical — 6% left',
      'Pack 2 battery low — 19% left'
    ])
    expect(fetchJson).not.toHaveBeenCalled()
    expect(readText).not.toHaveBeenCalled()
  })

  it('polls an http source and publishes what its document reports', async () => {
    const { service, fetchJson, context, setState, bus } = harness()
    fetchJson.mockResolvedValue(
      response(
        document(
          channel('ch-1', {
            name: 'Lead',
            batteryPercent: 84,
            batteryMinutes: 120,
            charging: true,
            rfDbm: -61,
            audioLevel: 42,
            muted: false,
            frequencyMhz: 470.1
          })
        )
      )
    )

    service.start(context, settings([httpSource()]))
    await flush()

    expect(fetchJson.mock.calls[0][0]).toBe('http://10.0.0.9/telemetry')
    expect(fetchJson.mock.calls[0][1]).toBeInstanceOf(AbortSignal)
    expect(setState).toHaveBeenCalledWith('running', 'polling Shure rack')
    expect(device(bus, 'ch-1')).toMatchObject({
      id: 'rf:ch-1',
      service: 'rf',
      name: 'Lead',
      online: true,
      lastSeen: BASE,
      battery: { percent: 84, minutes: 120, charging: true },
      rf: { level: -61, unit: 'dBm' },
      audio: { level: 42, muted: false },
      frequency: 470.1
    })
    expect(messages(bus)).toEqual([])
  })

  it('leaves out the readings a channel did not report', async () => {
    const { service, fetchJson, context, bus } = harness()
    fetchJson.mockResolvedValue(
      // Junk where a reading belongs is a reading that was not sent, not a NaN. It is
      // handed over as raw JSON, the way a bridge would really send it.
      response({
        channels: [
          { id: 'bare', name: 'Bare', batteryPercent: 'full', rfDbm: null, audioLevel: Number.NaN }
        ]
      })
    )

    service.start(context, settings([httpSource()]))
    await flush()

    expect(device(bus, 'bare')).toMatchObject({
      id: 'rf:bare',
      service: 'rf',
      name: 'Bare',
      online: true
    })
    expect(device(bus, 'bare')?.battery).toBeUndefined()
    expect(device(bus, 'bare')?.rf).toBeUndefined()
    expect(device(bus, 'bare')?.audio).toBeUndefined()
    expect(device(bus, 'bare')?.frequency).toBeUndefined()
    expect(messages(bus)).toEqual([])
  })

  it('reads a file source, and reports a file it cannot read', async () => {
    const { service, fetchJson, readText, context, setState, bus } = harness()
    readText.mockResolvedValue(
      JSON.stringify(document(channel('ch-1', { name: 'Bridge pack', batteryPercent: 50 })))
    )

    service.start(context, settings([fileSource()]))
    await flush()

    expect(readText).toHaveBeenCalledWith('/var/run/rack.json')
    expect(fetchJson).not.toHaveBeenCalled()
    expect(device(bus, 'ch-1')).toMatchObject({ name: 'Bridge pack', online: true })

    readText.mockRejectedValue(new Error('ENOENT: no such file or directory'))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)

    expect(setState).toHaveBeenCalledWith('degraded', 'Bridge file: ENOENT: no such file or directory')
    expect(messages(bus)).toEqual(['Bridge file: ENOENT: no such file or directory'])
  })

  it('reports an error status as a warning, once per outage', async () => {
    const { service, fetchJson, context, setState, bus } = harness()
    fetchJson.mockResolvedValue(response(null, 503))

    service.start(context, settings([httpSource(500)]))
    await flush()
    await vi.advanceTimersByTimeAsync(1500)

    expect(setState).toHaveBeenCalledWith('degraded', 'Shure rack: HTTP 503')
    expect(messages(bus)).toEqual(['Shure rack: HTTP 503'])
    expect(bus.snapshot().alerts[0]).toMatchObject({ level: 'warning', source: 'rf' })
  })

  it('reports a source that throws', async () => {
    const { service, fetchJson, context, setState, bus } = harness()
    fetchJson.mockRejectedValue(new Error('ECONNREFUSED'))

    service.start(context, settings([httpSource()]))
    await flush()

    expect(setState).toHaveBeenCalledWith('degraded', 'Shure rack: ECONNREFUSED')
    expect(messages(bus)).toEqual(['Shure rack: ECONNREFUSED'])
  })

  it('gives up on a source that does not answer within its timeout', async () => {
    const { service, fetchJson, context, setState, bus } = harness()
    let signal: AbortSignal | undefined
    fetchJson.mockImplementation((_url: string, given: AbortSignal) => {
      signal = given
      const { promise, reject } = Promise.withResolvers()
      given.addEventListener('abort', () => reject(new Error('timed out')))
      return promise
    })

    service.start(context, settings([httpSource(DEFAULT_POLL_MS, 1500)]))
    await flush()
    expect(signal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1500)

    expect(signal?.aborted).toBe(true)
    expect(setState).toHaveBeenCalledWith('degraded', 'Shure rack: timed out')
    expect(messages(bus)).toEqual(['Shure rack: timed out'])
  })

  it('reports a malformed document once, and only until the source answers again', async () => {
    const { service, fetchJson, context, setState, bus } = harness()
    fetchJson.mockResolvedValue(response({ channels: 'not an array' }))

    service.start(context, settings([httpSource(500)]))
    await flush()
    await vi.advanceTimersByTimeAsync(1500)

    expect(setState).toHaveBeenCalledWith('degraded', 'Shure rack: malformed telemetry document')
    expect(messages(bus)).toEqual(['Shure rack: malformed telemetry document'])

    // A good reading ends the outage, and the next bad one is news again.
    fetchJson.mockResolvedValue(response(document(channel('ch-1'))))
    await vi.advanceTimersByTimeAsync(500)
    expect(setState).toHaveBeenLastCalledWith('running', 'polling Shure rack')

    fetchJson.mockResolvedValue(response({ channels: [null] }))
    await vi.advanceTimersByTimeAsync(500)
    expect(messages(bus)).toEqual([
      'Shure rack: malformed telemetry document',
      'Shure rack: malformed telemetry document'
    ])

    // Body that is not JSON at all reads the same way to the operator.
    fetchJson.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      }
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(messages(bus)).toHaveLength(2)
  })

  it('alarms once on the way into a worse battery band, and re-arms on recovery', async () => {
    const { service, fetchJson, context, bus } = harness()
    const at = (percent: number) => document(channel('ch-12', { name: 'Channel 12', batteryPercent: percent }))

    fetchJson.mockResolvedValue(response(at(30)))
    service.start(context, settings([httpSource()]))
    await flush()
    expect(messages(bus)).toEqual([])

    fetchJson.mockResolvedValue(response(at(22)))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(messages(bus)).toEqual(['Channel 12 battery low — 22% left'])

    // Still low two polls later: said once, then quiet.
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS * 2)
    expect(messages(bus)).toHaveLength(1)

    fetchJson.mockResolvedValue(response(at(8)))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(messages(bus)).toEqual([
      'Channel 12 battery low — 22% left',
      'Channel 12 battery critical — 8% left'
    ])
    expect(bus.snapshot().alerts[1]).toMatchObject({ level: 'critical', deviceId: 'rf:ch-12' })

    fetchJson.mockResolvedValue(response(at(90)))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    fetchJson.mockResolvedValue(response(at(20)))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(messages(bus)).toEqual([
      'Channel 12 battery low — 22% left',
      'Channel 12 battery critical — 8% left',
      'Channel 12 battery low — 20% left'
    ])
  })

  it('warns once on the way into low RF, and re-arms on recovery', async () => {
    const { service, fetchJson, context, bus } = harness()
    const at = (level: number) => document(channel('ch-3', { name: 'Channel 3', rfDbm: level }))

    fetchJson.mockResolvedValue(response(at(-60)))
    service.start(context, settings([httpSource()]))
    await flush()
    expect(messages(bus)).toEqual([])

    fetchJson.mockResolvedValue(response(at(-80)))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(messages(bus)).toEqual(['Channel 3 RF low — -80 dBm'])
    expect(bus.snapshot().alerts[0]).toMatchObject({ level: 'warning', source: 'rf' })

    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS * 2)
    expect(messages(bus)).toHaveLength(1)

    fetchJson.mockResolvedValue(response(at(-55)))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    fetchJson.mockResolvedValue(response(at(-76)))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(messages(bus)).toEqual(['Channel 3 RF low — -80 dBm', 'Channel 3 RF low — -76 dBm'])
  })

  it('names the pack and the performer from the plot, and falls back without them', async () => {
    const { service, fetchJson, context, bus } = harness()
    const plot: RfPlot = {
      packs: [
        { id: 'slot-12', label: 'Pack 12', channelId: 'ch-12', performerId: 'perf-1', notes: '' },
        { id: 'slot-13', label: 'Pack 13', channelId: 'ch-13', performerId: null, notes: '' },
        { id: 'slot-14', label: 'Pack 14', channelId: 'ch-14', performerId: 'gone', notes: '' }
      ]
    }
    const performers: Performer[] = [
      { id: 'perf-1', name: 'Aldonza', role: 'lead', notes: '', channelId: null }
    ]
    fetchJson.mockResolvedValue(
      response(
        document(
          channel('ch-12', { name: 'RX 12', batteryPercent: 6 }),
          channel('ch-13', { batteryPercent: 6 }),
          channel('ch-14', { batteryPercent: 6 }),
          channel('ch-15', { batteryPercent: 6 })
        )
      )
    )

    service.start(context, settings([httpSource()], plot, performers))
    await flush()

    expect(messages(bus)).toEqual([
      'Pack 12 (Aldonza) battery critical — 6% left',
      'Pack 13 battery critical — 6% left',
      'Pack 14 battery critical — 6% left',
      'ch-15 battery critical — 6% left'
    ])
  })

  it('ages a channel out to offline and says so once', async () => {
    const { service, fetchJson, context, bus } = harness()
    const reported = response(document(channel('ch-12', { name: 'Channel 12' })))
    const quiet = () =>
      bus.snapshot().alerts.filter(alert => alert.message === 'Channel 12 went quiet')

    fetchJson.mockResolvedValue(reported)
    service.start(context, settings([httpSource()]))
    await flush()
    expect(device(bus, 'ch-12')?.online).toBe(true)

    // The rack stops naming the channel: nothing is wrong, it is simply not there.
    fetchJson.mockResolvedValue(response(document()))
    await vi.advanceTimersByTimeAsync(6000)

    expect(device(bus, 'ch-12')).toMatchObject({ online: false, name: 'Channel 12' })
    // A warning: silence is worth noticing, and a pack off between scenes is not a
    // failure. The battery alarm is the one that stays critical.
    expect(quiet()).toEqual([
      expect.objectContaining({ level: 'warning', source: 'rf', deviceId: 'rf:ch-12' })
    ])

    await vi.advanceTimersByTimeAsync(6000)
    expect(quiet()).toHaveLength(1)

    // On air again, then gone again: the silence alarm has re-armed.
    fetchJson.mockResolvedValue(reported)
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(device(bus, 'ch-12')?.online).toBe(true)

    fetchJson.mockResolvedValue(response(document()))
    await vi.advanceTimersByTimeAsync(6000)
    expect(quiet()).toHaveLength(2)
  })

  it('ages out a pack the plot expects and the rack never reports', async () => {
    const { service, context, bus } = harness()
    const plot: RfPlot = {
      packs: [
        {
          id: 'slot-7',
          label: 'Pack 7',
          channelId: demoChannelId(7),
          performerId: 'perf-7',
          notes: ''
        }
      ]
    }
    const performers: Performer[] = [
      { id: 'perf-7', name: 'Antonia', role: 'supporting', notes: '', channelId: null }
    ]

    service.start(context, settings([demoSource()], plot, performers))
    expect(device(bus, demoChannelId(7))).toBeUndefined()

    await vi.advanceTimersByTimeAsync(6000)

    expect(device(bus, demoChannelId(7))).toMatchObject({
      id: `rf:${demoChannelId(7)}`,
      service: 'rf',
      name: 'Pack 7',
      online: false
    })
    expect(messages(bus)).toContain('Pack 7 (Antonia) went quiet')
  })

  it('leaves a pack with no channel out of it, unpatched rather than offline', async () => {
    const { service, context, bus } = harness()
    const plot: RfPlot = {
      packs: [{ id: 'spare', label: 'Spare pack', channelId: null, performerId: null, notes: '' }]
    }

    service.start(context, settings([demoSource()], plot))
    await vi.advanceTimersByTimeAsync(10_000)

    expect(bus.snapshot().devices.some(candidate => candidate.name === 'Spare pack')).toBe(false)
    expect(messages(bus)).not.toContain('Spare pack went quiet')
  })

  it('lets a dead source\'s channels age out instead of marking them offline at once', async () => {
    const { service, fetchJson, context, bus } = harness()
    fetchJson.mockResolvedValue(response(document(channel('ch-12', { name: 'Channel 12' }))))

    service.start(context, settings([httpSource()]))
    await flush()

    fetchJson.mockRejectedValue(new Error('fetch failed'))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)

    expect(device(bus, 'ch-12')?.online).toBe(true)
    expect(messages(bus)).toEqual(['Shure rack: fetch failed'])

    await vi.advanceTimersByTimeAsync(4000)
    expect(device(bus, 'ch-12')?.online).toBe(false)
    expect(messages(bus)).toEqual(['Shure rack: fetch failed', 'Channel 12 went quiet'])
  })

  it('remembers the lowest battery a pack reached, and when it got there', async () => {
    const { service, fetchJson, context, bus } = harness()
    const at = (percent: number) =>
      response(document(channel('ch-12', { name: 'Channel 12', batteryPercent: percent })))

    fetchJson.mockResolvedValue(at(80))
    service.start(context, settings([httpSource()]))
    await flush()
    // The reading is a poll's; the floor is the night's, and the two live apart.
    expect(device(bus, 'ch-12')?.battery).toEqual({ percent: 80 })
    expect(device(bus, 'ch-12')?.history).toEqual({ lowestPercent: 80, lowestAt: BASE, dropouts: 0 })

    fetchJson.mockResolvedValue(at(40))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(device(bus, 'ch-12')?.history).toEqual({
      lowestPercent: 40,
      lowestAt: BASE + DEFAULT_POLL_MS,
      dropouts: 0
    })

    // A recovered battery does not carry the floor back up, and a reading above it leaves
    // the time of the floor alone rather than restamping it with the latest poll.
    fetchJson.mockResolvedValue(at(95))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    fetchJson.mockResolvedValue(at(60))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(device(bus, 'ch-12')?.battery).toEqual({ percent: 60 })
    expect(device(bus, 'ch-12')?.history).toEqual({
      lowestPercent: 40,
      lowestAt: BASE + DEFAULT_POLL_MS,
      dropouts: 0
    })
  })

  it('has no floor for a channel that reports no battery, and no floor of zero for the first one it does', async () => {
    const { service, fetchJson, context, bus } = harness()
    fetchJson.mockResolvedValue(
      response(document(channel('bare', { name: 'Bare', rfDbm: -60 })))
    )

    service.start(context, settings([httpSource()]))
    await flush()
    expect(device(bus, 'bare')?.battery).toBeUndefined()
    expect(device(bus, 'bare')?.history).toBeUndefined()

    // The first reading is the floor, not a zero the pack never showed.
    fetchJson.mockResolvedValue(
      response(document(channel('bare', { name: 'Bare', batteryPercent: 74 })))
    )
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(device(bus, 'bare')?.battery).toEqual({ percent: 74 })
    expect(device(bus, 'bare')?.history).toEqual({
      lowestPercent: 74,
      lowestAt: BASE + DEFAULT_POLL_MS,
      dropouts: 0
    })
  })

  it('starts a plot-seeded pack with no floor until the rack says what it is', async () => {
    const { service, fetchJson, context, bus } = harness()
    const plot: RfPlot = {
      packs: [{ id: 'slot-12', label: 'Pack 12', channelId: 'ch-12', performerId: null, notes: '' }]
    }

    fetchJson.mockResolvedValue(response(document()))
    service.start(context, settings([httpSource()], plot))
    await flush()

    // Expected by the plot and never heard from: no device is published at all, so
    // nothing can pass off a made-up floor as the pack's.
    expect(device(bus, 'ch-12')).toBeUndefined()

    fetchJson.mockResolvedValue(response(document(channel('ch-12', { batteryPercent: 74 }))))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(device(bus, 'ch-12')?.history).toEqual({
      lowestPercent: 74,
      lowestAt: BASE + DEFAULT_POLL_MS,
      dropouts: 0
    })
  })

  it('counts a dropout for a plot-seeded pack the rack never names, with no floor invented', async () => {
    const { service, fetchJson, context, bus } = harness()
    const plot: RfPlot = {
      packs: [{ id: 'slot-12', label: 'Pack 12', channelId: 'ch-12', performerId: null, notes: '' }]
    }

    fetchJson.mockResolvedValue(response(document()))
    service.start(context, settings([httpSource()], plot))
    await vi.advanceTimersByTimeAsync(6000)

    // Quiet and counted: the dropout is published with no floor beside it, because a
    // reading the rack never sent is not a reading, and the report must not read this
    // pack as uneventful.
    expect(device(bus, 'ch-12')).toMatchObject({ online: false, name: 'Pack 12' })
    expect(device(bus, 'ch-12')?.battery).toBeUndefined()
    expect(device(bus, 'ch-12')?.history).toEqual({ dropouts: 1 })
    expect(messages(bus)).toEqual(['Pack 12 went quiet'])

    // Heard from at last: the floor is that reading rather than anything seeded, and the
    // dropout it arrives with is the one the silence earned.
    fetchJson.mockResolvedValue(
      response(document(channel('ch-12', { name: 'Pack 12', batteryPercent: 55 })))
    )
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(device(bus, 'ch-12')).toMatchObject({ online: true, battery: { percent: 55 } })
    expect(device(bus, 'ch-12')?.history).toEqual({
      lowestPercent: 55,
      lowestAt: BASE + 8000,
      dropouts: 1
    })
  })

  it('counts one dropout per age-out and keeps it when the channel returns', async () => {
    const { service, fetchJson, context, bus } = harness()
    const reported = response(document(channel('ch-12', { name: 'Channel 12', batteryPercent: 70 })))

    fetchJson.mockResolvedValue(reported)
    service.start(context, settings([httpSource()]))
    await flush()
    expect(deviceEvents(bus, 'ch-12').map(event => event.device.history?.dropouts)).toEqual([0])

    // The rack stops naming the channel: the silence is one dropout, said once. The
    // pack publishes no reading now, and the night it had is what the event carries.
    fetchJson.mockResolvedValue(response(document()))
    await vi.advanceTimersByTimeAsync(6000)
    expect(device(bus, 'ch-12')).toMatchObject({ online: false })
    expect(device(bus, 'ch-12')?.battery).toBeUndefined()
    expect(device(bus, 'ch-12')?.history).toEqual({
      lowestPercent: 70,
      lowestAt: BASE,
      dropouts: 1
    })

    // Still gone several sweeps later: the count does not drift with the sweeps.
    await vi.advanceTimersByTimeAsync(6000)
    expect(device(bus, 'ch-12')?.history?.dropouts).toBe(1)

    // Back on air: the count and the floor are the night's, not the last poll's.
    fetchJson.mockResolvedValue(reported)
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(device(bus, 'ch-12')).toMatchObject({
      online: true,
      battery: { percent: 70 },
      history: { lowestPercent: 70, lowestAt: BASE, dropouts: 1 }
    })

    fetchJson.mockResolvedValue(response(document()))
    await vi.advanceTimersByTimeAsync(6000)
    expect(device(bus, 'ch-12')?.history?.dropouts).toBe(2)
    expect(deviceEvents(bus, 'ch-12').map(event => event.device.history?.dropouts)).toEqual([0, 1, 1, 2])
  })

  it('carries the night on every later device event for the channel', async () => {
    // The bus drops ordinary readings that arrive inside its rate limit, so this one
    // runs on a clock that moves with the polls.
    const { service, fetchJson, context, bus } = harness(() => Date.now())
    const at = (percent: number) => response(document(channel('ch-12', { batteryPercent: percent })))

    fetchJson.mockResolvedValue(at(70))
    service.start(context, settings([httpSource()]))
    await flush()

    fetchJson.mockResolvedValue(response(document()))
    await vi.advanceTimersByTimeAsync(6000)
    expect(device(bus, 'ch-12')?.history?.dropouts).toBe(1)

    fetchJson.mockResolvedValue(at(70))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    fetchJson.mockResolvedValue(at(68))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(deviceEvents(bus, 'ch-12').map(event => event.device.history?.dropouts)).toEqual([0, 1, 1, 1])
  })

  it('keeps the floor and the dropout count across a settings change', async () => {
    const { service, fetchJson, context, bus } = harness()
    const at = (percent: number) =>
      response(document(channel('ch-12', { name: 'Channel 12', batteryPercent: percent })))
    const show = settings([httpSource()])

    fetchJson.mockResolvedValue(at(70))
    service.start(context, show)
    await flush()

    fetchJson.mockResolvedValue(at(12))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    expect(device(bus, 'ch-12')?.history).toMatchObject({
      lowestPercent: 12,
      lowestAt: BASE + DEFAULT_POLL_MS
    })

    fetchJson.mockResolvedValue(response(document()))
    await vi.advanceTimersByTimeAsync(6000)
    expect(device(bus, 'ch-12')?.history?.dropouts).toBe(1)

    // A settings change stops and starts every service; the morning's report must not
    // be what this restart costs.
    fetchJson.mockResolvedValue(at(88))
    service.start(context, show)
    await flush()

    expect(device(bus, 'ch-12')).toMatchObject({
      online: true,
      battery: { percent: 88 },
      history: { lowestPercent: 12, lowestAt: BASE + DEFAULT_POLL_MS, dropouts: 1 }
    })
  })

  it('keeps the healthy sources running when one dies', async () => {
    const { service, fetchJson, readText, context, setState, bus } = harness()
    fetchJson.mockRejectedValue(new Error('fetch failed'))
    readText.mockResolvedValue(
      JSON.stringify(document(channel('bridge-1', { name: 'Bridge pack' })))
    )

    service.start(context, settings([httpSource(), fileSource()]))
    await flush()

    expect(setState).toHaveBeenCalledWith('running', 'polling Shure rack, Bridge file')
    expect(setState).toHaveBeenCalledWith('degraded', 'Shure rack: fetch failed')
    expect(messages(bus)).toEqual(['Shure rack: fetch failed'])
    expect(device(bus, 'bridge-1')?.online).toBe(true)

    fetchJson.mockResolvedValue(response(document(channel('shure-1', { name: 'Shure pack' }))))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)

    expect(readText).toHaveBeenCalledTimes(2)
    expect(fetchJson).toHaveBeenCalledTimes(2)
    expect(device(bus, 'shure-1')?.online).toBe(true)
    expect(device(bus, 'bridge-1')?.online).toBe(true)
    expect(setState).toHaveBeenLastCalledWith('running', 'polling Shure rack, Bridge file')
    expect(messages(bus)).toEqual(['Shure rack: fetch failed'])
  })

  it('repolls every source on demand and answers with the channels that came back', async () => {
    const { service, fetchJson, readText, context } = harness()
    fetchJson.mockResolvedValue(response(document(channel('a'), channel('b'))))
    readText.mockResolvedValue(JSON.stringify(document(channel('c'))))

    service.start(context, settings([httpSource(), fileSource()]))
    await flush()
    expect(fetchJson).toHaveBeenCalledTimes(1)

    // A repoll is a pass over every source, now rather than at the next interval.
    expect(await service.command('repoll')).toEqual({ channels: 3 })
    expect(fetchJson).toHaveBeenCalledTimes(2)
    expect(readText).toHaveBeenCalledTimes(2)
  })

  it('throws on an unknown action', () => {
    const { service } = harness()
    expect(() => service.command('reboot')).toThrow('Unknown action "reboot"')
  })

  it('stops the poll timers on stop', async () => {
    const { service, fetchJson, context } = harness()
    fetchJson.mockResolvedValue(response(document(channel('ch-1'))))

    service.start(context, settings([httpSource(500)]))
    await flush()
    expect(fetchJson).toHaveBeenCalledTimes(1)

    service.stop()
    await vi.advanceTimersByTimeAsync(5000)

    expect(fetchJson).toHaveBeenCalledTimes(1)
  })

  it('aborts the request in flight on stop', async () => {
    const { service, fetchJson, context, bus } = harness()
    let signal: AbortSignal | undefined
    fetchJson.mockImplementation((_url: string, given: AbortSignal) => {
      signal = given
      // A receiver that never answers at all: only stop() can end this request.
      return Promise.withResolvers().promise
    })

    service.start(context, settings([httpSource()]))
    expect(signal?.aborted).toBe(false)

    service.stop()

    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(bus.snapshot().devices).toEqual([])
    expect(messages(bus)).toEqual([])
  })
})

// ── EW-DX ────────────────────────────────────────────────────────────────────
//
// A receiver pushes, so the service holds a session per EW-DX source and asks it for the
// channels on each poll. Everything the service does with what comes back is the same
// code every other source goes through; these tests hold the seam, not the alarms again.

function ewDxSource(pollMs = DEFAULT_POLL_MS, timeoutMs = DEFAULT_TIMEOUT_MS): TelemetrySource {
  return { id: 'rack-a', label: 'Rack A', kind: 'ew-dx', target: '10.0.0.40', pollMs, timeoutMs }
}

const RACK_CHANNEL = ewDxChannelId('5364000906', 0)

interface FakeSession extends EwDxSession {
  start: Mock
  stop: Mock
  snapshot: Mock
}

function fakeSession(): FakeSession {
  return { start: vi.fn(), stop: vi.fn(), snapshot: vi.fn().mockResolvedValue([]) }
}

function ewDxHarness(session: FakeSession): Harness & { ewDx: Mock } {
  const ewDx = vi.fn(() => session)
  const service = new WirelessService({ fetchJson: vi.fn(), readText: vi.fn(), ewDx })
  const bus = new ShowBus({ now: () => 1000 })
  const setState = vi.fn()
  return { service, fetchJson: vi.fn(), readText: vi.fn(), context: { bus, setState }, setState, bus, ewDx }
}

// A source that has just been added has no address and no password yet. That is the operator
// part-way through setting it up, not a receiver failing, so it is said in the status and
// never raised as an alarm: an alarm is for something that was asked to be watched.
describe('WirelessService with a device that complains', () => {
  const clip = { text: 'audio clipping' }
  const keys = { text: 'encryption error — no audio', critical: true }

  async function run(...readings: Array<Partial<TelemetryChannel>>): Promise<ReturnType<typeof harness>> {
    const h = harness()
    for (const fields of readings.slice(0, -1)) h.fetchJson.mockResolvedValueOnce(response(document(channel('ch-1', { name: 'Lead', ...fields }))))
    h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', ...readings[readings.length - 1] }))))
    h.service.start(h.context, settings([httpSource()]))
    await flush()
    return h
  }

  const next = async (h: Awaited<ReturnType<typeof run>>, fields: Partial<TelemetryChannel>, ms = DEFAULT_POLL_MS): Promise<void> => {
    h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', ...fields }))))
    await vi.advanceTimersByTimeAsync(ms)
  }

  it('says a complaint once when it appears, critical for a key that does not match, and puts it on the device', async () => {
    const h = await run({ warnings: [keys, clip] })

    expect(h.bus.snapshot().alerts.map(alert => [alert.level, alert.message])).toEqual([
      ['critical', 'Lead encryption error — no audio'],
      ['warning', 'Lead audio clipping']
    ])
    expect(device(h.bus, 'ch-1')?.warnings).toEqual([keys, clip])
    h.service.stop()
  })

  it('does not say it again while it stands, or when the service restarts', async () => {
    const h = await run({ warnings: [keys] })
    await next(h, { warnings: [keys] })
    h.service.stop()
    h.service.start(h.context, settings([httpSource()]))
    await flush()

    expect(messages(h.bus)).toEqual(['Lead encryption error — no audio'])
    h.service.stop()
  })

  it('does not say clipping again each time it comes and goes inside a minute, and says it once a minute has passed', async () => {
    const h = await run({ warnings: [clip] })
    for (const warnings of [[], [clip], [], [clip]]) await next(h, { warnings })
    expect(messages(h.bus)).toEqual(['Lead audio clipping'])

    await next(h, { warnings: [] }, 61_000)
    await next(h, { warnings: [clip] })
    expect(messages(h.bus)).toEqual(['Lead audio clipping', 'Lead audio clipping'])
    h.service.stop()
  })

  it('shows no complaint once the device stops making it', async () => {
    const h = await run({ warnings: [clip] })
    await next(h, {})

    expect(device(h.bus, 'ch-1')).not.toHaveProperty('warnings')
    h.service.stop()
  })
})

describe('WirelessService alarms that stand', () => {
  async function run(...readings: Array<Partial<TelemetryChannel>>): Promise<ReturnType<typeof harness>> {
    const h = harness()
    for (const fields of readings.slice(0, -1)) h.fetchJson.mockResolvedValueOnce(response(document(channel('ch-1', { name: 'Lead', ...fields }))))
    h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', ...readings[readings.length - 1] }))))
    h.service.start(h.context, settings([httpSource()]))
    await flush()
    return h
  }

  it('does not announce a battery that is still critical when the service restarts', async () => {
    const h = await run({ batteryPercent: 6 })
    expect(messages(h.bus)).toEqual(['Lead battery critical — 6% left'])

    // A settings change stops every service it touches and starts it again.
    h.service.stop()
    h.service.start(h.context, settings([httpSource()]))
    await flush()
    h.service.stop()
    h.service.start(h.context, settings([httpSource()]))
    await flush()

    expect(messages(h.bus)).toEqual(['Lead battery critical — 6% left'])
  })

  it('does not announce weak RF again when the service restarts', async () => {
    const h = await run({ rfDbm: -80 })
    h.service.stop()
    h.service.start(h.context, settings([httpSource()]))
    await flush()

    expect(messages(h.bus)).toEqual(['Lead RF low — -80 dBm'])
  })

  it('announces again once the pack has recovered and then got worse', async () => {
    const h = await run({ batteryPercent: 6 })
    h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', batteryPercent: 90 }))))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', batteryPercent: 5 }))))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)

    expect(messages(h.bus)).toEqual(['Lead battery critical — 6% left', 'Lead battery critical — 5% left'])
    h.service.stop()
  })

  it('does not announce a gauge that flickers across the line, only a pack that really recovered', async () => {
    const h = await run({ batteryPercent: 9 })
    // The gauge of a pack on AA cells is noisy: 9, 11, 9, 12, 9 is one pack that is dying.
    for (const percent of [11, 9, 12, 9, 10]) {
      h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', batteryPercent: percent }))))
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    }

    expect(messages(h.bus)).toEqual(['Lead battery critical — 9% left'])
    h.service.stop()
  })

  it('does not announce a signal that hovers on the line, only one that really recovered', async () => {
    const h = await run({ rfDbm: -76 })
    // -74 and -76 either side of the -75 line is the same marginal link, not two events.
    for (const dbm of [-74, -77, -73, -78, -74]) {
      h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', rfDbm: dbm }))))
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    }

    expect(messages(h.bus)).toEqual(['Lead RF low — -76 dBm'])
    h.service.stop()
  })

  it('does not announce a receiver\'s weak-signal verdict again within a minute of the last time', async () => {
    const h = await run({ rfDbm: -60, rfWeak: true })
    // The receiver's own verdict flips as a pack moves; there is no margin to give a boolean,
    // so a pack that flips back and forth is announced once a minute at most.
    for (const weak of [false, true, false, true]) {
      h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', rfDbm: -60, rfWeak: weak }))))
      await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    }
    expect(messages(h.bus)).toEqual(['Lead RF low — -60 dBm'])

    await vi.advanceTimersByTimeAsync(61_000)
    h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', rfDbm: -60, rfWeak: false }))))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)
    h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', rfDbm: -60, rfWeak: true }))))
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS)

    expect(messages(h.bus)).toEqual(['Lead RF low — -60 dBm', 'Lead RF low — -60 dBm'])
    h.service.stop()
  })
})

describe('WirelessService with a source that is not finished', () => {
  it('does not poll, and does not alarm, for a source with no address, and says what it waits for', async () => {
    const { service, fetchJson, context, setState, bus } = harness()

    service.start(context, settings([{ ...httpSource(), target: '' }]))
    await flush()

    expect(fetchJson).not.toHaveBeenCalled()
    expect(messages(bus)).toEqual([])
    expect(setState).toHaveBeenLastCalledWith('running', 'Shure rack: no address')
    service.stop()
  })

  it('says a file source has no file, rather than no address', async () => {
    const { service, context, setState, bus } = harness()

    service.start(context, settings([{ ...fileSource(), target: '   ' }]))
    await flush()

    expect(messages(bus)).toEqual([])
    expect(setState).toHaveBeenLastCalledWith('running', 'Bridge file: no file chosen')
    service.stop()
  })

  it('does not alarm for an EW-DX source that has no password yet, and the status says so', async () => {
    const credentials = createEwDxCredentials({
      filePath: '/nonexistent/ew-dx.json',
      cipher: { available: () => false, encrypt: t => t, decrypt: t => t },
      readFile: () => {
        throw new Error('missing')
      }
    })
    const service = new WirelessService(telemetryPorts(credentials))
    const bus = new ShowBus({ now: () => 1000 })
    const setState = vi.fn()

    service.start({ bus, setState }, settings([ewDxSource()]))
    await flush()

    expect(messages(bus)).toEqual([])
    expect(setState).toHaveBeenLastCalledWith('running', 'Rack A: no password set — add it in Settings › Wireless')
    service.stop()
  })

  it('keeps polling the sources that are finished beside one that is not', async () => {
    const { service, fetchJson, context, setState, bus } = harness()
    fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead' }))))

    service.start(context, settings([httpSource(), { ...fileSource(), target: '' }]))
    await flush()

    expect(device(bus, 'ch-1')).toBeDefined()
    expect(messages(bus)).toEqual([])
    expect(setState).toHaveBeenLastCalledWith('running', 'polling Shure rack; Bridge file: no file chosen')
    service.stop()
  })

  it('still alarms for a source that is finished and failing', async () => {
    const { service, fetchJson, context, bus } = harness()
    fetchJson.mockRejectedValue(new Error('connection refused'))

    service.start(context, settings([httpSource()]))
    await flush()

    expect(messages(bus)).toEqual(['Shure rack: connection refused'])
    service.stop()
  })
})

describe('WirelessService with a source that judges its own signal', () => {
  async function run(fields: Partial<TelemetryChannel>): Promise<ReturnType<typeof harness>> {
    const h = harness()
    h.fetchJson.mockResolvedValue(response(document(channel('ch-1', { name: 'Lead', ...fields }))))
    h.service.start(h.context, settings([httpSource()]))
    await flush()
    return h
  }

  it('does not call a link weak that its receiver says is fine, whatever the number is', async () => {
    const { bus } = await run({ rfDbm: -83, rfWeak: false })

    expect(messages(bus)).toEqual([])
    expect(device(bus, 'ch-1')?.rf).toEqual({ level: -83, unit: 'dBm', weak: false })
  })

  it('calls a link weak that its receiver says is weak, however strong the number looks', async () => {
    const { bus } = await run({ rfDbm: -40, rfWeak: true })

    expect(messages(bus)).toEqual(['Lead RF low — -40 dBm'])
    expect(device(bus, 'ch-1')?.rf?.weak).toBe(true)
  })

  it('uses the show\'s own line for a source that gives only a number', async () => {
    const { bus } = await run({ rfDbm: -83 })

    expect(messages(bus)).toEqual(['Lead RF low — -83 dBm'])
    expect(device(bus, 'ch-1')?.rf).toEqual({ level: -83, unit: 'dBm' })
  })
})

describe('WirelessService with an EW-DX source', () => {
  it('opens a session for the source, asks it for the channels, and publishes them', async () => {
    const session = fakeSession()
    session.snapshot.mockResolvedValue([channel(RACK_CHANNEL, { name: '37', batteryPercent: 76, rfDbm: -83 })])
    const { service, context, bus, ewDx } = ewDxHarness(session)

    service.start(context, settings([ewDxSource(2000, 1500)]))
    await flush()

    expect(ewDx).toHaveBeenCalledWith(expect.objectContaining({ id: 'rack-a', kind: 'ew-dx' }))
    expect(session.start).toHaveBeenCalledTimes(1)
    // The wait for a first connection is the source's own timeout, nothing the service invents.
    expect(session.snapshot).toHaveBeenCalledWith(1500)
    expect(device(bus, RACK_CHANNEL)).toMatchObject({
      name: '37',
      online: true,
      battery: { percent: 76 },
      rf: { level: -83, unit: 'dBm' }
    })
  })

  it('stops the session with the service, and opens a fresh one on a settings change', async () => {
    const first = fakeSession()
    const second = fakeSession()
    const sessions = [first, second]
    const service = new WirelessService({ fetchJson: vi.fn(), readText: vi.fn(), ewDx: () => sessions.shift()! })
    const bus = new ShowBus({ now: () => 1000 })
    const context = { bus, setState: vi.fn() }

    service.start(context, settings([ewDxSource()]))
    await flush()
    service.start(context, settings([ewDxSource()]))
    await flush()
    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(second.start).toHaveBeenCalledTimes(1)
    service.stop()
    expect(second.stop).toHaveBeenCalledTimes(1)
  })

  it('says why once when the receiver cannot be reached, and clears when it can', async () => {
    const session = fakeSession()
    session.snapshot.mockRejectedValue(new Error('connection lost'))
    const { service, context, setState, bus } = ewDxHarness(session)

    service.start(context, settings([ewDxSource(1000)]))
    await flush()
    await vi.advanceTimersByTimeAsync(3000)

    expect(messages(bus).filter(message => message.includes('Rack A'))).toEqual(['Rack A: connection lost'])
    expect(setState).toHaveBeenLastCalledWith('degraded', 'Rack A: connection lost')

    session.snapshot.mockResolvedValue([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(setState).toHaveBeenLastCalledWith('running', 'polling Rack A')
    service.stop()
  })

  it('goes quiet for a pack patched to a channel with nobody linked, which is the alarm that matters', async () => {
    const session = fakeSession() // answers with no channels: the receiver's channel has no transmitter
    const { service, context, bus } = ewDxHarness(session)
    const plot: RfPlot = {
      packs: [{ id: 'p1', label: 'Aldonza', channelId: RACK_CHANNEL, performerId: null, notes: '' }]
    }

    service.start(context, settings([ewDxSource(1000)], plot))
    await flush()
    await vi.advanceTimersByTimeAsync(7000)

    expect(messages(bus)).toContain('Aldonza went quiet')
    service.stop()
  })

  it('reports a service built without EW-DX as unable, rather than silently showing nothing', async () => {
    const service = new WirelessService({ fetchJson: vi.fn(), readText: vi.fn() })
    const bus = new ShowBus({ now: () => 1000 })

    service.start({ bus, setState: vi.fn() }, settings([ewDxSource()]))
    await flush()

    expect(messages(bus)).toContain('Rack A: EW-DX is not available')
    service.stop()
  })
})

describe('telemetryPorts for EW-DX', () => {
  it('says the password is missing when this machine has none for the source', async () => {
    const credentials = createEwDxCredentials({
      filePath: '/nonexistent/ew-dx.json',
      cipher: { available: () => false, encrypt: t => t, decrypt: t => t },
      readFile: () => {
        throw new Error('missing')
      }
    })
    const session = telemetryPorts(credentials).ewDx!(ewDxSource())
    await expect(session.snapshot(0)).rejects.toThrow(/no password set/)
  })

  it('refuses an http address, because the password would cross the network in the clear', async () => {
    const session = telemetryPorts().ewDx!({ ...ewDxSource(), target: 'http://10.0.0.40' })
    await expect(session.snapshot(0)).rejects.toThrow('EW-DX receivers use https')
  })
})

describe('ewDxOrigin', () => {
  it('reads a bare host or address as https and keeps an explicit port', () => {
    expect(ewDxOrigin('192.168.0.194')).toEqual({ origin: 'https://192.168.0.194' })
    expect(ewDxOrigin(' rack-a.local ')).toEqual({ origin: 'https://rack-a.local' })
    expect(ewDxOrigin('https://10.0.0.40:8443/api')).toEqual({ origin: 'https://10.0.0.40:8443' })
  })

  it('refuses what is not an address a receiver can be at', () => {
    expect(ewDxOrigin('')).toEqual({ error: 'no address' })
    expect(ewDxOrigin('http://10.0.0.40')).toEqual({ error: 'EW-DX receivers use https' })
    expect(ewDxOrigin('ftp://10.0.0.40')).toEqual({ error: 'EW-DX receivers use https' })
    expect(ewDxOrigin('https://')).toEqual({ error: 'not a valid address' })
  })
})
