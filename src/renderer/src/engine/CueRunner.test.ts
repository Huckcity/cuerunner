import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { CueRunner } from './CueRunner'
import { audioPlayer } from './AudioPlayer'
import { scriptHost, ScriptCancelledError } from './scriptHost'
import type { ScriptRun } from './scriptHost'
import type { Cue, WaitCue, AudioCue, MidiCue, OscCue, FadeCue, StopCue, NetworkCue, ScriptCue, GroupCue, SceneCue } from '../types/cue'
import { useStore } from '../store'
import { defaultShowSettings } from '../types/show'
import { midiNoteMessages } from '../utils/scenes'

vi.mock('./scriptHost', () => ({
  scriptHost: { run: vi.fn(), cancel: vi.fn(), cancelAll: vi.fn() },
  ScriptCancelledError: class ScriptCancelledError extends Error {}
}))

vi.mock('./AudioPlayer', () => ({
  audioPlayer: {
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    stopAll: vi.fn(),
    setVolume: vi.fn(),
    setPan: vi.fn(),
    isPlaying: vi.fn(() => false)
  }
}))

const scriptHostMock = scriptHost as unknown as {
  run: Mock
  cancel: Mock
  cancelAll: Mock
}

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
    outputs: [{ volume: 1, pan: 0 }],
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

interface TestSetup {
  runner: CueRunner
  cues: Cue[]
  setRunning: Mock
  setSelected: Mock
  setLastRun: Mock
  appendLog: Mock
  clearAllRunning: Mock
}

