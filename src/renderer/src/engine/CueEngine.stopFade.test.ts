// The operator's STOP: a cut, or — where the show sets one — a fade, with a second press
// during it cutting what is left. And the setting itself, carried only when it is a fade.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CueEngine } from './CueEngine'
import { audioEngine } from './audioEngineClient'
import type { AudioCue, Cue } from '../../../shared/cue'
import { normalizeTriggerGuard, STOP_FADE_MAX_MS, type TriggerGuardSettings } from '../../../shared/workspace'
import { createCue } from '../utils/cueDefaults'

vi.mock('./audioEngineClient')

const engine = vi.mocked(audioEngine)
const runners: CueEngine[] = []
afterEach(() => { for (const runner of runners.splice(0)) runner.dispose() })

function setup(cues: Cue[], guard: TriggerGuardSettings) {
  const runner = new CueEngine()
  const clearAllRunning = vi.fn()
  const appendLog = vi.fn()
  runner.init({
    getCues: () => cues,
    getSelected: () => cues[0].id,
    setSelected: vi.fn(),
    setRunning: vi.fn(),
    clearAllRunning,
    syncCueDuration: vi.fn(),
    setLastRun: vi.fn(),
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => guard
  })
  runners.push(runner)
  return { runner, clearAllRunning, appendLog }
}

const tone = (): AudioCue => ({ ...(createCue('audio') as AudioCue), id: 'a', filePath: '/a.wav', duration: 10_000 })

describe('the operator’s STOP', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('cuts at once in a show that sets no fade, as STOP always has', async () => {
    const { runner } = setup([tone()], { windowMs: 300 })
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    runner.operatorStop()
    expect(engine.stopAll).toHaveBeenCalledWith(0)
  })

  it('fades everything over the show’s STOP fade, and takes the runs away at once', async () => {
    const { runner, clearAllRunning } = setup([tone()], { windowMs: 300, stopFadeMs: 2000 })
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    runner.operatorStop()
    expect(engine.stop).toHaveBeenCalledWith('a', 2000)
    expect(engine.stopAll).toHaveBeenCalledWith(2000)
    expect(clearAllRunning).toHaveBeenCalled()
  })

  it('cuts what is left of the fade on a second press', async () => {
    const { runner, appendLog } = setup([tone()], { windowMs: 300, stopFadeMs: 2000 })
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    runner.operatorStop()
    vi.advanceTimersByTime(400)
    engine.stopAll.mockClear()
    runner.operatorStop()
    expect(engine.stopAll).toHaveBeenCalledWith(0)
    expect(appendLog.mock.calls.flat(2).map((entry: { message: string }) => entry.message)).toContain('cut the STOP fade')
  })

  it('fades again on a STOP long after the last fade is over', async () => {
    const { runner } = setup([tone()], { windowMs: 300, stopFadeMs: 1000 })
    runner.operatorStop()
    vi.advanceTimersByTime(5000)
    engine.stopAll.mockClear()
    runner.operatorStop()
    expect(engine.stopAll).toHaveBeenCalledWith(1000)
  })
})

describe('the STOP fade setting', () => {
  it('is carried only when it is a fade, so a show that cuts keeps its bytes', () => {
    expect(normalizeTriggerGuard({ windowMs: 300 })).toEqual({ windowMs: 300 })
    expect(normalizeTriggerGuard({ windowMs: 300, stopFadeMs: 0 })).toEqual({ windowMs: 300 })
    expect(normalizeTriggerGuard({ windowMs: 300, stopFadeMs: 1500 })).toEqual({ windowMs: 300, stopFadeMs: 1500 })
  })

  it('is held to its range, and survives a guard read back as the default', () => {
    expect(normalizeTriggerGuard({ windowMs: 300, stopFadeMs: 1e9 }).stopFadeMs).toBe(STOP_FADE_MAX_MS)
    expect(normalizeTriggerGuard({ stopFadeMs: 800 } as Partial<TriggerGuardSettings>)).toEqual({ windowMs: 300, stopFadeMs: 800 })
  })
})
