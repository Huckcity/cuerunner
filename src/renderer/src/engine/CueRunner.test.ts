import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { CueRunner } from './CueRunner'
import { audioEngine } from './audioEngineClient'
import type { AudioEngineEvent, AudioMetadata } from './audioEngineClient'
import { network } from './networkClient'
import { scriptHost, ScriptCancelledError } from './scriptHost'
import type { ScriptRun } from './scriptHost'
import type { Cue, WaitCue, AudioCue, MidiCue, OscCue, FadeCue, StopCue, NetworkCue, ScriptCue, GroupCue, SceneCue, DevampCue, MscCue } from '../types/cue'
import { useStore } from '../store'
import { defaultShowSettings } from '../types/show'
import { DEFAULT_TRIGGER_GUARD } from '../types/workspace'

vi.mock('./scriptHost', () => ({
  scriptHost: { run: vi.fn(), cancel: vi.fn(), cancelAll: vi.fn() },
  ScriptCancelledError: class ScriptCancelledError extends Error {}
}))

vi.mock('./audioEngineClient')

vi.mock('./networkClient', () => ({
  network: { request: vi.fn(), cancel: vi.fn() }
}))

const scriptHostMock = scriptHost as unknown as {
  run: Mock
  cancel: Mock
  cancelAll: Mock
}

const engine = vi.mocked(audioEngine)
const requestMock = vi.mocked(network.request)

// A verb added to the engine client after this suite's automock was written is a key
// the mock does not carry. Named here, with the shape the real call answers, so a test
// can ask what the runner sent without the mock being the thing under test.
engine.release = vi.fn(() => Promise.resolve({ ok: true, at: 0, applied: true })) as unknown as typeof engine.release

/** Hands an event to every engine-event handler the runner installed. */
function emitEngineEvent(event: AudioEngineEvent): void {
  for (const [handler] of engine.onEvent.mock.calls) handler(event)
}

// Runners left behind by a test still hold scheduled work; disposing them keeps a
// later test's clock from firing an earlier test's cues.
const runners: CueRunner[] = []
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose()
})

// Helpers
function makeWait(overrides: Partial<WaitCue> = {}): WaitCue {
  return {
    id: 'w1', number: '1', name: 'Wait', type: 'wait',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 1000,
    advance: 'none', isArmed: true, notes: '',
    ...overrides
  }
}

function makeAudio(overrides: Partial<AudioCue> = {}): AudioCue {
  return {
    id: 'a1', number: '1', name: 'Audio', type: 'audio',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
    advance: 'none', isArmed: true, notes: '',
    filePath: '/test.mp3', startTime: 0, endTime: null,
    fadeInDuration: 0,
    volume: 1, pan: 0, outputs: null,
    loopCount: 0, playbackRate: 1, trim: 1,
    ...overrides
  }
}

function makeMidi(overrides: Partial<MidiCue> = {}): MidiCue {
  return {
    id: 'm1', number: '1', name: 'MIDI', type: 'midi',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
    advance: 'none', isArmed: true, notes: '',
    portName: '',
    messages: [{ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }],
    ...overrides
  }
}

function makeOsc(overrides: Partial<OscCue> = {}): OscCue {
  return {
    id: 'o1', number: '1', name: 'OSC', type: 'osc',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
    advance: 'none', isArmed: true, notes: '',
    host: '127.0.0.1', port: 53000, address: '/cue/1/start', args: [],
    ...overrides
  }
}

function makeMsc(overrides: Partial<MscCue> = {}): MscCue {
  return {
    id: 's1', number: '1', name: 'Show Control', type: 'msc',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
    advance: 'none', isArmed: true, notes: '',
    command: 'go', format: 'all', deviceId: 127, cueNumber: '12', cueList: '',
    destination: 'desk', portName: '',
    ...overrides
  }
}

function makeNetwork(overrides: Partial<NetworkCue> = {}): NetworkCue {
  return {
    id: 'n1', number: '1', name: 'Network', type: 'network',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
    advance: 'none', isArmed: true, notes: '',
    method: 'GET', url: 'https://example.com', body: '', headers: {}, timeout: 5000,
    ...overrides
  }
}

interface TestSetup {
  runner: CueRunner
  cues: Cue[]
  setRunning: Mock
  setSelected: Mock
  setLastRun: Mock
  appendLog: Mock
  clearAllRunning: Mock
}

function setup(initialCues: Cue[], initialSelectedId?: string, licensed = true): TestSetup {
  const runner = new CueRunner()
  let selected: string | null = initialSelectedId ?? initialCues[0]?.id ?? null
  const setRunning = vi.fn()
  const setSelected = vi.fn((id: string | null) => { selected = id })
  const setLastRun = vi.fn()
  const appendLog = vi.fn()
  const clearAllRunning = vi.fn()

  const cues = initialCues
  runner.init({
    getCues: () => cues,
    getSelected: () => selected,
    setSelected,
    setRunning,
    clearAllRunning,
    syncCueDuration: vi.fn(),
    setLastRun,
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => 'default-midi-port',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD,
    isPro: () => licensed
  })
  runners.push(runner)

  return { runner, cues, setRunning, setSelected, setLastRun, appendLog, clearAllRunning }
}

describe('CueRunner — basic execution', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('fires a wait cue and marks it playing immediately', () => {
    const { runner, setRunning } = setup([makeWait()])
    runner.go()
    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))
  })

  it('marks cue done after duration elapses', () => {
    const { runner, setRunning } = setup([makeWait({ duration: 2000 })])
    runner.go()
    vi.advanceTimersByTime(2000)
    expect(setRunning).toHaveBeenLastCalledWith('w1', null)
  })

  it('sends an audio cue to the engine at the moment it is fired', async () => {
    const cue = makeAudio()
    const { runner } = setup([cue])
    const firedAt = Date.now()
    runner.go()
    // The engine is asked to prepare the cue first; the start goes out once it has answered.
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.start).toHaveBeenCalledWith('a1', firedAt, expect.objectContaining({
      startTime: 0,
      loopCount: 0,
      rate: 1,
      volume: 1,
      pan: 0,
      outputs: null,
      fadeInDuration: 0
    }))
  })

  it('prepares an audio cue whose length is already known before playing it', async () => {
    // The inspector is not the only way into a cue: a saved show can be fired without
    // its Audio tab ever being drawn, and the engine refuses a start it was not prepared
    // for. The prepare has to happen on the way in, not only when the length is unknown.
    const cue = makeAudio({ id: 'a1', duration: 4000 })
    const { runner } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.prepare).toHaveBeenCalledWith('a1', cue.filePath)
    expect(engine.prepare.mock.invocationCallOrder[0])
      .toBeLessThan(engine.start.mock.invocationCallOrder[0])
  })

  it('does not fire a disarmed cue', () => {
    const { runner, setRunning } = setup([makeWait({ isArmed: false })])
    runner.go()
    expect(setRunning).not.toHaveBeenCalled()
  })

  it('advances selection to the next cue on go()', () => {
    const cue1 = makeWait({ id: 'w1', number: '1' })
    const cue2 = makeWait({ id: 'w2', number: '2' })
    const { runner, setSelected } = setup([cue1, cue2])
    runner.go()
    expect(setSelected).toHaveBeenCalledWith('w2')
  })

  it('skips selection past the auto-fired cue when advance is set', () => {
    const cue1 = makeWait({ id: 'w1', advance: 'on-start' })
    const cue2 = makeWait({ id: 'w2' })
    const cue3 = makeWait({ id: 'w3' })
    const { runner, setSelected } = setup([cue1, cue2, cue3])
    runner.go()
    expect(setSelected).toHaveBeenCalledWith('w3')
  })

  it('sets selection to null when advance cue is second-to-last', () => {
    const cue1 = makeWait({ id: 'w1', advance: 'on-end' })
    const cue2 = makeWait({ id: 'w2' })
    const { runner, setSelected } = setup([cue1, cue2])
    runner.go()
    expect(setSelected).toHaveBeenCalledWith(null)
  })

  it('sets selection to null when firing the last cue', () => {
    const { runner, setSelected } = setup([makeWait()])
    runner.go()
    expect(setSelected).toHaveBeenCalledWith(null)
  })

  it('cancels a pre-wait timer before restarting the same cue', () => {
    const cue = makeWait({ id: 'w1', preWait: 500, duration: 1000 })
    const { runner, setRunning } = setup([cue])

    runner.go() // enters pre-wait; selection advances to null
    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'pre-wait' }))

    // With null selection, go() falls back to index 0 (same cue) — cancels and restarts
    runner.go()
    vi.advanceTimersByTime(500)

    const playingCalls = setRunning.mock.calls.filter(c => c[1]?.state === 'playing')
    expect(playingCalls).toHaveLength(1)
  })

})