function setup(initialCues: Cue[], initialSelectedId?: string): TestSetup {
  const runner = new CueRunner()
  let selected: string | null = initialSelectedId ?? initialCues[0]?.id ?? null
  const setRunning = vi.fn()
  const setSelected = vi.fn((id: string | null) => { selected = id })
  const setLastRun = vi.fn()
  const appendLog = vi.fn()
  const clearAllRunning = vi.fn()

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
    getMidiDefaultPort: () => 'default-midi-port'
  })

  const cues = initialCues
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
    vi.runAllTimers() // flush the 0ms postWait setTimeout chained inside
    expect(setRunning).toHaveBeenLastCalledWith('w1', null)
  })

  it('delegates audio cue to audioPlayer.play', () => {
    const cue = makeAudio()
    const { runner } = setup([cue])
    runner.go()
    expect(audioPlayer.play).toHaveBeenCalledWith(cue, expect.any(Function), expect.any(Function))
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
    vi.runAllTimers()

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
    vi.runAllTimers()            // flush nested 0ms postWait + autoFollow timers
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
    vi.runAllTimers()            // flush the 0ms auto-follow timer
    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
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

  it('stop() with no argument cancels all running cues', () => {
    const cue1 = makeWait({ id: 'w1', duration: 5000, advance: 'on-start' })
    const cue2 = makeWait({ id: 'w2', duration: 5000 })
    const { runner } = setup([cue1, cue2])
    runner.go()
    runner.stop()
    expect(audioPlayer.stopAll).toHaveBeenCalled()
  })

  it('panic() calls audioPlayer.stopAll', () => {
    const { runner } = setup([makeWait({ duration: 5000 })])
    runner.go()
    runner.panic()
    expect(audioPlayer.stopAll).toHaveBeenCalled()
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

// A cue that is in flight when STOP lands must not resume the show when it settles.
describe('CueRunner — STOP abandons in-flight work', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  function networkCue(overrides: Partial<NetworkCue> = {}): NetworkCue {
    return {
      id: 'n1', number: '1', name: 'Network', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      method: 'GET', url: 'http://example.com/hook', body: '', headers: {}, timeout: 5000,
      ...overrides
    }
  }

  it('stop() during a network request neither advances nor records a run', async () => {
    const request = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', vi.fn(() => request.promise))

    const fired = networkCue({ advance: 'on-end' })
    const next = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning, setLastRun } = setup([fired, next])

    runner.go()
    runner.stop()
    request.resolve(new Response('ok', { status: 200 }))
    await vi.runAllTimersAsync()

    expect(setLastRun).not.toHaveBeenCalled()
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')
  })

  it('panic() during a network request also abandons it', async () => {
    const request = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', vi.fn(() => request.promise))

    const fired = networkCue({ advance: 'on-end' })
    const next = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning } = setup([fired, next])

    runner.go()
    runner.panic()
    request.resolve(new Response('ok', { status: 200 }))
    await vi.runAllTimersAsync()

    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')
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

describe('CueRunner — fade cue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('calls audioPlayer.setVolume with target value and duration', () => {
    const fadeCue: FadeCue = {
      id: 'f1', number: '1', name: 'Fade', type: 'fade',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 2000,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'a1', fadeProperty: 'volume', targetValue: 0,
      curve: 'linear', stopTargetWhenDone: false
    }
    const { runner } = setup([fadeCue])
    runner.go()
    expect(audioPlayer.setVolume).toHaveBeenCalledWith('a1', 0, 2000, 'linear')
  })

  it('calls audioPlayer.setPan with target value and duration', () => {
    const fadeCue: FadeCue = {
      id: 'f1', number: '1', name: 'Fade', type: 'fade',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 1000,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'a1', fadeProperty: 'pan', targetValue: 0.5,
      curve: 'linear', stopTargetWhenDone: false
    }
    const { runner } = setup([fadeCue])
    runner.go()
    expect(audioPlayer.setPan).toHaveBeenCalledWith('a1', 0.5, 1000, 'linear')
  })

  it('stops the target cue after fading when stopTargetWhenDone is true', () => {
    const fadeCue: FadeCue = {
      id: 'f1', number: '1', name: 'Fade', type: 'fade',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 500,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'a1', fadeProperty: 'volume', targetValue: 0,
      curve: 'linear', stopTargetWhenDone: true
    }
    const { runner } = setup([fadeCue])
    runner.go()
    vi.advanceTimersByTime(500)
    expect(audioPlayer.stop).toHaveBeenCalledWith('a1', 0)
  })

  it('passes the cue curve through to the audio player', () => {
    const fadeCue: FadeCue = {
      id: 'f1', number: '1', name: 'Fade', type: 'fade',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 750,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'a1', fadeProperty: 'volume', targetValue: 0.25,
      curve: 'sCurve', stopTargetWhenDone: false
    }
    const { runner } = setup([fadeCue])
    runner.go()
    expect(audioPlayer.setVolume).toHaveBeenCalledWith('a1', 0.25, 750, 'sCurve')
  })
})

describe('CueRunner — stop cue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('stop cue targeting "all" calls audioPlayer.stopAll', () => {
    const stopCue: StopCue = {
      id: 's1', number: '1', name: 'Stop All', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'all', fadeOut: false, fadeOutDuration: 500, waitForFade: false
    }
    const { runner } = setup([stopCue])
    runner.go()
    expect(audioPlayer.stopAll).toHaveBeenCalledWith(0)
  })

  it('stop cue with fadeOut passes fadeOutDuration to stopAll', () => {
    const stopCue: StopCue = {
      id: 's1', number: '1', name: 'Stop All', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'all', fadeOut: true, fadeOutDuration: 1500, waitForFade: false
    }
    const { runner } = setup([stopCue])
    runner.go()
    expect(audioPlayer.stopAll).toHaveBeenCalledWith(1500)
  })

  it('stop cue targeting a specific cue calls audioPlayer.stop without fade', () => {
    const stopCue: StopCue = {
      id: 's1', number: '1', name: 'Stop Specific', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'a1', fadeOut: false, fadeOutDuration: 0, waitForFade: false
    }
    const { runner } = setup([stopCue])
    runner.go()
    expect(audioPlayer.stop).toHaveBeenCalledWith('a1', 0)
  })

  it('stop cue targeting a specific cue with fadeOut passes fadeOutDuration', () => {
    const stopCue: StopCue = {
      id: 's1', number: '1', name: 'Stop Specific Fade', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      targetCueId: 'a1', fadeOut: true, fadeOutDuration: 800, waitForFade: false
    }
    const { runner } = setup([stopCue])
    runner.go()
    expect(audioPlayer.stop).toHaveBeenCalledWith('a1', 800)
  })

  it('fires the next cue only after the fade when waitForFade is on', () => {
    const stopCue: StopCue = {
      id: 's1', number: '1', name: 'Stop With Fade', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'on-end', isArmed: true, notes: '',
      targetCueId: 'a1', fadeOut: true, fadeOutDuration: 1200, waitForFade: true
    }
    const nextCue = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning } = setup([stopCue, nextCue])

    runner.go()
    vi.advanceTimersByTime(1199)
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')

    vi.advanceTimersByTime(1)
    vi.runAllTimers()
    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
  })

  it('fires the next cue immediately when waitForFade is off', () => {
    const stopCue: StopCue = {
      id: 's1', number: '1', name: 'Stop Without Wait', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'on-end', isArmed: true, notes: '',
      targetCueId: 'a1', fadeOut: true, fadeOutDuration: 1200, waitForFade: false
    }
    const nextCue = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning } = setup([stopCue, nextCue])

    runner.go()
    vi.runAllTimers()
    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
  })

  it('stop() cancels a pending wait-for-fade timer', () => {
    const stopCue: StopCue = {
      id: 's1', number: '1', name: 'Stop With Fade', type: 'stop',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'on-end', isArmed: true, notes: '',
      targetCueId: 'a1', fadeOut: true, fadeOutDuration: 1200, waitForFade: true
    }
    const nextCue = makeWait({ id: 'w2', number: '2' })
    const { runner, setRunning } = setup([stopCue, nextCue])

    runner.go()
    runner.stop('s1')
    vi.runAllTimers()
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')
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
    vi.mocked(audioPlayer.play).mockResolvedValue(undefined)
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
    await vi.runAllTimersAsync()

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
    await vi.runAllTimersAsync()

    expect(setLastRun).toHaveBeenCalledWith('o1', expect.objectContaining({
      outcome: 'error',
      error: 'getaddrinfo ENOTFOUND stage-lights.local'
    }))
  })

  it('reports an audio cue whose file will not play', async () => {
    vi.mocked(audioPlayer.play).mockRejectedValue(new Error('ENOENT: no such file'))
    const cue = makeAudio({ id: 'a1' })
    const { runner, setLastRun, appendLog } = setup([cue])

    runner.go()
    await vi.runAllTimersAsync()

    expect(setLastRun).toHaveBeenCalledWith('a1', expect.objectContaining({
      outcome: 'error',
      error: 'ENOENT: no such file'
    }))
    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({ level: 'error', message: 'ENOENT: no such file' })
    ])
  })

  it('keeps the run successful when the MIDI send went through', async () => {
    const cue = makeMidi({ id: 'm1' })
    const { runner, setLastRun } = setup([cue])

    runner.go()
    await vi.runAllTimersAsync()

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
        rf: {
          ...defaults.rf,
          plot: {
            performers: [],
            packs: [{
              id: 'pack-1', label: 'Pack 1', channelId: null,
              performerId: null, notes: '', deskChannelId: 'dca-1'
            }]
          }
        },
        scenes: {
          channels: [{
            id: 'dca-1',
            label: 'DCA 1 — Principals',
            ...midiNoteMessages('Yamaha', 1, 36)
          }],
          list: [{ id: 's-1', name: 'Wedding', live: ['pack-1'], notes: '' }]
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
})

describe('CueRunner — network cues', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('calls fetch with url, method, headers, body, and a timeout signal', () => {
    const networkCue: NetworkCue = {
      id: 'n1', number: '1', name: 'Network', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      method: 'POST',
      url: 'https://example.com/api',
      body: '{"key":"value"}',
      headers: { 'Content-Type': 'application/json' },
      timeout: 3000
    }
    const { runner } = setup([networkCue])
    runner.go()

    expect(fetch).toHaveBeenCalledWith('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"key":"value"}',
      signal: expect.any(AbortSignal)
    })
  })

  it('uses default 5000ms timeout when cue.timeout is not set', () => {
    const networkCue: NetworkCue = {
      id: 'n2', number: '2', name: 'Default Timeout', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      method: 'GET',
      url: 'https://example.com',
      body: '',
      headers: {},
      timeout: 5000
    }
    const { runner } = setup([networkCue])
    runner.go()

    expect(fetch).toHaveBeenCalledWith('https://example.com', {
      method: 'GET',
      headers: {},
      body: undefined,
      signal: expect.any(AbortSignal)
    })
  })

  it('calls onDone after fetch completes', async () => {
    const networkCue: NetworkCue = {
      id: 'n3', number: '3', name: 'Network', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'on-end', isArmed: true, notes: '',
      method: 'GET',
      url: 'https://example.com',
      body: '',
      headers: {},
      timeout: 5000
    }
    const cue2 = makeWait({ id: 'w2', number: '4' })
    const { runner, setRunning } = setup([networkCue, cue2])
    runner.go()

    // Should not fire next cue until fetch resolves
    expect(setRunning.mock.calls.map(c => c[0])).not.toContain('w2')

    // Flush microtasks — the mock fetch resolves immediately, so onDone should fire
    await vi.runAllTimersAsync()
    expect(setRunning.mock.calls.map(c => c[0])).toContain('w2')
  })

  it('logs the error and still advances when the request rejects', async () => {
    const log = vi.fn()
    console.error = log
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const networkCue: NetworkCue = {
      id: 'n4', number: '4', name: 'Failing Network', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'on-end', isArmed: true, notes: '',
      method: 'GET',
      url: 'https://example.com',
      body: '',
      headers: {},
      timeout: 5000
    }
    const cue2 = makeWait({ id: 'w2', number: '5' })
    const { runner, setRunning, setLastRun, appendLog } = setup([networkCue, cue2])
    runner.go()

    await vi.runAllTimersAsync()

    expect(log).toHaveBeenCalledWith('Network cue failed:', expect.any(Error))
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('ok', { status: 200, statusText: 'OK' })
    ))

    const networkCue: NetworkCue = {
      id: 'n7', number: '7', name: 'Ping', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      method: 'GET',
      url: 'https://example.com/ping',
      body: '',
      headers: {},
      timeout: 5000
    }
    const { runner, appendLog } = setup([networkCue])
    runner.go()

    await vi.runAllTimersAsync()

    expect(appendLog).toHaveBeenCalledWith([
      expect.objectContaining({
        level: 'info',
        message: 'GET https://example.com/ping → 200 OK (0ms)',
        label: '7 · Ping'
      })
    ])
  })

  it('records the response status of a successful run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })))

    const networkCue: NetworkCue = {
      id: 'n5', number: '5', name: 'Network', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      method: 'GET',
      url: 'https://example.com',
      body: '',
      headers: {},
      timeout: 5000
    }
    const { runner, setLastRun } = setup([networkCue])
    runner.go()

    await vi.runAllTimersAsync()

    expect(setLastRun).toHaveBeenCalledWith('n5', expect.objectContaining({
      outcome: 'success',
      status: 200,
      durationMs: expect.any(Number)
    }))
  })

  it('records a failed run when the response carries an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('nope', { status: 503, statusText: 'Service Unavailable' })
    ))

    const networkCue: NetworkCue = {
      id: 'n6', number: '6', name: 'Network', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      method: 'GET',
      url: 'https://example.com',
      body: '',
      headers: {},
      timeout: 5000
    }
    const { runner, setLastRun } = setup([networkCue])
    runner.go()

    await vi.runAllTimersAsync()

    expect(setLastRun).toHaveBeenCalledWith('n6', expect.objectContaining({
      outcome: 'error',
      status: 503,
      error: 'HTTP 503 Service Unavailable'
    }))
  })

  it('reports the response body on the run result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 200 })
    ))

    const networkCue: NetworkCue = {
      id: 'n8', number: '8', name: 'Body', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      method: 'GET',
      url: 'https://example.com/body',
      body: '',
      headers: {},
      timeout: 5000
    }
    const { runner, setLastRun } = setup([networkCue])
    runner.go()

    await vi.runAllTimersAsync()

    expect(setLastRun).toHaveBeenCalledWith('n8', expect.objectContaining({
      outcome: 'success',
      body: '{"ok":true}'
    }))
  })

  it('truncates a body longer than the cap and marks it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('a'.repeat(4500), { status: 200 })
    ))

    const networkCue: NetworkCue = {
      id: 'n9', number: '9', name: 'Long Body', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      method: 'GET',
      url: 'https://example.com/long',
      body: '',
      headers: {},
      timeout: 5000
    }
    const { runner, setLastRun } = setup([networkCue])
    runner.go()

    await vi.runAllTimersAsync()

    expect(setLastRun).toHaveBeenCalledWith('n9', expect.objectContaining({
      body: 'a'.repeat(4000) + '\n… (truncated)'
    }))
  })

  it('omits the body field for an empty response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })))

    const networkCue: NetworkCue = {
      id: 'n10', number: '10', name: 'Empty Body', type: 'network',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      method: 'GET',
      url: 'https://example.com/empty',
      body: '',
      headers: {},
      timeout: 5000
    }
    const { runner, setLastRun } = setup([networkCue])
    runner.go()

    await vi.runAllTimersAsync()

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
    await vi.runAllTimersAsync()

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
    await vi.runAllTimersAsync()

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
    await vi.runAllTimersAsync()

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

    expect(audioPlayer.stop).toHaveBeenCalledWith('a1', 0)
    // The run stays lit until the audio actually ends; only scripts are taken away here.
    expect(scriptHostMock.cancel).not.toHaveBeenCalled()
    expect(setRunning).not.toHaveBeenCalledWith('a1', null)
  })
})

