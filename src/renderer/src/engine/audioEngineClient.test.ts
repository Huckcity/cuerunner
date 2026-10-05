// The client is the seam between the renderer and the engine: it projects the sample
// clock, keeps the last position of what is playing, and hands events to the runner.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioEngineClient, TICK_MS, type AudioEngineSessionChange } from './audioEngineClient'
import { SampleScheduler } from './scheduler'
import type {
  AudioClockReading,
  AudioEngineBridge,
  AudioEngineEvent,
  AudioProgress,
  AudioStartOptions
} from '../../../shared/audio'

/** A reading of one session's clock, for the fake bridge. */
function reading(clockMs: number, sessionId = 'session-a'): AudioClockReading {
  return { clockMs, sessionId }
}

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
    clock: vi.fn(async () => reading(5000)),
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

  // The global test setup owns window.cuerunner; the engine goes on its `audio` namespace
  // in place.
  window.cuerunner.audio = bridge

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

    vi.mocked(bridge.clock).mockResolvedValue(reading(9000))
    await client.syncClock()
    expect(client.nowMs()).toBeGreaterThanOrEqual(9000)
  })

  it('hands every event of a batch to its subscribers, in order', () => {
    const { emit } = fakeBridge()
    const client = new AudioEngineClient()

    const seen: string[] = []
    client.onEvent(event => seen.push(event.type))

    emit([
      { type: 'state', at: 1, active: true, cueId: 'a1', runId: 'r1', playing: true, state: 'playing', sessionId: 'session-a' },
      { type: 'ended', cueId: 'a1', runId: 'r1', at: 2, reason: 'complete', loopsCompleted: 0, sessionId: 'session-a' }
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
    emit([{ type: 'ended', cueId: 'a1', runId: 'r1', at: 3, reason: 'complete', loopsCompleted: 0, sessionId: 'session-a' }])
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
    fakeBridge({ clock: vi.fn(() => new Promise<AudioClockReading>(() => {})) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const ticks: number[] = []
    const off = client.onTick(() => ticks.push(client.nowMs()))

    await vi.advanceTimersByTimeAsync(100)

    expect(ticks.length).toBeGreaterThanOrEqual(3)
    off()
  })

  it('counts on the window’s own clock while no engine has ever answered', async () => {
    let perf = 10_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => perf)
    fakeBridge({ clock: vi.fn(() => Promise.reject(new Error('audio engine executable is missing'))) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()

    // It starts at zero when it is first asked, and then it moves: a two-second wait
    // scheduled now is over two seconds from now, engine or no engine.
    expect(client.nowMs()).toBe(0)
    perf = 12_000
    expect(client.nowMs()).toBe(2000)

    const scheduler = new SampleScheduler(() => client.nowMs(), cb => client.onTick(cb))
    const done = vi.fn()
    scheduler.schedule({ at: client.nowMs() + 2000, due: done })
    perf = 13_999
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(done).not.toHaveBeenCalled()
    perf = 14_000
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(done).toHaveBeenCalledTimes(1)

    scheduler.dispose()
    nowSpy.mockRestore()
  })

  it('hands the show clock to the first engine that answers, without moving it', async () => {
    let perf = 1000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => perf)
    const { bridge } = fakeBridge({ clock: vi.fn(async () => reading(40)) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const changes: AudioEngineSessionChange[] = []
    client.onSessionChange(change => changes.push(change))

    // The window has been counting for three seconds when an engine finally answers, 40 ms
    // into its own life.
    expect(client.nowMs()).toBe(0)
    perf = 4000
    await client.syncClock()

    // Show time carries on from three seconds, not from the engine's forty milliseconds…
    expect(client.nowMs()).toBe(3000)
    perf = 4500
    expect(client.nowMs()).toBe(3500)
    // …it is the first engine, not a replacement, so nothing is announced…
    expect(changes).toEqual([])
    // …and a time the show names reaches the engine on the engine's own clock.
    await client.stop('a1', 0, 3600)
    expect(bridge.stop).toHaveBeenCalledWith('a1', 0, 640)
    nowSpy.mockRestore()
  })

  it('does not let a stalled engine clock drag the show’s clock backwards', async () => {
    let perf = 1000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => perf)
    const { bridge } = fakeBridge({ clock: vi.fn(async () => reading(5000)) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()

    await client.syncClock()
    expect(client.nowMs()).toBe(5000)

    // The engine's clock has not moved for 500 ms: the show's has.
    perf = 1500
    await client.syncClock()
    expect(client.nowMs()).toBe(5500)

    // A reading that has caught up is adopted as usual.
    perf = 2000
    vi.mocked(bridge.clock).mockResolvedValue(reading(7000))
    await client.syncClock()
    expect(client.nowMs()).toBe(7000)
    nowSpy.mockRestore()
  })

  // An engine restart mid-show is the failure this client exists to absorb: the new
  // engine counts from zero, and every time the show is holding has to survive it.

  it('keeps the show clock continuous across an engine restart, and announces it', async () => {
    let perf = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => perf)
    fakeBridge({ clock: vi.fn(async () => reading(5000)) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const changes: AudioEngineSessionChange[] = []
    client.onSessionChange(change => changes.push(change))
    const off = client.onTick(() => {})

    await client.syncClock()
    expect(client.nowMs()).toBe(5000)

    // Ninety minutes in, the engine dies and is respawned after the backoff. The
    // replacement's clock starts near zero — which must not become the show's clock.
    perf = 5_400_000
    vi.mocked(window.cuerunner.audio.clock).mockResolvedValue(reading(40, 'session-b'))
    await vi.advanceTimersByTimeAsync(TICK_MS)

    expect(client.nowMs()).toBe(5_405_000)
    expect(changes).toEqual([
      { previousSessionId: 'session-a', sessionId: 'session-b', showMs: 5_405_000 }
    ])
    expect(client.sessionWarnings()).toEqual([expect.stringContaining('session-b')])

    // And the projection carries on from the new anchor rather than freezing on it.
    perf = 5_400_100
    expect(client.nowMs()).toBe(5_405_100)

    // A second engine, with the epoch already nonzero: continuity must hold again, and
    // the arithmetic must accumulate rather than reset to the raw engine clock.
    perf = 5_400_600
    vi.mocked(window.cuerunner.audio.clock).mockResolvedValue(reading(15, 'session-c'))
    await vi.advanceTimersByTimeAsync(TICK_MS)

    expect(client.nowMs()).toBe(5_405_600)
    expect(changes).toHaveLength(2)
    expect(changes[1]).toEqual({
      previousSessionId: 'session-b', sessionId: 'session-c', showMs: 5_405_600
    })
    expect(client.sessionWarnings()).toHaveLength(2)

    const started = await client.start('a2', 5_406_000, START_OPTIONS)
    expect(window.cuerunner.audio.start).toHaveBeenCalledWith('a2', 415, START_OPTIONS)
    expect(started.startAtMs).toBe(5_406_000)

    off()
    nowSpy.mockRestore()
  })

  it('sends engine time and reports show time for every verb', async () => {
    let perf = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => perf)
    const start = vi.fn(async (cueId: string, whenMs: number) => ({
      cueId, runId: 'r1', state: 'playing' as const, startAtMs: whenMs
    }))
    const stop = vi.fn(async (_cueId: string, _fadeMs: number, whenMs?: number) => ({
      ok: true as const, at: whenMs ?? 0, applied: true
    }))
    const seek = vi.fn(async (_cueId: string, positionMs: number, whenMs?: number) => ({
      ok: true as const, at: whenMs ?? 0, positionMs, state: 'playing' as const
    }))
    const cancel = vi.fn(async (_cueId: string, whenMs?: number) => ({
      ok: true as const, at: whenMs ?? 0, canceled: 1
    }))
    const fade = vi.fn(async (
      _cueId: string, _param: string, _value: number, _durationMs: number, _curve: string, whenMs?: number
    ) => ({ ok: true as const, at: whenMs ?? 0, applied: true }))
    const stopAll = vi.fn(async (_fadeMs: number) => ({ ok: true as const, at: 500, applied: true }))
    const panic = vi.fn(async (_fadeMs: number) => ({ ok: true as const, at: 600, stoppedVoices: 2 }))
    const { bridge, emit } = fakeBridge({
      clock: vi.fn(async () => reading(5000)),
      start, stop, stopAll, seek, cancel, fade, panic,
      progress: vi.fn(async () => progress())
    } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const off = client.onTick(() => {})

    await client.syncClock()
    // The engine is replaced one second into the show; the epoch becomes 5960 ms.
    perf = 1000
    vi.mocked(bridge.clock).mockResolvedValue(reading(40, 'session-b'))
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(client.nowMs()).toBe(6000)

    const started = await client.start('a1', 7000, START_OPTIONS)
    expect(start).toHaveBeenCalledWith('a1', 1040, START_OPTIONS)
    expect(started.startAtMs).toBe(7000)

    const stopped = await client.stop('a1', 0, 7200)
    expect(stop).toHaveBeenCalledWith('a1', 0, 1240)
    expect(stopped.at).toBe(7200)

    const stoppedAll = await client.stopAll(0)
    expect(stopAll).toHaveBeenCalledWith(0)
    expect(stoppedAll.at).toBe(6460)

    const sought = await client.seek('a1', 1500, 7300)
    expect(seek).toHaveBeenCalledWith('a1', 1500, 1340)
    // A position in the file is not a clock time and is passed through untouched.
    expect(sought.positionMs).toBe(1500)
    expect(sought.at).toBe(7300)

    const canceled = await client.cancel('a1', 7400)
    expect(cancel).toHaveBeenCalledWith('a1', 1440)
    expect(canceled.at).toBe(7400)

    const faded = await client.fade('a1', 'volume', 0.5, 100, 'linear', 7500)
    expect(fade).toHaveBeenCalledWith('a1', 'volume', 0.5, 100, 'linear', 1540)
    expect(faded.at).toBe(7500)

    // Inbound: the clock times inside a progress snapshot and inside an event. A fresh
    // start, because stopping and cancelling above deliberately stopped the watching.
    await client.start('a2', 7600, START_OPTIONS)
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(client.getProgress('a2')).toMatchObject({ startedAtMs: 100 + 5960 })

    const events: AudioEngineEvent[] = []
    client.onEvent(event => events.push(event))
    emit([{
      type: 'ended', cueId: 'a2', runId: 'r1', at: 1200, reason: 'complete', loopsCompleted: 0, sessionId: 'session-b'
    }])
    expect(events).toHaveLength(1)
    expect(events[0].at).toBe(1200 + 5960)

    // A line the engine that died had already sent, arriving late because events are
    // batched on the way here: it belongs to the old session's clock, where the epoch
    // was zero, and must not be re-based onto the new one's.
    emit([{
      type: 'ended', cueId: 'a1', runId: 'r1', at: 1300, reason: 'stopped', loopsCompleted: 0, sessionId: 'session-a'
    }])
    expect(events[1].at).toBe(1300)

    const panicked = await client.panic(200)
    expect(panic).toHaveBeenCalledWith(200)
    expect(panicked.at).toBe(6560)

    off()
    nowSpy.mockRestore()
  })

  it('lets a scheduled cue come due while the engine clock is stalled', async () => {
    let perf = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => perf)
    fakeBridge({ clock: vi.fn(async () => reading(5000)) } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const scheduler = new SampleScheduler(() => client.nowMs(), cb => client.onTick(cb))

    await client.syncClock()  // the engine answers, with its clock at 5000
    const due = vi.fn()
    // On the show's clock, which is what a scheduler is given: it was already counting
    // when the engine answered, so it is not the engine's number.
    scheduler.schedule({ at: client.nowMs() + 300, due })

    // One beat 400 ms later, with the engine's clock still stuck at 5000.
    perf = 400
    await vi.advanceTimersByTimeAsync(TICK_MS)

    expect(due).toHaveBeenCalledTimes(1)
    scheduler.dispose()
    nowSpy.mockRestore()
  })

  it('does not let an older run’s end stop the run that replaced it', async () => {
    let perf = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => perf)
    // The engine's run counter starts over with the engine, so the same run id means
    // different runs in different sessions: the session is part of the identity.
    const start = vi.fn(async (cueId: string, whenMs: number) => ({
      cueId, runId: 'run-1', state: 'playing' as const, startAtMs: whenMs
    }))
    const { bridge, emit } = fakeBridge({
      clock: vi.fn(async () => reading(5000)),
      start,
      progress: vi.fn(async () => progress())
    } as unknown as Partial<AudioEngineBridge>)
    const client = new AudioEngineClient()
    const off = client.onTick(() => {})
    const offEvents = client.onEvent(() => {})

    await client.syncClock()
    await client.start('a1', 6000, START_OPTIONS)

    // The engine is replaced, and the cue is fired again on the new one: run-1 again.
    perf = 1000
    vi.mocked(bridge.clock).mockResolvedValue(reading(40, 'session-b'))
    await vi.advanceTimersByTimeAsync(TICK_MS)
    await client.start('a1', 7000, START_OPTIONS)

    // The old session's run-1 ended late — same cue, same run id, a different engine.
    emit([{
      type: 'ended', cueId: 'a1', runId: 'run-1', at: 10, reason: 'replaced', loopsCompleted: 0, sessionId: 'session-a'
    }])
    vi.mocked(bridge.progress).mockClear()
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(bridge.progress).toHaveBeenCalledWith('a1')

    // The replacement's own run ending is what stops the polling.
    emit([{
      type: 'ended', cueId: 'a1', runId: 'run-1', at: 20, reason: 'complete', loopsCompleted: 0, sessionId: 'session-b'
    }])
    vi.mocked(bridge.progress).mockClear()
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(bridge.progress).not.toHaveBeenCalled()

    offEvents()
    off()
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