describe('CueRunner — pre-wait and post-wait', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('delays execution for preWait ms and shows pre-wait state', () => {
    const { runner, setRunning } = setup([makeWait({ preWait: 500 })])
    runner.go()

    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'pre-wait' }))
    expect(setRunning).not.toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))

    vi.advanceTimersByTime(500)
    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))
  })

  it('fires pre-wait then playing then post-wait then done in sequence', () => {
    const { runner, setRunning } = setup([makeWait({ preWait: 200, duration: 500, postWait: 300 })])
    runner.go()

    const states = () => setRunning.mock.calls.map(c => c[1]?.state ?? null)

    expect(states()).toEqual(['pre-wait'])
    vi.advanceTimersByTime(200)
    expect(states()).toEqual(['pre-wait', 'playing'])
    vi.advanceTimersByTime(500)
    expect(states()).toEqual(['pre-wait', 'playing', 'post-wait'])
    vi.advanceTimersByTime(300)
    expect(states()).toEqual(['pre-wait', 'playing', 'post-wait', null])
  })

  it('skips pre-wait state when preWait is 0', () => {
    const { runner, setRunning } = setup([makeWait({ preWait: 0 })])
    runner.go()
    expect(setRunning).not.toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'pre-wait' }))
    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))
  })

  it('keeps the cue start at its absolute time even when the tick arrives late', async () => {
    // The pre-wait ends at 500 on the sample clock. Whatever the ticker did in
    // between, the cue's own times are the ones that were planned.
    const wait = makeWait({ id: 'w1', preWait: 500, duration: 400 })
    const audio = makeAudio({ id: 'a1', number: '2' })
    const { runner } = setup([wait, audio])

    const firedAt = Date.now()
    runner.go()
    runner.goById('a1', firedAt + 500)
    // The command goes out a lookahead before the cue's own time, carrying that time.
    await vi.advanceTimersByTimeAsync(400)

    expect(engine.start).toHaveBeenCalledWith('a1', firedAt + 500, expect.anything())
  })
})

describe('CueRunner — auto-continue and auto-follow', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('auto-continue fires the next cue without waiting for the current to finish', () => {
    const cue1 = makeWait({ id: 'w1', duration: 5000, advance: 'on-start' })
    const cue2 = makeWait({ id: 'w2' })
    const { runner, setRunning } = setup([cue1, cue2])

    runner.go()

    const ids = setRunning.mock.calls.map(c => c[0])
    // both cues should have started, even though w1 hasn't finished
    expect(ids).toContain('w1')
    expect(ids).toContain('w2')
  })

  it('auto-follow fires the next cue after current finishes (+ postWait)', () => {
    const cue1 = makeWait({ id: 'w1', duration: 1000, postWait: 0, advance: 'on-end' })
    const cue2 = makeWait({ id: 'w2', duration: 500 })
    const { runner, setRunning } = setup([cue1, cue2])

    runner.go()
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')

    vi.advanceTimersByTime(1000) // w1 playing done
    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
  })

  it('auto-follow respects postWait before firing next cue', () => {
    const cue1 = makeWait({ id: 'w1', duration: 500, postWait: 1000, advance: 'on-end' })
    const cue2 = makeWait({ id: 'w2' })
    const { runner, setRunning } = setup([cue1, cue2])

    runner.go()
    vi.advanceTimersByTime(500) // w1 playing done, entering post-wait
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')
    vi.advanceTimersByTime(1000) // post-wait done
    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
  })

  it('schedules the next cue at the exact time the first one is due to end', async () => {
    // Both cues are audio, so the whole chain is known at GO: the second start carries
    // the first one's end time, whatever the ticker does in between.
    const first = makeAudio({ id: 'a1', number: '1', duration: 4000, advance: 'on-end' })
    const second = makeAudio({ id: 'a2', number: '2', duration: 1000 })
    const { runner, setRunning } = setup([first, second])

    const firedAt = Date.now()
    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.start).toHaveBeenCalledWith('a1', firedAt, expect.anything())
    // The handover is released a lookahead early, and the second start names the exact
    // end of the first run rather than "now plus a little".
    await vi.advanceTimersByTimeAsync(3900)
    expect(engine.start).toHaveBeenCalledWith('a2', firedAt + 4000, expect.anything())
    await vi.advanceTimersByTimeAsync(100)
    expect(setRunning.mock.calls.map(c => c[0])).toContain('a2')
  })
})

describe('CueRunner — stop and panic', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('stop() cancels a running wait cue before it finishes', () => {
    const { runner, setRunning } = setup([makeWait({ duration: 5000 })])
    runner.go()

    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))
    runner.stop('w1')
    expect(setRunning).toHaveBeenLastCalledWith('w1', null)

    // Timer should be cancelled — no more calls after stop
    const callCount = setRunning.mock.calls.length
    vi.advanceTimersByTime(5000)
    expect(setRunning.mock.calls.length).toBe(callCount)
  })

  it('stop() with no argument silences everything', () => {
    const cue1 = makeWait({ id: 'w1', duration: 5000, advance: 'on-start' })
    const cue2 = makeWait({ id: 'w2', duration: 5000 })
    const { runner } = setup([cue1, cue2])
    runner.go()
    runner.stop()
    expect(engine.stopAll).toHaveBeenCalledWith(0)
  })

  it('panic() fades the engine out rather than cutting it', () => {
    const { runner } = setup([makeWait({ duration: 5000 })])
    runner.go()
    runner.panic()
    expect(engine.panic).toHaveBeenCalledWith(200)
  })

  it('stop() during pre-wait prevents the cue from ever playing', () => {
    const { runner, setRunning } = setup([makeWait({ preWait: 2000, duration: 1000 })])
    runner.go()
    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'pre-wait' }))

    runner.stop('w1')
    vi.advanceTimersByTime(3000)

    const states = setRunning.mock.calls.map(c => c[1]?.state ?? null)
    expect(states).not.toContain('playing')
  })
})

// What a second firing does to a cue that is already running. The guard's window has
// passed in each of these — an operator who waits and presses again is a second press,
// and that is the one the policy is about.
describe('CueRunner — re-firing a running cue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  const starts = (setRunning: Mock, id: string): number =>
    setRunning.mock.calls.filter(c => c[0] === id && c[1]?.state === 'playing').length

  it('leaves a running cue alone when it is fired again', () => {
    const cue = makeWait({ id: 'w1', duration: 5000 })
    const { runner, setRunning } = setup([cue])

    runner.go()
    runner.resetGuards()
    runner.go()

    expect(starts(setRunning, 'w1')).toBe(1)
  })

  it('restarts a running cue that was told it may be restarted', () => {
    // The cue that is itself the repeat — a stinger, a hold chord — asks for the old
    // behaviour, which is the whole reason the policy is a setting rather than a rule.
    const cue = makeWait({ id: 'w1', duration: 5000, refire: 'restart' })
    const { runner, setRunning } = setup([cue])

    runner.go()
    runner.resetGuards()
    runner.go()

    expect(starts(setRunning, 'w1')).toBe(2)
  })

  it('holds the selection where it is when the press is ignored', () => {
    // An ignored press is not a press: moving the operator's hand on to the next cue
    // would leave them standing somewhere the show is not going.
    const cue1 = makeWait({ id: 'w1', number: '1', duration: 5000 })
    const cue2 = makeWait({ id: 'w2', number: '2' })
    const { runner, setSelected } = setup([cue1, cue2])

    runner.go()
    runner.resetGuards()
    // The selection advanced to w2 on the first GO; press again while w1 still runs by
    // asking for w1 directly, the way a trigger does.
    runner.goById('w1')

    expect(setSelected).toHaveBeenCalledTimes(1)
    expect(setSelected).toHaveBeenLastCalledWith('w2')
  })

  it('ignores a trigger on a running cue without disturbing the cue that is playing', () => {
    const cue = makeWait({ id: 'w1', duration: 5000 })
    const { runner, setRunning } = setup([cue])

    runner.go()
    const before = setRunning.mock.calls.length
    runner.resetGuards()
    runner.goById('w1')

    // Nothing was stopped and nothing was started: the run that was going is the run.
    expect(setRunning.mock.calls.length).toBe(before)
    expect(starts(setRunning, 'w1')).toBe(1)
  })

  it('still fires a cue whose run has ended', () => {
    const cue = makeWait({ id: 'w1', duration: 1000 })
    const { runner, setRunning } = setup([cue])

    runner.go()
    vi.advanceTimersByTime(1000)
    runner.resetGuards()
    runner.goById('w1')

    expect(starts(setRunning, 'w1')).toBe(2)
  })

  it('does not make an advance chain wait for a cue it has never fired', () => {
    // The chain hands over at a sample time, which is the show's own plumbing rather
    // than a press: the interlock must never stand between two cues of one GO.
    const cue1 = makeWait({ id: 'w1', duration: 1000, advance: 'on-end' })
    const cue2 = makeWait({ id: 'w2', duration: 1000 })
    const { runner, setRunning } = setup([cue1, cue2])

    runner.go()
    vi.advanceTimersByTime(1000)

    expect(starts(setRunning, 'w2')).toBe(1)
  })
})