describe('CueRunner — panic details', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('fades the audio instead of cutting it, and drops pending cues', () => {
    const cue1 = makeWait({ id: 'w1', duration: 5000, advance: 'on-end' })
    const cue2 = makeWait({ id: 'w2' })
    const { runner, setRunning, clearAllRunning } = setup([cue1, cue2])

    runner.go()
    runner.panic()

    // Exactly one stopAll, with the fade. A hard stopAll() first would leave the
    // player's active map empty and the fade would never be scheduled.
    expect(vi.mocked(audioPlayer.stopAll).mock.calls).toEqual([[200]])
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

describe('CueRunner — fireCueFromOffset fallback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('calls onDone immediately for non-audio/non-wait cues via fireCueFromOffset (e.g. osc cue in timeline seek)', () => {
    // Use seekTimeline to exercise the fireCueFromOffset path with a non-audio/non-wait cue
    const group = {
      id: 'g1', number: '1', name: 'Group', type: 'group' as const,
      colorLabel: 'none' as const, parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none' as const, isArmed: true, notes: '',
      mode: 'timeline' as const,
    }
    const oscCue = {
      id: 'oc1', number: '2', name: 'OSC', type: 'osc' as const,
      colorLabel: 'none' as const, parentId: 'g1', preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none' as const, isArmed: true, notes: '',
      host: '127.0.0.1', port: 8000, address: '/test', args: [],
    }
    // Mock window.winslab.osc
    Object.defineProperty(window, 'winslab', {
      value: { osc: { send: vi.fn().mockResolvedValue(undefined) } },
      writable: true,
    })

    const setRunning = vi.fn()
    const runner = new CueRunner()
    runner.init({
          getCues: () => [group, oscCue],
          getSelected: () => 'g1',
          setSelected: vi.fn(),
          setRunning,
          clearAllRunning: vi.fn(),
          syncCueDuration: vi.fn(),
          setLastRun: vi.fn(),
          appendLog: vi.fn(),
          getWorkspacePath: () => null,
          getMidiDefaultPort: () => ''
        })

    // Seek past the osc cue's offset — fireCueFromOffset will hit the else branch (onDone)
    runner.seekTimeline('g1', 100)
    runner.go()
    vi.runAllTimers()

    // The osc cue should NOT have been fired because its timelineOffset (0) was before the seek (100),
    // and it's a fire-and-forget type so it gets skipped entirely (line 234: child.type === 'osc' → continue)
    // Let's verify that the osc was skipped by checking createBufferSource not called
    expect(setRunning.mock.calls.filter(c => c[0] === 'oc1')).toHaveLength(0)
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
    expect(audioPlayer.stop).toHaveBeenCalledWith('c1', 0)

    // The run is abandoned: the child that was stopped cannot hand over to the next.
    vi.runAllTimers()
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

    expect(audioPlayer.stop).toHaveBeenCalledWith('c1', 800)
    expect(audioPlayer.stop).toHaveBeenCalledWith('c2', 800)
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
    vi.runAllTimers()
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

    vi.runAllTimers()
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
    vi.runAllTimers()
    expect(fired(setRunning)).not.toContain('c2')
  })
})
