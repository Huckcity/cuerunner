// Taking a show over from another machine. The runner is the thing that puts what was
// playing back on this machine's engine, so what is held here is the firing: the cue
// starts at the position the plan named, it does not sit through its pre-wait again, and
// everything the plan left behind is written down rather than passed over.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { CueEngine } from './CueEngine'
import { audioEngine } from './audioEngineClient'
import { scriptHost } from './scriptHost'
import type { Cue, AudioCue, MidiCue, WaitCue } from '../../../shared/cue'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import type { TakeoverPlan } from '../../../shared/redundancy'

vi.mock('./scriptHost', () => ({
  scriptHost: { run: vi.fn(), cancel: vi.fn(), cancelAll: vi.fn() },
  ScriptCancelledError: class ScriptCancelledError extends Error {}
}))

vi.mock('./audioEngineClient')

vi.mock('./networkClient', () => ({
  network: { request: vi.fn(), cancel: vi.fn() }
}))

const engine = vi.mocked(audioEngine)

const runners: CueEngine[] = []
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose()
})

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
    id: 'a1', number: '1', name: 'Overture', type: 'audio',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 60_000,
    advance: 'none', isArmed: true, notes: '',
    filePath: '/show/overture.wav', startTime: 0, endTime: null,
    fadeInDuration: 2000,
    volume: 1, pan: 0, outputs: null,
    loopCount: 0, playbackRate: 1, trim: 1,
    ...overrides
  }
}

function makeMidi(overrides: Partial<MidiCue> = {}): MidiCue {
  return {
    id: 'm1', number: '2', name: 'Sting', type: 'midi',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
    advance: 'none', isArmed: true, notes: '',
    portName: '', messages: [{ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }],
    ...overrides
  }
}

interface TestSetup {
  runner: CueEngine
  cues: Cue[]
  setRunning: Mock
  setSelected: Mock
  appendLog: Mock
  clearAllRunning: Mock
}

function setup(initialCues: Cue[], selectedId?: string): TestSetup {
  const runner = new CueEngine()
  let selected: string | null = selectedId ?? null
  const setRunning = vi.fn()
  const setSelected = vi.fn((id: string | null) => { selected = id })
  const appendLog = vi.fn()
  const clearAllRunning = vi.fn()

  runner.init({
    getCues: () => initialCues,
    getSelected: () => selected,
    setSelected,
    setRunning,
    clearAllRunning,
    syncCueDuration: vi.fn(),
    setLastRun: vi.fn(),
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => 'default-midi-port',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD
  })
  runners.push(runner)

  return { runner, cues: initialCues, setRunning, setSelected, appendLog, clearAllRunning }
}

function plan(overrides: Partial<TakeoverPlan> = {}): TakeoverPlan {
  return {
    silentMs: 3000,
    adopt: [],
    skipped: [],
    selectedId: null,
    note: 'took the show over 3.0 s after the live machine went quiet',
    ...overrides
  }
}