// A cue that is in flight when STOP lands must not resume the show when it settles.
describe('CueRunner — STOP abandons in-flight work', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('stop() during a network request neither advances nor records a run', async () => {
    const request = Promise.withResolvers<Awaited<ReturnType<typeof network.request>>>()
    requestMock.mockReturnValue(request.promise)

    const fired = makeNetwork({ advance: 'on-end' })
    const next = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning, setLastRun } = setup([fired, next])

    runner.go()
    runner.stop()
    request.resolve({ ok: true, status: 200, statusText: 'OK', body: '', error: null })
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).not.toHaveBeenCalled()
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')
  })

  it('stop() takes the in-flight request back from the main process', () => {
    const request = Promise.withResolvers<Awaited<ReturnType<typeof network.request>>>()
    requestMock.mockReturnValue(request.promise)

    const { runner } = setup([makeNetwork({ id: 'n1' })])
    runner.go()
    const requestId = requestMock.mock.calls[0][0].requestId
    expect(requestId).toBeTruthy()

    runner.stop('n1')
    expect(network.cancel).toHaveBeenCalledWith(requestId)
  })

  it('panic() during a network request also abandons it', async () => {
    const request = Promise.withResolvers<Awaited<ReturnType<typeof network.request>>>()
    requestMock.mockReturnValue(request.promise)

    const fired = makeNetwork({ advance: 'on-end' })
    const next = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning } = setup([fired, next])

    runner.go()
    runner.panic()
    request.resolve({ ok: true, status: 200, statusText: 'OK', body: '', error: null })
    await vi.advanceTimersByTimeAsync(0)

    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')
  })

  it('a stopped cue does not start the cue it had already handed over to', () => {
    // The handover is released a lookahead before the end so the next cue's commands
    // reach the engine in time. STOP inside that window must take it back.
    const first = makeAudio({ id: 'a1', number: '1', duration: 4000, advance: 'on-end' })
    const second = makeAudio({ id: 'a2', number: '2', duration: 1000 })
    const { runner, setRunning } = setup([first, second])

    runner.go()
    vi.advanceTimersByTime(3950)   // released, not yet begun
    runner.stop('a1')
    vi.advanceTimersByTime(2000)

    // The start may already have gone out within the lookahead; STOP takes it back.
    expect(engine.cancel).toHaveBeenCalledWith('a2')
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('a2')
  })

  it('fires normally again after a stop', () => {
    const cue = makeWait({ id: 'w1', duration: 500 })
    const { runner, setRunning } = setup([cue])

    runner.go()
    runner.stop()
    runner.go()
    vi.advanceTimersByTime(500)

    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))
  })
})

describe('CueRunner — sample-clock scheduling', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('keeps the intended start times when the clock advances unevenly', async () => {
    // The ticker is not the clock: a late tick must not push a cue's own time.
    const first = makeAudio({ id: 'a1', number: '1', duration: 1000, advance: 'on-end' })
    const second = makeAudio({ id: 'a2', number: '2', duration: 1000 })
    const { runner } = setup([first, second])

    const firedAt = Date.now()
    runner.go()
    // A jump of 37 ms, then a long stretch that swallows several ticks at once.
    await vi.advanceTimersByTimeAsync(37)
    await vi.advanceTimersByTimeAsync(900)
    await vi.advanceTimersByTimeAsync(63)

    expect(engine.start).toHaveBeenNthCalledWith(1, 'a1', firedAt, expect.anything())
    expect(engine.start).toHaveBeenNthCalledWith(2, 'a2', firedAt + 1000, expect.anything())
  })

  it('moves a run’s end when a slow prepare pushes its start past the planned time', async () => {
    const first = makeAudio({ id: 'a1', number: '1', duration: 4000, advance: 'on-end' })
    const second = makeAudio({ id: 'a2', number: '2', duration: 1000 })
    const { runner } = setup([first, second])

    const decode = Promise.withResolvers<AudioMetadata>()
    engine.prepare.mockReturnValueOnce(decode.promise)

    const firedAt = Date.now()
    runner.go()
    // A cold file: the decode outlasts the lookahead, so the engine begins the cue after
    // the time the cue was fired at.
    await vi.advanceTimersByTimeAsync(300)
    decode.resolve({
      cueId: 'a1', filePath: '/shows/a1.wav', format: 'wav', durationMs: 4000,
      sampleRate: 48000, channels: 2, frames: null, fileBytes: 0,
      streaming: false, cacheHit: false, decodedBytes: 0
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.start).toHaveBeenCalledWith('a1', firedAt, expect.anything())
    // The end moved with the lateness, so the cue after it still starts when the first
    // run really ends rather than 300 ms before the sound does.
    await vi.advanceTimersByTimeAsync(4000)
    expect(engine.start).toHaveBeenCalledWith('a2', firedAt + 4300, expect.anything())
  })

  it('closes a run the engine ends before its planned end', async () => {
    // A file that turns out to be shorter than the metadata said: the engine has the
    // last word, and the cue after it starts from where the run really ended.
    const first = makeAudio({ id: 'a1', number: '1', duration: 5000, advance: 'on-end' })
    const second = makeWait({ id: 'w2', number: '2', duration: 100 })
    const { runner, setLastRun } = setup([first, second])

    runner.go()
    await vi.advanceTimersByTimeAsync(1000)
    emitEngineEvent({
      type: 'ended', cueId: 'a1', runId: 'run-a1', at: Date.now(), reason: 'complete', loopsCompleted: 0,
      sessionId: 'test-session'
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('a1', expect.objectContaining({ outcome: 'success' }))
    // Only the first cue was ever sent to the engine, and its run was closed at the
    // moment the engine reported rather than at the plan's 5000 ms.
    expect(engine.start).toHaveBeenCalledTimes(1)
    expect(setLastRun.mock.calls[0][1].durationMs).toBeLessThan(5000)
  })

  it('re-times a finite run when the operator changes its rate', async () => {
    const cue = makeAudio({ id: 'a1', duration: 4000, advance: 'on-end' })
    const next = makeAudio({ id: 'a2', duration: 1000 })
    const { runner } = setup([cue, next])

    const firedAt = Date.now()
    runner.go()
    await vi.advanceTimersByTimeAsync(1000)
    // A quarter through the cue the operator doubles the rate: the remaining 3000 ms of
    // playback now take 1500 ms, so the next cue starts at +2500, not +4000.
    runner.setLiveParameter('a1', 'rate', 2)
    await vi.advanceTimersByTimeAsync(1400)

    expect(engine.start).toHaveBeenCalledWith('a2', firedAt + 2500, expect.anything())
  })

  it('drops the playhead without fading the cue in again', async () => {
    const cue = makeAudio({ id: 'a1', duration: 4000, fadeInDuration: 1500 })
    const { runner } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(500)
    runner.seekCue('a1', 2000)

    // The engine moves the position; the renderer does not start the cue again, which
    // is what used to fade it in a second time.
    expect(engine.seek).toHaveBeenCalledWith('a1', 2000)
    expect(engine.start).toHaveBeenCalledTimes(1)
  })

  it('re-applies routing at the position a playing cue had reached', () => {
    const cue = makeAudio({ id: 'a1', duration: 4000, outputs: [{ inputChannel: 0, outputChannel: 2, gain: 0.5 }] })
    const { runner } = setup([cue])

    runner.go()
    vi.advanceTimersByTime(1000)
    engine.getProgress.mockReturnValue({
      cueId: 'a1', runId: 'run-a1', state: 'playing', playing: true,
      elapsedMs: 1000, durationMs: 4000, fraction: 0.25, runFraction: 0.25,
      loopsCompleted: 0, startedAtMs: 0
    })
    runner.setLiveRouting('a1')

    expect(engine.seek).toHaveBeenCalledWith('a1', 1000)
    expect(engine.stop).not.toHaveBeenCalledWith('a1', 0)
  })

  it('a main-process panic clears the window without panicking a second time', () => {
    const { runner, setRunning, clearAllRunning } = setup([makeWait({ duration: 5000, advance: 'on-end' }), makeWait({ id: 'w2' })])

    runner.go()
    engine.panic.mockClear()
    runner.handleExternalPanic()

    expect(engine.panic).not.toHaveBeenCalled()
    expect(clearAllRunning).toHaveBeenCalled()
    const callsAtPanic = setRunning.mock.calls.length
    vi.advanceTimersByTime(10_000)
    expect(setRunning.mock.calls.length).toBe(callsAtPanic)
  })
})

describe('CueRunner — fade cue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  function makeFade(overrides: Partial<FadeCue> = {}): FadeCue {
    return {
      id: 'f1', number: '1', name: 'Fade', type: 'fade',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 2000,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'a1', fadeProperty: 'volume', targetValue: 0,
      curve: 'linear', stopTargetWhenDone: false,
      ...overrides
    }
  }

  it('sends a volume ramp with the target value, duration and time', () => {
    const { runner } = setup([makeFade()])
    const firedAt = Date.now()
    runner.go()
    expect(engine.fade).toHaveBeenCalledWith('a1', 'volume', 0, 2000, 'linear', firedAt)
  })

  it('sends a pan ramp with the target value and duration', () => {
    const { runner } = setup([makeFade({ fadeProperty: 'pan', targetValue: 0.5, duration: 1000 })])
    const firedAt = Date.now()
    runner.go()
    expect(engine.fade).toHaveBeenCalledWith('a1', 'pan', 0.5, 1000, 'linear', firedAt)
  })

  it('stops the target cue after fading when stopTargetWhenDone is true', () => {
    const { runner } = setup([makeFade({ duration: 500, stopTargetWhenDone: true })])
    runner.go()
    vi.advanceTimersByTime(500)
    expect(engine.stop).toHaveBeenCalledWith('a1', 0)
  })

  it('passes the cue curve through to the engine', () => {
    const { runner } = setup([makeFade({ targetValue: 0.25, duration: 750, curve: 'sCurve' })])
    const firedAt = Date.now()
    runner.go()
    expect(engine.fade).toHaveBeenCalledWith('a1', 'volume', 0.25, 750, 'sCurve', firedAt)
  })

  it('starts the ramp at the cue’s own time, after its pre-wait', () => {
    const { runner } = setup([makeFade({ preWait: 300, duration: 500 })])
    const firedAt = Date.now()
    runner.go()
    vi.advanceTimersByTime(300)
    expect(engine.fade).toHaveBeenCalledWith('a1', 'volume', 0, 500, 'linear', firedAt + 300)
  })
})

