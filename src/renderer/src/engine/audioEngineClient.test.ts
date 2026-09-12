// The client is the seam between the renderer and the engine: it projects the sample
// clock, keeps the last position of what is playing, and hands events to the runner.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioEngineClient, TICK_MS } from './audioEngineClient'
import { SampleScheduler } from './scheduler'
import type { AudioEngineBridge, AudioEngineEvent, AudioProgress, AudioStartOptions } from '../../../shared/audio'

const START_OPTIONS: AudioStartOptions = {
  startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1,
  volume: 1, pan: 0, fadeInDuration: 0, outputs: null
}

function progress(overrides: Partial<AudioProgress> = {}): AudioProgress {
  return {
    cueId: 'a1',
    runId: 'r1',
    state: 'playing',
    playing: true,
    elapsedMs: 500,
    durationMs: 2000,
    fraction: 0.25,
    runFraction: 0.25,
    loopsCompleted: 0,
    startedAtMs: 100,
    ...overrides
  }
}

interface Fake {
  bridge: AudioEngineBridge
  emit: (events: AudioEngineEvent[]) => void
}

function fakeBridge(overrides: Partial<AudioEngineBridge> = {}): Fake {
  let emit: (events: AudioEngineEvent[]) => void = () => {}
  const bridge = {
    prepare: vi.fn(async () => ({})),
    start: vi.fn(async (cueId: string, startAtMs: number) => ({ cueId, runId: 'r1', state: 'playing', startAtMs })),
    stop: vi.fn(async (at: number) => ({ ok: true, at, applied: true })),
    stopAll: vi.fn(async (at: number) => ({ ok: true, at, applied: true })),
    seek: vi.fn(async (positionMs: number) => ({ ok: true, at: 1, positionMs, state: 'playing' })),
    cancel: vi.fn(async (at: number) => ({ ok: true, at, canceled: 0 })),
    fade: vi.fn(async (at: number) => ({ ok: true, at, applied: true })),
    progress: vi.fn(async () => null),
    panic: vi.fn(async (at: number) => ({ ok: true, at, stoppedVoices: 0 })),
    clock: vi.fn(async () => 5000),
    info: vi.fn(),
    devices: vi.fn(async () => []),
    configure: vi.fn(),
    waveform: vi.fn(),
    onEvents: vi.fn((cb: (events: AudioEngineEvent[]) => void) => {
      emit = cb
      return () => {}
    }),
    pickFile: vi.fn(async () => null),
    ...overrides
  } as unknown as AudioEngineBridge

  // The global test setup owns window.winslab; the engine goes on its `audio` namespace
  // in place.
  window.winslab.audio = bridge

  return { bridge, emit: events => emit(events) }
}