describe('CueEngine — putting a show back on the engine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })
  afterEach(() => vi.useRealTimers())

  it('starts an adopted cue where the show had reached, not at its beginning', async () => {
    const cue = makeAudio({ startTime: 4000 })
    const { runner } = setup([cue])

    runner.adoptCue('a1', 8000)
    await vi.advanceTimersByTimeAsync(0)

    // The position is the same measure of the file the live machine's engine reported:
    // the region's own start plus how far into the cue the show had got.
    expect(engine.start).toHaveBeenCalledWith('a1', expect.any(Number), expect.objectContaining({
      startTime: 12_000,
      fadeInDuration: 0
    }))
  })

  it('shows the adopted cue as playing from the position it took over at', async () => {
    const { runner, setRunning } = setup([makeAudio()])

    runner.adoptCue('a1', 12_000)
    await vi.advanceTimersByTimeAsync(0)

    // The row is back-dated by the position, so the countdown on screen is the countdown
    // the cue actually has left rather than a fresh one.
    expect(setRunning).toHaveBeenCalledWith('a1', expect.objectContaining({
      state: 'playing',
      startedAt: Date.now() - 12_000
    }))
  })

  it('does not sit through the cue’s pre-wait a second time', async () => {
    // The pre-wait happened on the machine the show came from; waiting it out here would
    // be a silence the audience has already heard.
    const cue = makeAudio({ preWait: 5000 })
    const { runner, setRunning } = setup([cue])

    runner.adoptCue('a1', 1000)
    await vi.advanceTimersByTimeAsync(0)

    expect(setRunning).toHaveBeenCalledWith('a1', expect.objectContaining({ state: 'playing' }))
    expect(engine.start).toHaveBeenCalled()
  })

  it('leaves a disarmed cue alone', async () => {
    const { runner, setRunning } = setup([makeAudio({ isArmed: false })])
    runner.adoptCue('a1', 1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(setRunning).not.toHaveBeenCalled()
  })

  it('puts the running cues back and says what it could not', async () => {
    const cues: Cue[] = [makeAudio({ id: 'a1' }), makeMidi({ id: 'm1' })]
    const { runner, appendLog } = setup(cues)

    const result = runner.adopt(plan({
      adopt: [{ cueId: 'a1', number: '1', name: 'Overture', seekMs: 5000 }],
      skipped: [{ cueId: 'm1', label: '2 · Sting', reason: 'a midi cue that has already gone out cannot be picked up' }]
    }))
    await vi.advanceTimersByTimeAsync(0)

    expect(result).toEqual({ adopted: 1, skipped: 1 })
    expect(engine.start).toHaveBeenCalledTimes(1)
    const messages = appendLog.mock.calls.flatMap(call => call[0] as Array<{ message: string; label?: string }>)
    expect(messages[0].message).toContain('took the show over')
    expect(messages).toContainEqual({
      level: 'error',
      message: 'not picked up: a midi cue that has already gone out cannot be picked up',
      label: '2 · Sting'
    })
  })

  it('stops what this machine was running on its own', async () => {
    // A cue an operator fired on the standby by hand would otherwise play underneath the
    // show the live machine hands over: after a takeover, what is running is the mirror.
    const stray = makeWait({ id: 'w1', duration: 30_000 })
    const overture = makeAudio({ id: 'a1' })
    const { runner, setRunning, appendLog, clearAllRunning } = setup([stray, overture], 'w1')

    runner.go()
    await vi.advanceTimersByTimeAsync(0)
    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))

    runner.adopt(plan({ adopt: [{ cueId: 'a1', number: '1', name: 'Overture', seekMs: 5000 }] }))
    await vi.advanceTimersByTimeAsync(0)

    expect(clearAllRunning).toHaveBeenCalled()
    const messages = appendLog.mock.calls.flatMap(call => call[0] as Array<{ message: string }>)
    expect(messages.map(entry => entry.message)).toContain('stopped what this machine was running on its own (1)')
    expect(engine.start).toHaveBeenCalledTimes(1)
  })

  it('stands the operator where the live machine had them standing', () => {
    const cues: Cue[] = [makeAudio({ id: 'a1' }), makeWait({ id: 'w1' })]
    const { runner, setSelected } = setup(cues)

    runner.adopt(plan({ selectedId: 'w1' }))
    expect(setSelected).toHaveBeenCalledWith('w1')
  })

  it('does not move the operator to a cue this machine does not have', () => {
    const { runner, setSelected } = setup([makeAudio({ id: 'a1' })])
    runner.adopt(plan({ selectedId: 'gone' }))
    expect(setSelected).not.toHaveBeenCalled()
  })

  it('carries the show on from an adopted cue whose cue ends', async () => {
    // An adopted cue is a firing like any other: the cue after it follows when it ends,
    // which is what makes the takeover a hand-over rather than a fragment.
    const first = makeAudio({ id: 'a1', duration: 10_000, advance: 'on-end' })
    const second = makeWait({ id: 'w1', duration: 500 })
    const { runner, setRunning } = setup([first, second], 'a1')

    runner.adopt(plan({ adopt: [{ cueId: 'a1', number: '1', name: 'Overture', seekMs: 6000 }] }))
    await vi.advanceTimersByTimeAsync(0)

    // The adopted cue had four seconds left of ten; the cue after it starts from there.
    await vi.advanceTimersByTimeAsync(4000)
    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))
  })

  it('goes quiet when the show has moved to the other machine', async () => {
    // Standing down is the mirror image of a takeover: the other machine is already
    // playing this cue, so this one stops rather than the pair playing it twice.
    const cue = makeAudio({ id: 'a1' })
    const { runner, setRunning, clearAllRunning } = setup([cue], 'a1')

    runner.go()
    await vi.advanceTimersByTimeAsync(0)
    expect(setRunning).toHaveBeenCalledWith('a1', expect.objectContaining({ state: 'playing' }))

    runner.standDown()
    await vi.advanceTimersByTimeAsync(0)

    expect(clearAllRunning).toHaveBeenCalled()
    // With the fade a panic cuts with, not a hard stop: the machine that took the show
    // over is inside the same cue, and a cut would be a click on top of the two of them.
    expect(engine.stopAll).toHaveBeenCalledWith(200)
    // And nothing advances: the cue the next GO would fire belongs to the other machine.
    await vi.advanceTimersByTimeAsync(cue.duration + 1000)
    expect(setRunning).toHaveBeenCalledTimes(1)
  })

  it('has nothing to do when there is no runner to adopt into', () => {
    const runner = new CueEngine()
    expect(runner.adopt(plan())).toEqual({ adopted: 0, skipped: 0 })
  })
})

// The script host is mocked for the file's other cases; this keeps the import used.
void scriptHost