describe('CueRunner — stop cue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  function makeStop(overrides: Partial<StopCue> = {}): StopCue {
    return {
      id: 's1', number: '1', name: 'Stop', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'all', fadeOut: false, fadeOutDuration: 500, waitForFade: false,
      ...overrides
    }
  }

  it('stop cue targeting "all" silences the engine', () => {
    const { runner } = setup([makeStop()])
    runner.go()
    expect(engine.stopAll).toHaveBeenCalledWith(0)
  })

  it('stop cue with fadeOut passes fadeOutDuration to the engine', () => {
    const { runner } = setup([makeStop({ fadeOut: true, fadeOutDuration: 1500 })])
    runner.go()
    expect(engine.stopAll).toHaveBeenCalledWith(1500)
  })

  it('stop cue targeting a specific cue stops it without fade', () => {
    const { runner } = setup([makeStop({ targetCueId: 'a1', fadeOutDuration: 0 })])
    runner.go()
    expect(engine.stop).toHaveBeenCalledWith('a1', 0)
  })

  it('stop cue targeting a specific cue with fadeOut passes fadeOutDuration', () => {
    const { runner } = setup([makeStop({ targetCueId: 'a1', fadeOut: true, fadeOutDuration: 800 })])
    runner.go()
    expect(engine.stop).toHaveBeenCalledWith('a1', 800)
  })

  it('fires the next cue only after the fade when waitForFade is on', () => {
    const stopCue = makeStop({
      targetCueId: 'a1', fadeOut: true, fadeOutDuration: 1200, waitForFade: true, advance: 'on-end'
    })
    const nextCue = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning } = setup([stopCue, nextCue])

    runner.go()
    vi.advanceTimersByTime(1199)
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')

    vi.advanceTimersByTime(1)
    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
  })

  it('fires the next cue immediately when waitForFade is off', () => {
    const stopCue = makeStop({
      targetCueId: 'a1', fadeOut: true, fadeOutDuration: 1200, waitForFade: false, advance: 'on-end'
    })
    const nextCue = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning } = setup([stopCue, nextCue])

    runner.go()
    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
  })

  it('stop() cancels a pending wait-for-fade timer', () => {
    const stopCue = makeStop({
      targetCueId: 'a1', fadeOut: true, fadeOutDuration: 1200, waitForFade: true, advance: 'on-end'
    })
    const nextCue = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning } = setup([stopCue, nextCue])

    runner.go()
    runner.stop('s1')
    vi.advanceTimersByTime(5000)
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')
  })

  it('takes a wait target away at once, instead of waiting for an engine report', () => {
    const target = makeWait({ id: 'w1', duration: 5000 })
    const stop = makeStop({ id: 's1', number: '2', targetCueId: 'w1' })
    const { runner, setRunning } = setup([target, stop])

    runner.go()
    vi.advanceTimersByTime(100)
    runner.goById('s1')

    expect(setRunning).toHaveBeenCalledWith('w1', null)
    vi.advanceTimersByTime(10000)
    expect(setRunning).toHaveBeenCalledWith('s1', expect.objectContaining({ state: 'post-wait' }))
  })

  it('counts a stopped timeline child down, and settles the group with its last child', () => {
    const group: GroupCue = {
      id: 'g1', number: '1', name: 'Group', type: 'group',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      mode: 'timeline'
    }
    const c1 = makeWait({ id: 'c1', parentId: 'g1', timelineOffset: 0, duration: 5000 })
    const c2 = makeWait({ id: 'c2', parentId: 'g1', timelineOffset: 10000, duration: 1000 })
    const { runner, setRunning } = setup([group, c1, c2])

    runner.go()
    vi.advanceTimersByTime(100)
    runner.stop('c1')
    expect(setRunning).toHaveBeenCalledWith('c1', null)

    // The child still to come runs, and the group settles when it does instead of
    // staying lit over a child that was taken away.
    vi.advanceTimersByTime(20000)
    expect(setRunning.mock.calls.map(c => c[0])).toContain('c2')
    expect(setRunning).toHaveBeenCalledWith('g1', null)
  })

  it('moves a sequence past a stopped child and settles the group at the end of it', () => {
    const group: GroupCue = {
      id: 'g1', number: '1', name: 'Group', type: 'group',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      mode: 'sequence'
    }
    const c1 = makeWait({ id: 'c1', parentId: 'g1', duration: 5000 })
    const c2 = makeWait({ id: 'c2', parentId: 'g1', duration: 1000 })
    const stop = makeStop({ id: 's1', number: '9', targetCueId: 'c1' })
    const { runner, setRunning, setLastRun } = setup([group, c1, c2, stop])

    runner.go()
    vi.advanceTimersByTime(100)
    runner.goById('s1')

    // The step the stopped child held is over: the sequence moves on to c2.
    expect(setRunning).toHaveBeenCalledWith('c1', null)
    expect(setRunning.mock.calls.map(c => c[0])).toContain('c2')

    vi.advanceTimersByTime(5000)
    // c2's end finishes the group rather than leaving it lit, and the child that was
    // taken away is not recorded as having completed.
    expect(setRunning).toHaveBeenCalledWith('g1', null)
    expect(setLastRun).not.toHaveBeenCalledWith('c1', expect.anything())
  })

  it('advances a sequence past an engine-stopped child', () => {
    const group: GroupCue = {
      id: 'g1', number: '1', name: 'Group', type: 'group',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      mode: 'sequence'
    }
    const audio = makeAudio({ id: 'a1', parentId: 'g1' })
    const tail = makeWait({ id: 'w2', parentId: 'g1', duration: 500 })
    const { runner, setRunning } = setup([group, audio, tail])

    runner.go()
    emitEngineEvent({ type: 'ended', cueId: 'a1', runId: 'r1', at: 100, reason: 'stopped', loopsCompleted: 0, sessionId: '' })
    vi.advanceTimersByTime(1000)

    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
  })

  it('drops a replaced run’s late ended line instead of closing the new run', async () => {
    engine.start
      .mockResolvedValueOnce({ cueId: 'a1', runId: 'old-run', state: 'playing', startAtMs: 0 })
      .mockResolvedValueOnce({ cueId: 'a1', runId: 'new-run', state: 'playing', startAtMs: 0 })
    const audio = makeAudio({ id: 'a1', duration: 5000, refire: 'restart' })
    const { runner, setRunning } = setup([audio])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)
    // The second firing replaces the first: the old run's engine identity is captured
    // as superseded, so its late `ended` line must not close the new run.
    runner.goById('a1')
    await vi.advanceTimersByTimeAsync(0)
    emitEngineEvent({ type: 'ended', cueId: 'a1', runId: 'old-run', at: 50, reason: 'complete', loopsCompleted: 0, sessionId: '' })
    // The new run survives a line naming the run it replaced: still playing, never
    // post-wait, never dark.
    expect(setRunning).toHaveBeenLastCalledWith('a1', expect.objectContaining({ state: 'playing' }))
    expect(setRunning).not.toHaveBeenCalledWith('a1', expect.objectContaining({ state: 'post-wait' }))
  })
})

describe('CueRunner — midi cue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('sends to the default output port when the cue does not name one', () => {
    const cue = makeMidi()
    const { runner } = setup([cue])
    runner.go()
    expect(window.winslab.midi.send).toHaveBeenCalledWith({
      portName: 'default-midi-port',
      messages: cue.messages
    })
  })

  it('lets the cue-specific port override the default', () => {
    const cue = makeMidi({ portName: 'Stage Rack' })
    const { runner } = setup([cue])
    runner.go()
    expect(window.winslab.midi.send).toHaveBeenCalledWith({
      portName: 'Stage Rack',
      messages: cue.messages
    })
  })
})

