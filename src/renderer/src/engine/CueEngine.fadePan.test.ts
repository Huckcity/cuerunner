// A fade of volume and pan together: the two ramps go to the engine with one time and curve.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CueEngine } from './CueEngine'
import { audioEngine } from './audioEngineClient'
import type { Cue, FadeCue } from '../../../shared/cue'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import { createCue } from '../utils/cueDefaults'

vi.mock('./audioEngineClient')

const engine = vi.mocked(audioEngine)
const runners: CueEngine[] = []
afterEach(() => { for (const runner of runners.splice(0)) runner.dispose() })

function fade(patch: Partial<FadeCue>): FadeCue {
  return { ...(createCue('fade') as FadeCue), id: 'f', targetCueIds: ['a'], duration: 2000, ...patch }
}

function setup(cues: Cue[]): CueEngine {
  const runner = new CueEngine()
  runner.init({
    getCues: () => cues,
    getSelected: () => cues[0].id,
    setSelected: vi.fn(),
    setRunning: vi.fn(),
    clearAllRunning: vi.fn(),
    syncCueDuration: vi.fn(),
    setLastRun: vi.fn(),
    appendLog: vi.fn(),
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD,
    isPro: () => false
  })
  runners.push(runner)
  return runner
}

describe('a fade of volume and pan', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('sends both ramps, with the same time, length and curve', () => {
    const firedAt = Date.now()
    setup([fade({ targetValue: 0.2, panTargetValue: -1, curve: 'sCurve' })]).go()
    expect(engine.fade).toHaveBeenCalledWith('a', 'volume', 0.2, 2000, 'sCurve', firedAt)
    expect(engine.fade).toHaveBeenCalledWith('a', 'pan', -1, 2000, 'sCurve', firedAt)
  })

  it('sends one ramp for a fade with no pan target, as a show saved before it did', () => {
    setup([fade({ targetValue: 0, panTargetValue: null })]).go()
    expect(engine.fade).toHaveBeenCalledTimes(1)
  })

  it('reads a pan target on a pan fade as nothing more: the pan is already the property', () => {
    setup([fade({ fadeProperty: 'pan', targetValue: 0.5, panTargetValue: -1 })]).go()
    expect(engine.fade.mock.calls).toEqual([['a', 'pan', 0.5, 2000, 'linear', expect.any(Number)]])
  })
})