describe('AudioEngineClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('projects the sample clock from the last reading', async () => {
    const { bridge, emit } = fakeBridge()
    const client = new AudioEngineClient()
    void emit

    await client.syncClock()
    expect(client.nowMs()).toBeGreaterThanOrEqual(5000)

    vi.mocked(bridge.clock).mockResolvedValue(9000)
    await client.syncClock()
    expect(client.nowMs()).toBeGreaterThanOrEqual(9000)
  })

  it('hands every event of a batch to its subscribers, in order', () => {
    const { emit } = fakeBridge()
    const client = new AudioEngineClient()

    const seen: string[] = []
    client.onEvent(event => seen.push(event.type))

    emit([
      { type: 'state', at: 1, active: true, cueId: 'a1', runId: 'r1', playing: true, state: 'playing' },
      { type: 'ended', cueId: 'a1', runId: 'r1', at: 2, reason: 'complete', loopsCompleted: 0 }
    ])

    expect(seen).toEqual(['state', 'ended'])
  })

  it('keeps the last position of what it started, refreshed on the tick', async () => {
    const { bridge } = fakeBridge({ progress: vi.fn(async () => progress()) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const off = client.onTick(() => {})

    await client.start('a1', 0, START_OPTIONS)
    await vi.advanceTimersByTimeAsync(30)

    expect(bridge.progress).toHaveBeenCalledWith('a1')
    expect(client.getProgress('a1')).toMatchObject({ elapsedMs: 500, fraction: 0.25 })
    off()
  })

  it('forgets a cue that has ended', async () => {
    const { emit } = fakeBridge({ progress: vi.fn(async () => progress()) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const offTick = client.onTick(() => {})
    const offEvents = client.onEvent(() => {})

    await client.start('a1', 0, START_OPTIONS)
    await vi.advanceTimersByTimeAsync(30)
    expect(client.getProgress('a1')).not.toBeNull()

    // The engine's word is final: a completion drops the cached position.
    emit([{ type: 'ended', cueId: 'a1', runId: 'r1', at: 3, reason: 'complete', loopsCompleted: 0 }])
    await vi.advanceTimersByTimeAsync(30)
    expect(client.getProgress('a1')).toBeNull()
    offTick()
    offEvents()
  })

  it('stops watching a cue that was stopped', async () => {
    const { bridge } = fakeBridge({ progress: vi.fn(async () => progress()) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const off = client.onTick(() => {})

    await client.start('a1', 0, START_OPTIONS)
    await vi.advanceTimersByTimeAsync(30)
    await client.stop('a1', 0)

    vi.mocked(bridge.progress).mockClear()
    await vi.advanceTimersByTimeAsync(60)
    expect(bridge.progress).not.toHaveBeenCalled()
    expect(client.getProgress('a1')).toBeNull()
    off()
  })

  it('passes the file dialog through to the engine', async () => {
    const { bridge } = fakeBridge({ pickFile: vi.fn(async () => '/shows/walk-in.wav') } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()

    await expect(client.pickFile()).resolves.toBe('/shows/walk-in.wav')
    expect(bridge.pickFile).toHaveBeenCalled()
  })

  // The show's phase transitions run on this client's ticks and its clock. Neither may
  // be held hostage by an engine that has stopped answering — a stopped device, a wedged
  // service — or the whole desk freezes with it.

  it('keeps ticking even when the engine never answers the clock', async () => {
    fakeBridge({ clock: vi.fn(() => new Promise<number>(() => {})) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const ticks: number[] = []
    const off = client.onTick(() => ticks.push(client.nowMs()))

    await vi.advanceTimersByTimeAsync(100)

    expect(ticks.length).toBeGreaterThanOrEqual(3)
    off()
  })

  it('does not let a stalled engine clock drag the show’s clock backwards', async () => {
    let perf = 1000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => perf)
    const { bridge } = fakeBridge({ clock: vi.fn(async () => 5000) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()

    await client.syncClock()
    expect(client.nowMs()).toBe(5000)

    // The engine's clock has not moved for 500 ms: the show's has.
    perf = 1500
    await client.syncClock()
    expect(client.nowMs()).toBe(5500)

    // A reading that has caught up is adopted as usual.
    perf = 2000
    vi.mocked(bridge.clock).mockResolvedValue(7000)
    await client.syncClock()
    expect(client.nowMs()).toBe(7000)
    nowSpy.mockRestore()
  })

  it('lets a scheduled cue come due while the engine clock is stalled', async () => {
    let perf = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => perf)
    fakeBridge({ clock: vi.fn(async () => 5000) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const scheduler = new SampleScheduler(() => client.nowMs(), cb => client.onTick(cb))

    await client.syncClock()  // the show starts at 5000 on the engine's clock
    const due = vi.fn()
    scheduler.schedule({ at: 5300, due })

    // One beat 400 ms later, with the engine's clock still stuck at 5000.
    perf = 400
    await vi.advanceTimersByTimeAsync(TICK_MS)

    expect(due).toHaveBeenCalledTimes(1)
    scheduler.dispose()
    nowSpy.mockRestore()
  })

  it('keeps the last known position when the engine cannot answer progress', async () => {
    const { bridge } = fakeBridge({ progress: vi.fn(async () => progress()) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const off = client.onTick(() => {})

    await client.start('a1', 0, START_OPTIONS)
    await vi.advanceTimersByTimeAsync(30)
    expect(client.getProgress('a1')).toMatchObject({ elapsedMs: 500 })

    vi.mocked(bridge.progress).mockRejectedValue(new Error('engine busy'))
    await vi.advanceTimersByTimeAsync(30)
    expect(client.getProgress('a1')).toMatchObject({ elapsedMs: 500 })
    off()
  })
})