describe('CueRunner — show control cue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The store carries over between cases in this file, so a case that needs the show's
    // own desk starts from a show that has one.
    useStore.setState({
      midiSettings: { outputPortName: 'default-midi-port' },
      showSettings: defaultShowSettings()
    })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('sends the command as MIDI Show Control on the port the cue names', async () => {
    const cue = makeMsc({ destination: 'port', portName: 'LX Rack' })
    const { runner } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(window.winslab.midi.send).toHaveBeenCalledWith({
      portName: 'LX Rack',
      // Go cue 12, all-call and all-types: the command as a console's own document
      // writes it, framed as the sysex the MIDI layer puts on the wire.
      messages: [{ kind: 'sysex', data: [0x7f, 0x7f, 0x02, 0x7f, 0x01, 0x31, 0x32, 0x00] }]
    })
  })

  it('uses the show’s output port when the cue does not name one', async () => {
    const cue = makeMsc({ destination: 'port' })
    const { runner } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(window.winslab.midi.send).toHaveBeenCalledWith(
      expect.objectContaining({ portName: 'default-midi-port' })
    )
  })

  it('goes out on the show’s desk socket when that is where it is pointed', async () => {
    const desk = { ...defaultShowSettings().desk, kind: 'midi-tcp' as const, host: '10.0.0.5' }
    useStore.setState({ showSettings: { ...defaultShowSettings(), desk } })
    const { runner } = setup([makeMsc()])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(window.winslab.midi.sendTcp).toHaveBeenCalledWith({
      host: '10.0.0.5',
      port: 51325,
      messages: [{ kind: 'sysex', data: [0x7f, 0x7f, 0x02, 0x7f, 0x01, 0x31, 0x32, 0x00] }]
    })
    expect(window.winslab.midi.send).not.toHaveBeenCalled()
  })

  it('reports a cue with nowhere to send it, rather than completing as a success', async () => {
    // The default desk is an OSC connection, and OSC is not a MIDI link: there is no
    // honest way to put a show control message on it.
    const cue = makeMsc({ id: 's1' })
    const { runner, setLastRun, appendLog } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    const expected = 'the show’s desk is driven over OSC, which does not carry MIDI Show Control'
    expect(setLastRun).toHaveBeenCalledWith('s1', expect.objectContaining({ outcome: 'error', error: expected }))
    expect(appendLog).toHaveBeenCalledWith([expect.objectContaining({ level: 'error', message: expected })])
    expect(window.winslab.midi.send).not.toHaveBeenCalled()
    expect(window.winslab.midi.sendTcp).not.toHaveBeenCalled()
  })
})

// A cue that could not do what it says must say so: these paths used to complete as
// successes with nothing sent, played, or answered.
describe('CueRunner — engine failures are reported', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    console.error = vi.fn()
    // Each test starts from engines that did what they were asked. `clearAllMocks`
    // in afterEach keeps implementations, so they are set here.
    vi.mocked(window.winslab.midi.send).mockResolvedValue({ ok: true })
    vi.mocked(window.winslab.osc.send).mockResolvedValue({ ok: true })
    engine.start.mockResolvedValue({ cueId: 'a1', runId: 'run-a1', state: 'playing', startAtMs: 0 })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('reports a MIDI cue that reached no port', async () => {
    vi.mocked(window.winslab.midi.send).mockResolvedValue({
      ok: false,
      error: 'No MIDI output port named "Stage Rack"'
    })
    const cue = makeMidi({ id: 'm1', portName: 'Stage Rack' })
    const { runner, setLastRun, appendLog } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('m1', expect.objectContaining({
      outcome: 'error',
      error: 'No MIDI output port named "Stage Rack"'
    }))
    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({ level: 'error', message: 'No MIDI output port named "Stage Rack"' })
    ])
  })

  it('reports an OSC cue whose send failed', async () => {
    vi.mocked(window.winslab.osc.send).mockResolvedValue({
      ok: false,
      error: 'getaddrinfo ENOTFOUND stage-lights.local'
    })
    const cue = makeOsc({ id: 'o1' })
    const { runner, setLastRun } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('o1', expect.objectContaining({
      outcome: 'error',
      error: 'getaddrinfo ENOTFOUND stage-lights.local'
    }))
  })

  it('reports an audio cue whose file will not play', async () => {
    engine.start.mockRejectedValueOnce(new Error('ENOENT: no such file'))
    const cue = makeAudio({ id: 'a1' })
    const { runner, setLastRun, appendLog } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('a1', expect.objectContaining({
      outcome: 'error',
      error: 'ENOENT: no such file'
    }))
    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({ level: 'error', message: 'ENOENT: no such file' })
    ])
  })

  it('reports a cue the engine could not prepare, and never asks it to play', async () => {
    engine.prepare.mockRejectedValueOnce(new Error('ENOENT: no such file'))
    const cue = makeAudio({ id: 'a1', duration: 4000 })
    const { runner, setLastRun } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.start).not.toHaveBeenCalled()
    expect(setLastRun).toHaveBeenCalledWith('a1', expect.objectContaining({
      outcome: 'error',
      error: 'ENOENT: no such file'
    }))
  })

  it('reports an error the engine raises while the cue plays', async () => {
    const cue = makeAudio({ id: 'a1', duration: 5000 })
    const { runner, setLastRun } = setup([cue])

    runner.go()
    vi.advanceTimersByTime(200)
    emitEngineEvent({
      type: 'error', cueId: 'a1', runId: 'run-a1', at: Date.now(), code: 'engine', message: 'device lost',
      sessionId: 'test-session'
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('a1', expect.objectContaining({
      outcome: 'error',
      error: 'device lost'
    }))
  })

  it('releases the show when the device goes, without waiting for the silence report', () => {
    // The engine panics what it was playing the moment the device goes, but its per-voice
    // `ended` lines only follow once the audio thread has acknowledged that panic — a
    // couple of seconds, on a device that is no longer answering. Until then the rows
    // would read as playing and the next GO on one of them would be refused as a repeat.
    const cue = makeAudio({ id: 'a1', duration: 5000 })
    const { runner, clearAllRunning, appendLog } = setup([cue])

    runner.go()
    vi.advanceTimersByTime(200)
    clearAllRunning.mockClear()

    emitEngineEvent({
      type: 'error', cueId: null, runId: null, at: Date.now(), code: 'device',
      message: 'audio device stopped unexpectedly', sessionId: 'test-session'
    })

    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({ level: 'error', message: 'audio engine: audio device stopped unexpectedly' })
    ])
    expect(clearAllRunning).toHaveBeenCalled()
  })

  it('leaves a running show alone when the fault is not the device', () => {
    // An engine-wide fault the engine did not panic for is reported and nothing more: a
    // wait cue's own time has to survive the engine it was counting against.
    const cue = makeWait({ id: 'w1', duration: 6000 })
    const { runner, clearAllRunning } = setup([cue])

    runner.go()
    clearAllRunning.mockClear()

    emitEngineEvent({
      type: 'error', cueId: null, runId: null, at: Date.now(), code: 'engine',
      message: 'audio engine exited (1)', sessionId: 'test-session'
    })

    expect(clearAllRunning).not.toHaveBeenCalled()
  })

  it('tells the operator when the engine was replaced under the show', () => {
    const { appendLog } = setup([makeWait({ id: 'w1' })])

    // The client keeps the show clock continuous across the restart; the runner's half
    // is the line that explains it, so a gap in the show is never a mystery.
    for (const [handler] of engine.onSessionChange.mock.calls) {
      handler({ previousSessionId: 'session-a', sessionId: 'session-b', showMs: 5_405_000 })
    }

    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({
        level: 'error',
        message: 'audio engine restarted (session session-b); the show clock carried on'
      })
    ])
  })

  it('keeps the run successful when the MIDI send went through', async () => {
    const cue = makeMidi({ id: 'm1' })
    const { runner, setLastRun } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('m1', expect.objectContaining({ outcome: 'success' }))
  })
})

