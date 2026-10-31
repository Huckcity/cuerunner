// An audio cue's own fade-out: a ramp to silence that lands on the cue's end, timed by the
// engine from the run's planned end rather than by a renderer tick.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CueEngine } from './CueEngine'
import { audioEngine } from './audioEngineClient'
import type { AudioCue, Cue } from '../../../shared/cue'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import { createCue } from '../utils/cueDefaults'

vi.mock('./audioEngineClient')

const engine = vi.mocked(audioEngine)

const runners: CueEngine[] = []
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose()
})

function audio(overrides: Partial<AudioCue> = {}): AudioCue {
  return {
    ...(createCue('audio') as AudioCue),
    id: 'a1',
    filePath: '/walk-in.wav',
    duration: 4000,
    ...overrides
  }
}

function setup(cues: Cue[]): CueEngine {
  const runner = new CueEngine()
  runner.init({
    getCues: () => cues,
    getSelected: () => cues[0]?.id ?? null,
    setSelected: vi.fn(),
    setRunning: vi.fn(),
    clearAllRunning: vi.fn(),
    syncCueDuration: vi.fn(),
    setLastRun: vi.fn(),
    appendLog: vi.fn(),
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD
  })
  runners.push(runner)
  return runner
}

/** The fades the runner asked the engine for on this cue's volume. */
function volumeFades(): unknown[][] {
  return engine.fade.mock.calls.filter(call => call[0] === 'a1' && call[1] === 'volume')
}

describe('an audio cue’s fade-out', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('ramps to silence so the ramp ends exactly where the cue does', async () => {
    const firedAt = Date.now()
    const runner = setup([audio({ fadeOutDuration: 1500 })])
    runner.go()

    // Nothing goes out until the fade is inside the lookahead.
    await vi.advanceTimersByTimeAsync(2000)
    expect(volumeFades()).toEqual([])

    await vi.advanceTimersByTimeAsync(600)
    expect(volumeFades()).toEqual([['a1', 'volume', 0, 1500, 'sCurve', firedAt + 2500]])
  })

  it('fades over the whole of a cue shorter than its fade', async () => {
    const firedAt = Date.now()
    const runner = setup([audio({ duration: 800, fadeOutDuration: 2000 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(volumeFades()).toEqual([['a1', 'volume', 0, 800, 'sCurve', firedAt]])
  })

  it('lands on the end of the last loop, not the first', async () => {
    const firedAt = Date.now()
    const runner = setup([audio({ duration: 1000, loopCount: 2, fadeOutDuration: 500 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(3000)
    expect(volumeFades()).toEqual([['a1', 'volume', 0, 500, 'sCurve', firedAt + 2500]])
  })

  it('does nothing for a cue with no fade-out, as a show saved before it existed', async () => {
    const legacy = audio()
    delete legacy.fadeOutDuration
    const runner = setup([legacy])
    runner.go()
    await vi.advanceTimersByTimeAsync(4100)
    expect(volumeFades()).toEqual([])
  })

  it('has no end to land on when the cue loops for ever', async () => {
    const runner = setup([audio({ loopCount: -1, fadeOutDuration: 1000 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(volumeFades()).toEqual([])
  })

  it('is taken back by STOP before it goes out', async () => {
    const runner = setup([audio({ fadeOutDuration: 1000 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(1000)
    runner.stop()
    await vi.advanceTimersByTimeAsync(4000)
    expect(volumeFades()).toEqual([])
  })

  it('puts the level back and plans again when a seek moves the end after the fade began', async () => {
    const runner = setup([audio({ volume: 0.8, fadeOutDuration: 1000 })])
    runner.go()
    // Inside the fade: it has gone to the engine.
    await vi.advanceTimersByTimeAsync(3200)
    expect(volumeFades()).toHaveLength(1)

    // The operator drops the playhead back to the start of the file.
    runner.seekCue('a1', 0)
    await vi.advanceTimersByTimeAsync(0)
    const seekedAt = Date.now()

    // The level is the cue's own again, at once…
    expect(volumeFades()[1]).toEqual(['a1', 'volume', 0.8, 0, 'linear'])
    // …and the fade is landed on the new end, four seconds on.
    await vi.advanceTimersByTimeAsync(3000)
    expect(volumeFades()[2]).toEqual(['a1', 'volume', 0, 1000, 'sCurve', seekedAt + 3000])
  })
})