// A scene cue puts the desk where the scene says it should be, at the moment GO reaches
// it — which is the whole point of having it in the stack rather than on a panel.
describe('CueRunner — scene cues', () => {
  function withDesk(sceneId = 's-1'): SceneCue {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        // The show drives a MIDI desk, and the DCA is sent the note somebody gave it
        // rather than the one its number makes.
        desk: { ...defaults.desk, kind: 'midi', midiPort: 'Yamaha', midiChannel: 1 },
        cast: {
          // Ada's strip is what carries the routing now: the DCA is opened by the
          // performer whose channel is assigned to it.
          channels: [{ id: 'ch-1', name: 'Ada', dcaId: 'dca-1' }],
          performers: [{
            id: 'p-1', name: 'Ada', role: 'Lead', notes: '', channelId: 'ch-1'
          }],
          ensembles: [],
          dcas: [{ id: 'dca-1', label: 'DCA 1 — Principals', note: 36, address: null }]
        },
        scenes: {
          list: [{
            id: 's-1', name: 'Wedding', live: ['p-1'], ensembles: [], excluded: [], notes: ''
          }]
        }
      },
      deskState: {},
      deskSceneId: null,
      log: []
    })

    return {
      id: 'sc1', number: '12', name: 'Wedding Scene', type: 'scene',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      sceneId
    }
  }

  beforeEach(() => {
    // The bridge mocks are shared with every other case in this file, so their call
    // history has to go before each one.
    vi.clearAllMocks()
    vi.mocked(window.winslab.midi.send).mockResolvedValue({ ok: true })
    vi.mocked(window.winslab.osc.send).mockResolvedValue({ ok: true })
  })

  it('recalls the scene the cue names, and says so under the cue', async () => {
    const { runner, appendLog } = setup([withDesk()])

    runner.go()
    // Wait for the recall to finish rather than for the first message: the log line and
    // the remembered desk state come after the sends.
    await vi.waitFor(() => expect(useStore.getState().log).toHaveLength(1))

    expect(window.winslab.midi.send).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOn', channel: 1, note: 36, velocity: 127 }]
    })
    // The runner says the cue started; the recall says what it did to the desk, under the
    // same label, so the log reads as one story.
    expect(appendLog).toHaveBeenCalledWith([expect.objectContaining({ message: 'started' })])
    expect(useStore.getState().log.map(entry => [entry.label, entry.message])).toEqual([
      ['12 · Wedding Scene', 'Scene "Wedding" — 1 opened']
    ])
    expect(useStore.getState().deskSceneId).toBe('s-1')
  })

  it('refuses a cue pointed at no scene rather than closing every mic', async () => {
    // An unfinished cue must not be read as "mics off": that would be a silent, and very
    // loud, surprise halfway through a number.
    const { runner, appendLog } = setup([withDesk('')])

    runner.go()
    await vi.waitFor(() => expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({ level: 'error', message: 'no scene chosen' })
    ]))

    expect(window.winslab.midi.send).not.toHaveBeenCalled()
    expect(useStore.getState().deskState).toEqual({})
    expect(useStore.getState().deskSceneId).toBeNull()
  })

  it('refuses a scene cue when this machine is not licensed', async () => {
    // The cue stays in the file and the rest of the show carries on: a show written on a
    // licensed machine opens anywhere, and the desk is simply not driven here. A cue that
    // did nothing quietly would be worse than one that says why.
    const { runner, appendLog, setLastRun } = setup([withDesk()], undefined, false)

    runner.go()
    await vi.waitFor(() => expect(setLastRun).toHaveBeenCalled())

    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({ level: 'error', message: 'scene cues need WinsLab Pro' })
    ])
    expect(setLastRun).toHaveBeenCalledWith('sc1', expect.objectContaining({
      outcome: 'error',
      error: 'WinsLab Pro is required'
    }))
    expect(window.winslab.midi.send).not.toHaveBeenCalled()
    expect(useStore.getState().deskSceneId).toBeNull()
  })
})

// A devamp releases a vamping cue: the music leaves its loop and plays out to the end of
// the file. The cue itself is finished the moment it has asked, which is what lets a
// group's next cue start over the tail.
describe('CueRunner — devamp cues', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  function makeDevamp(targetCueId: string, overrides: Partial<DevampCue> = {}): DevampCue {
    return {
      id: 'd1', number: '9', name: 'Devamp', type: 'devamp',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      targetCueId,
      ...overrides
    }
  }

  it('asks the engine to release the cue it names', async () => {
    const vamp = makeAudio({ id: 'a1', loopCount: -1, startTime: 2000, endTime: 3000 })
    const devamp = makeDevamp('a1')
    const { runner, setLastRun } = setup([vamp, devamp])

    runner.goById('d1')
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.release).toHaveBeenCalledWith('a1')
    expect(setLastRun).toHaveBeenCalledWith('d1', expect.objectContaining({ outcome: 'success' }))
  })

  it('reports a cue that was not looping rather than pretending it released one', async () => {
    const straight = makeAudio({ id: 'a1', loopCount: 0 })
    const devamp = makeDevamp('a1')
    const { runner, setLastRun } = setup([straight, devamp])
    engine.release.mockResolvedValueOnce({ ok: true, at: 0, applied: false })

    runner.goById('d1')
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('d1', expect.objectContaining({
      outcome: 'error',
      error: 'that cue was not looping'
    }))
  })

  it('refuses to release anything when it has not been pointed at a cue', async () => {
    // A devamp with no target must not be read as "release everything": which cue is
    // vamping is the operator's decision, not a guess this cue gets to make.
    const { runner, setLastRun } = setup([makeAudio({ id: 'a1', loopCount: -1 }), makeDevamp('')])

    runner.goById('d1')
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.release).not.toHaveBeenCalled()
    expect(setLastRun).toHaveBeenCalledWith('d1', expect.objectContaining({ outcome: 'error' }))
  })

  it('releases a trimmed vamp to where its sound stops, not into the tail', async () => {
    // The engine plays a released voice out to the end of the file; a cue trimmed of its
    // trailing silence has to say where its sound stops, or the show waits through the
    // silence the trim exists to leave out.
    const vamp = makeAudio({
      id: 'a1', loopCount: -1, duration: 20_000, trimSilence: true,
      soundRegion: { startMs: 2000, endMs: 8000, durationMs: 20_000, silent: false }
    })
    const devamp = makeDevamp('a1')
    const { runner, setLastRun } = setup([vamp, devamp])

    runner.goById('d1')
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.release).toHaveBeenCalledWith('a1', undefined, 8000)
    expect(setLastRun).toHaveBeenCalledWith('d1', expect.objectContaining({ outcome: 'success' }))
  })
})

describe('CueRunner — silence trim', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  /** Two seconds of silence, six of sound, twelve of silence, in a twenty-second file. */
  const SOUND = { startMs: 2000, endMs: 8000, durationMs: 20_000, silent: false }

  it('plays the part of the file between the first and last audible samples', async () => {
    const cue = makeAudio({ duration: 20_000, trimSilence: true, soundRegion: SOUND })
    const { runner } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.start).toHaveBeenCalledWith('a1', expect.any(Number), expect.objectContaining({
      startTime: 2000,
      endTime: 8000
    }))
  })

  it('keeps the part of the region the operator set inside the sound', async () => {
    const cue = makeAudio({
      duration: 20_000, trimSilence: true, soundRegion: SOUND, startTime: 3000, endTime: 5000
    })
    const { runner } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.start).toHaveBeenCalledWith('a1', expect.any(Number), expect.objectContaining({
      startTime: 3000,
      endTime: 5000
    }))
  })

  it('applies the trim on a machine with no licence', async () => {
    // The trim is the cue's own behaviour, not the machine's: a show written with it on
    // sounds the same everywhere, and nothing says otherwise in the log.
    const cue = makeAudio({ duration: 20_000, trimSilence: true, soundRegion: SOUND })
    const { runner, appendLog } = setup([cue], undefined, false)

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.start).toHaveBeenCalledWith('a1', expect.any(Number), expect.objectContaining({
      startTime: 2000,
      endTime: 8000
    }))
    const licenceLines = appendLog.mock.calls.flat(2).filter(entry => /licen[cs]e/i.test(entry.message))
    expect(licenceLines).toEqual([])
  })
})

describe('CueRunner — network cues', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    requestMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', body: '', error: null })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the cue’s request through the main process', () => {
    const cue = makeNetwork({
      id: 'n1',
      method: 'POST',
      url: 'https://example.com/api',
      body: '{"key":"value"}',
      headers: { 'Content-Type': 'application/json' },
      timeout: 3000
    })
    const { runner } = setup([cue])
    runner.go()

    expect(requestMock).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://example.com/api',
      headers: { 'Content-Type': 'application/json' },
      body: '{"key":"value"}',
      timeout: 3000,
      requestId: 'n1:1'
    })
  })

  it('defaults the timeout and leaves a GET without a body', () => {
    const cue = makeNetwork({ id: 'n2', timeout: undefined as unknown as number, method: 'GET' })
    const { runner } = setup([cue])
    runner.go()

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      body: undefined,
      timeout: 5000
    }))
  })

  it('waits for the response before advancing', async () => {
    const cue = makeNetwork({ id: 'n3', advance: 'on-end' })
    const cue2 = makeWait({ id: 'w2', number: '4' })
    const { runner, setRunning } = setup([cue, cue2])
    runner.go()

    // Should not fire next cue until the request answers
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')

    await vi.advanceTimersByTimeAsync(0)
    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
  })

  it('logs the failure and still advances when the request rejects', async () => {
    requestMock.mockRejectedValueOnce(new Error('network down'))

    const cue = makeNetwork({ id: 'n4', number: '4', name: 'Failing Network', advance: 'on-end' })
    const cue2 = makeWait({ id: 'w2', number: '5' })
    const { runner, setRunning, setLastRun, appendLog } = setup([cue, cue2])
    runner.go()

    await vi.advanceTimersByTimeAsync(0)

    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
    expect(setLastRun).toHaveBeenCalledWith('n4', expect.objectContaining({
      outcome: 'error',
      error: 'network down'
    }))
    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({ level: 'error', message: 'network down', label: '4 · Failing Network' })
    ])
  })

  it('logs the request line with method, url, and status', async () => {
    const cue = makeNetwork({ id: 'n7', number: '7', name: 'Ping', url: 'https://example.com/ping' })
    const { runner, appendLog } = setup([cue])
    runner.go()

    await vi.advanceTimersByTimeAsync(0)

    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({
        level: 'info',
        message: 'GET https://example.com/ping → 200 OK (0ms)',
        label: '7 · Ping'
      })
    ])
  })

  it('records the response status of a successful run', async () => {
    const cue = makeNetwork({ id: 'n5' })
    const { runner, setLastRun } = setup([cue])
    runner.go()

    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('n5', expect.objectContaining({
      outcome: 'success',
      status: 200,
      durationMs: expect.any(Number)
    }))
  })

  it('records a failed run when the response carries an error status', async () => {
    requestMock.mockResolvedValueOnce({
      ok: true, status: 503, statusText: 'Service Unavailable', body: 'nope', error: null
    })
    const cue = makeNetwork({ id: 'n6' })
    const { runner, setLastRun } = setup([cue])
    runner.go()

    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('n6', expect.objectContaining({
      outcome: 'error',
      status: 503,
      error: 'HTTP 503 Service Unavailable'
    }))
  })

  it('records a transport failure as an error without a status', async () => {
    requestMock.mockResolvedValueOnce({
      ok: false, status: null, statusText: '', body: '', error: 'timed out after 5000ms'
    })
    const cue = makeNetwork({ id: 'n10' })
    const { runner, setLastRun } = setup([cue])
    runner.go()

    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('n10', expect.objectContaining({
      outcome: 'error',
      error: 'timed out after 5000ms'
    }))
  })

  it('reports the response body on the run result', async () => {
    requestMock.mockResolvedValueOnce({
      ok: true, status: 200, statusText: 'OK', body: '{"ok":true}', error: null
    })
    const cue = makeNetwork({ id: 'n8', url: 'https://example.com/body' })
    const { runner, setLastRun } = setup([cue])
    runner.go()

    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('n8', expect.objectContaining({
      outcome: 'success',
      body: '{"ok":true}'
    }))
  })

  it('omits the body field for an empty response', async () => {
    const cue = makeNetwork({ id: 'n10', url: 'https://example.com/empty' })
    const { runner, setLastRun } = setup([cue])
    runner.go()

    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalled()
    expect(setLastRun.mock.calls[0][1]).not.toHaveProperty('body')
  })
})

describe('CueRunner — script cue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    console.error = vi.fn()
    scriptHostMock.run.mockReset()
    scriptHostMock.cancel.mockReset()
    scriptHostMock.cancelAll.mockReset()
    scriptHostMock.run.mockResolvedValue(undefined)
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  function makeScript(overrides: Partial<ScriptCue> = {}): ScriptCue {
    return {
      id: 'sc1', number: '1', name: 'Script', type: 'script',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      language: 'javascript', script: 'console.log(1)', timeout: 60000,
      ...overrides
    }
  }

  function makeStop(overrides: Partial<StopCue> = {}): StopCue {
    return {
      id: 's1', number: '1', name: 'Stop', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'all', fadeOut: false, fadeOutDuration: 0, waitForFade: false,
      ...overrides
    }
  }

  it('holds the cue open until the script settles, then completes it', async () => {
    const script = Promise.withResolvers<void>()
    scriptHostMock.run.mockReturnValue(script.promise)
    const cue = makeScript({ advance: 'on-end' })
    const next = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning, setLastRun } = setup([cue, next])

    runner.go()
    expect(setRunning).toHaveBeenCalledWith('sc1', expect.objectContaining({ state: 'playing' }))

    script.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('sc1', expect.objectContaining({ outcome: 'success' }))
    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
  })

  it('runs the cue script with its timeout and the workspace path', () => {
    const cue = makeScript({ script: 'await shell("hi")', timeout: 1500 })
    const { runner } = setup([cue])

    runner.go()

    expect(scriptHostMock.run).toHaveBeenCalledWith(expect.objectContaining({
      cueId: 'sc1',
      code: 'await shell("hi")',
      timeoutMs: 1500,
      workspacePath: null
    }))
  })

  it('records a failed run and logs the reason when the script fails', async () => {
    scriptHostMock.run.mockRejectedValue(new Error('boom'))
    const cue = makeScript()
    const { runner, setLastRun, appendLog } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).toHaveBeenCalledWith('sc1', expect.objectContaining({
      outcome: 'error',
      error: 'boom'
    }))
    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({ level: 'error', message: 'boom', label: '1 · Script' })
    ])
  })

  it('treats a cancelled script as stopped, not failed', async () => {
    scriptHostMock.run.mockRejectedValue(new ScriptCancelledError())
    const cue = makeScript()
    const { runner, setLastRun, appendLog } = setup([cue])

    runner.go()
    await vi.advanceTimersByTimeAsync(0)

    expect(setLastRun).not.toHaveBeenCalled()
    expect(appendLog.mock.calls.flat().map(e => e.message)).not.toContain('boom')
  })

  it('mirrors script output into the log under the cue label, and caps it', () => {
    scriptHostMock.run.mockImplementation((run: ScriptRun) => {
      for (let i = 0; i < 250; i++) run.onLog('output', `line ${i}`)
      return Promise.resolve()
    })
    const cue = makeScript()
    const { runner, appendLog } = setup([cue])

    runner.go()

    const lines = appendLog.mock.calls.flatMap(([entries]) => entries)
    // 199 script lines then the truncation notice; later lines are dropped.
    expect(lines.filter(e => e.message.startsWith('line '))).toHaveLength(199)
    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({ level: 'output', message: 'line 0', label: '1 · Script' })
    ])
    expect(lines.at(-1)).toEqual(expect.objectContaining({
      level: 'error',
      message: 'output truncated after 200 lines'
    }))
  })

  it('cancels the running script on STOP, PANIC, and a single-cue stop', () => {
    const cue = makeScript()
    const { runner } = setup([cue])

    runner.go()
    runner.stop('sc1')
    expect(scriptHostMock.cancel).toHaveBeenCalledWith('sc1')

    runner.stop()
    expect(scriptHostMock.cancelAll).toHaveBeenCalled()

    scriptHostMock.cancelAll.mockClear()
    runner.panic()
    expect(scriptHostMock.cancelAll).toHaveBeenCalled()
  })

  it('lets a stop cue take a script run away, and releases the cue', () => {
    const run = Promise.withResolvers<void>()
    scriptHostMock.run.mockReturnValue(run.promise)
    const script = makeScript({ id: 'sc1', number: '1' })
    const stop = makeStop({ id: 's1', number: '2', targetCueId: 'sc1' })
    const { runner, setRunning, setLastRun } = setup([script, stop])

    runner.go()
    expect(setRunning).toHaveBeenCalledWith('sc1', expect.objectContaining({ state: 'playing' }))

    // The stop cue is fired on its own: the script it aims at is the running one.
    runner.goById('s1')

    expect(scriptHostMock.cancel).toHaveBeenCalledWith('sc1')
    expect(setRunning).toHaveBeenCalledWith('sc1', null)
    // Cancelled is not failed and not finished: the script records no run result, as with STOP.
    expect(setLastRun).not.toHaveBeenCalledWith('sc1', expect.anything())
  })

  it('lets a stop cue that stops everything take running scripts with it', () => {
    const run = Promise.withResolvers<void>()
    scriptHostMock.run.mockReturnValue(run.promise)
    const script = makeScript({ id: 'sc1' })
    const stop = makeStop({ id: 's1', targetCueId: 'all' })
    const { runner } = setup([script, stop])

    runner.go()
    runner.goById('s1')

    expect(scriptHostMock.cancelAll).toHaveBeenCalled()
  })

  it('leaves a cue of another type to its own run when a stop cue targets it', () => {
    const audio = makeAudio({ id: 'a1' })
    const stop = makeStop({ id: 's1', number: '2', targetCueId: 'a1' })
    const { runner, setRunning } = setup([audio, stop])

    runner.goById('s1')

    expect(engine.stop).toHaveBeenCalledWith('a1', 0)
    // Only scripts are taken away here: the audio cue's row stays lit until the engine
    // reports the run stopped, so the fade that is still sounding keeps its row.
    expect(scriptHostMock.cancel).not.toHaveBeenCalled()
    expect(setRunning).not.toHaveBeenCalledWith('a1', null)
  })
})

describe('CueRunner — panic details', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('fades the engine instead of cutting it, and drops pending cues', () => {
    const cue1 = makeWait({ id: 'w1', duration: 5000, advance: 'on-end' })
    const cue2 = makeWait({ id: 'w2' })
    const { runner, setRunning, clearAllRunning } = setup([cue1, cue2])

    runner.go()
    runner.panic()

    // Exactly one panic, with the fade. A hard stop first would silence every source
    // before the fade could be scheduled.
    expect(vi.mocked(engine.panic).mock.calls).toEqual([[200]])
    expect(engine.stopAll).not.toHaveBeenCalled()
    expect(clearAllRunning).toHaveBeenCalled()

    vi.advanceTimersByTime(10_000)
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')
  })
})

describe('CueRunner — clearGroupStartOffset', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('clears the stored offset for a group', () => {
    const { runner } = setup([])
    runner.seekTimeline('g1', 500)
    expect(runner.getGroupStartOffset('g1')).toBe(500)
    runner.clearGroupStartOffset('g1')
    expect(runner.getGroupStartOffset('g1')).toBe(0)
  })

  it('does nothing for a non-existent group', () => {
    const { runner } = setup([])
    runner.clearGroupStartOffset('nonexistent')
    expect(runner.getGroupStartOffset('nonexistent')).toBe(0)
  })
})

describe('CueRunner — timeline seek skips what already happened', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('does not replay a fire-and-forget child that lies before the seek point', () => {
    const group: GroupCue = {
      id: 'g1', number: '1', name: 'Group', type: 'group',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      mode: 'timeline'
    }
    const oscCue = makeOsc({ id: 'oc1', parentId: 'g1', timelineOffset: 0 })
    const { runner, setRunning } = setup([group, oscCue])

    runner.seekTimeline('g1', 100)
    runner.go()
    vi.advanceTimersByTime(1000)

    expect(setRunning.mock.calls.filter(c => c[0] === 'oc1')).toHaveLength(0)
    expect(window.winslab.osc.send).not.toHaveBeenCalled()
  })
})

describe('CueRunner — stopping a group', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    console.error = vi.fn()
    scriptHostMock.run.mockReset()
    scriptHostMock.cancel.mockReset()
    scriptHostMock.cancelAll.mockReset()
    scriptHostMock.run.mockResolvedValue(undefined)
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  function makeGroup(overrides: Partial<GroupCue> = {}): GroupCue {
    return {
      id: 'g1', number: '1', name: 'Group', type: 'group',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      mode: 'sequence',
      ...overrides
    }
  }

  function makeStop(overrides: Partial<StopCue> = {}): StopCue {
    return {
      id: 's1', number: '9', name: 'Stop', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'g1', fadeOut: false, fadeOutDuration: 0, waitForFade: false,
      ...overrides
    }
  }

  function makeScript(overrides: Partial<ScriptCue> = {}): ScriptCue {
    return {
      id: 'sc1', number: '3', name: 'Script', type: 'script',
      colorLabel: 'none', parentId: 'g1', preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      language: 'javascript', script: 'console.log(1)', timeout: 60000,
      ...overrides
    }
  }

  const fired = (setRunning: Mock): string[] => setRunning.mock.calls
    .filter(c => c[1]?.state === 'playing')
    .map(c => c[0])

  it('takes the children with it and stops the sequence', () => {
    const group = makeGroup()
    const c1 = makeWait({ id: 'c1', parentId: 'g1', duration: 1000 })
    const c2 = makeWait({ id: 'c2', parentId: 'g1', duration: 1000 })
    const { runner, setRunning } = setup([group, c1, c2, makeStop()])

    runner.go()
    vi.advanceTimersByTime(100)
    expect(fired(setRunning)).toContain('c1')

    runner.goById('s1')

    expect(setRunning).toHaveBeenCalledWith('c1', null)
    expect(setRunning).toHaveBeenCalledWith('g1', null)
    expect(engine.stop).toHaveBeenCalledWith('c1', 0)

    // The run is abandoned: the child that was stopped cannot hand over to the next.
    vi.advanceTimersByTime(5000)
    expect(fired(setRunning)).not.toContain('c2')
  })

  it('fades the children it stops when the cue asks for a fade', () => {
    const group = makeGroup()
    const c1 = makeWait({ id: 'c1', parentId: 'g1', duration: 1000 })
    const c2 = makeWait({ id: 'c2', parentId: 'g1', duration: 1000 })
    const { runner } = setup([group, c1, c2, makeStop({ fadeOut: true, fadeOutDuration: 800 })])

    runner.go()
    vi.advanceTimersByTime(100)
    runner.goById('s1')

    expect(engine.stop).toHaveBeenCalledWith('c1', 800)
    expect(engine.stop).toHaveBeenCalledWith('c2', 800)
  })

  it('cancels the scripts under it', () => {
    const run = Promise.withResolvers<void>()
    scriptHostMock.run.mockReturnValue(run.promise)
    const group = makeGroup()
    const script = makeScript()
    const { runner, setRunning, setLastRun } = setup([group, script, makeStop()])

    runner.go()
    expect(scriptHostMock.run).toHaveBeenCalled()

    runner.goById('s1')

    expect(scriptHostMock.cancel).toHaveBeenCalledWith('sc1')
    expect(setRunning).toHaveBeenCalledWith('sc1', null)
    expect(setLastRun).not.toHaveBeenCalledWith('sc1', expect.anything())
  })

  it('reaches a nested group', () => {
    const outer = makeGroup({ id: 'g1' })
    const inner = makeGroup({ id: 'g2', parentId: 'g1' })
    const child = makeWait({ id: 'w1', parentId: 'g2', duration: 1000 })
    const next = makeWait({ id: 'w2', parentId: 'g2', duration: 1000 })
    const { runner, setRunning } = setup([outer, inner, child, next, makeStop()])

    runner.go()
    vi.advanceTimersByTime(100)
    expect(fired(setRunning)).toContain('w1')

    runner.goById('s1')

    expect(setRunning).toHaveBeenCalledWith('w1', null)
    expect(setRunning).toHaveBeenCalledWith('g2', null)
    vi.advanceTimersByTime(5000)
    expect(fired(setRunning)).not.toContain('w2')
  })

  it('takes a running group with it when it stops everything', () => {
    const group = makeGroup()
    const c1 = makeWait({ id: 'c1', parentId: 'g1', duration: 1000 })
    const c2 = makeWait({ id: 'c2', parentId: 'g1', duration: 1000 })
    const { runner, setRunning } = setup([group, c1, c2, makeStop({ targetCueId: 'all' })])

    runner.go()
    vi.advanceTimersByTime(100)
    runner.goById('s1')

    vi.advanceTimersByTime(5000)
    expect(fired(setRunning)).not.toContain('c2')
  })

  it('stop() on a group takes its children with it too', () => {
    const run = Promise.withResolvers<void>()
    scriptHostMock.run.mockReturnValue(run.promise)
    const group = makeGroup()
    const script = makeScript()
    const tail = makeWait({ id: 'c2', parentId: 'g1', duration: 1000 })
    const { runner, setRunning } = setup([group, script, tail])

    runner.go()
    runner.stop('g1')

    expect(scriptHostMock.cancel).toHaveBeenCalledWith('sc1')
    expect(setRunning).toHaveBeenCalledWith('sc1', null)
    expect(setRunning).toHaveBeenCalledWith('g1', null)
    vi.advanceTimersByTime(5000)
    expect(fired(setRunning)).not.toContain('c2')
  })
})

// A playlist group steps one child per GO, and the group holds the show until the pass
// is complete. The interlock that does it — `isMidPlaylist` — only ever runs when the
// pass is unfinished, so a test that lets the whole pass finish never reaches it.
describe('CueRunner — playlist groups', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  function playlist(overrides: Partial<GroupCue> = {}): GroupCue {
    return {
      id: 'g1', number: '1', name: 'Group', type: 'group',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      mode: 'playlist',
      ...overrides
    }
  }

  function makeStop(overrides: Partial<StopCue> = {}): StopCue {
    return {
      id: 's1', number: '9', name: 'Stop', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'all', fadeOut: false, fadeOutDuration: 0, waitForFade: false,
      ...overrides
    }
  }

  const fired = (setRunning: Mock): string[] => setRunning.mock.calls
    .filter(c => c[1]?.state === 'playing')
    .map(c => c[0])

  it('holds the show until the pass is complete, then hands over', () => {
    const group = playlist({ advance: 'on-end' })
    const c1 = makeWait({ id: 'c1', parentId: 'g1', duration: 1000 })
    const c2 = makeWait({ id: 'c2', parentId: 'g1', duration: 1000 })
    const next = makeWait({ id: 'w2', number: '2', duration: 1000 })
    const { runner, setRunning } = setup([group, c1, c2, next])

    runner.go()
    vi.advanceTimersByTime(2000)
    // One step of two: the pass is not over, so the show does not move on.
    expect(fired(setRunning)).not.toContain('w2')

    // The operator's GO again: the selection was held on the group, so this is the
    // second step of the pass.
    runner.go()
    vi.advanceTimersByTime(2000)
    expect(fired(setRunning)).toContain('c2')
    expect(fired(setRunning)).toContain('w2')
  })

  it('holds the pass open when a step is stopped, and resumes where the cursor says', () => {
    const group = playlist({ advance: 'on-end' })
    const c1 = makeWait({ id: 'c1', parentId: 'g1', duration: 5000 })
    const c2 = makeWait({ id: 'c2', parentId: 'g1', duration: 1000 })
    const next = makeWait({ id: 'w2', number: '2', duration: 1000 })
    const stop = makeStop({ targetCueId: 'c1' })
    const { runner, setRunning } = setup([group, c1, c2, next, stop])

    runner.go()
    vi.advanceTimersByTime(100)
    runner.goById('s1')

    // The step was taken away, and a stopped step is not the end of a pass.
    expect(setRunning).toHaveBeenCalledWith('c1', null)
    expect(setRunning).toHaveBeenCalledWith('g1', null)
    vi.advanceTimersByTime(10000)
    expect(fired(setRunning)).not.toContain('w2')

    // The next GO fires the child the cursor was left pointing at, and that step
    // finishes the pass.
    runner.go()
    expect(fired(setRunning)).toContain('c2')
    vi.advanceTimersByTime(2000)
    expect(fired(setRunning)).toContain('w2')
  })
})
