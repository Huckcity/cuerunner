// Pause: the whole show held where it stands — its sounds in the engine, its clock with them —
// and one audio cue held on its own while the rest goes on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { CueEngine } from './CueEngine'
import { audioEngine } from './audioEngineClient'
import type { AudioCue, Cue, WaitCue } from '../../../shared/cue'
import type { RunningCue } from '../store'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import { createCue } from '../utils/cueDefaults'

vi.mock('./audioEngineClient')

const engine = vi.mocked(audioEngine)

const runners: CueEngine[] = []
afterEach(() => {
  for (const runner of runners.splice(0)) {
    // A hold left standing would freeze the next test's clock.
    runner.stop()
    runner.dispose()
  }
})

function wait(id: string, duration: number, patch: Partial<WaitCue> = {}): WaitCue {
  return { ...(createCue('wait') as WaitCue), id, number: id, name: `Wait ${id}`, duration, ...patch }
}

function audio(id: string, duration: number, patch: Partial<AudioCue> = {}): AudioCue {
  return { ...(createCue('audio') as AudioCue), id, number: id, name: `Audio ${id}`, filePath: `/${id}.wav`, duration, ...patch }
}

interface Setup {
  runner: CueEngine
  rows: Map<string, RunningCue>
  setLastRun: Mock
  appendLog: Mock
}

function setup(cues: Cue[], selected = cues[0]?.id ?? null): Setup {
  const runner = new CueEngine()
  let selection: string | null = selected
  const rows = new Map<string, RunningCue>()
  const setLastRun = vi.fn()
  const appendLog = vi.fn()
  runner.init({
    getCues: () => cues,
    getSelected: () => selection,
    setSelected: (id) => { selection = id },
    setRunning: (id, state) => { if (state === null) rows.delete(id); else rows.set(id, state) },
    clearAllRunning: () => rows.clear(),
    syncCueDuration: vi.fn(),
    setLastRun,
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD,
    getRunning: () => rows,
    isPro: () => false
  })
  runners.push(runner)
  return { runner, rows, setLastRun, appendLog }
}

const messages = (appendLog: Mock): string[] => appendLog.mock.calls.flatMap(([entries]) => entries.map((e: { message: string }) => e.message))

describe('pausing the whole show', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('holds a wait where it stands, however long the show is held, and lets it finish its time', () => {
    const { runner, rows, setLastRun } = setup([wait('w', 1000)])
    runner.go()
    vi.advanceTimersByTime(400)
    runner.pauseAll()
    expect(runner.isHeld()).toBe(true)
    expect(rows.get('w')?.state).toBe('paused')

    vi.advanceTimersByTime(5000)
    expect(setLastRun).not.toHaveBeenCalled()
    expect(rows.has('w')).toBe(true)

    runner.resumeAll()
    expect(rows.get('w')?.state).toBe('playing')
    vi.advanceTimersByTime(550)
    expect(setLastRun).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(setLastRun).toHaveBeenCalledWith('w', expect.objectContaining({ outcome: 'success', durationMs: 1000 }))
  })

  it('holds and lets go of every sounding voice in the engine', async () => {
    const { runner } = setup([audio('a', 4000), audio('b', 4000)])
    runner.go()
    runner.goById('b')
    await vi.advanceTimersByTimeAsync(100)
    runner.pauseAll()
    expect(engine.pause.mock.calls.map(([cueId]) => cueId).sort()).toEqual(['a', 'b'])
    expect(engine.holdClock).toHaveBeenCalled()
    runner.resumeAll()
    expect(engine.resume.mock.calls.map(([cueId]) => cueId).sort()).toEqual(['a', 'b'])
    expect(engine.releaseClock).toHaveBeenCalled()
  })

  it('refuses GO, and a trigger’s press, while the show is held — and says why', () => {
    const { runner, rows, appendLog } = setup([wait('w', 1000), wait('x', 1000)])
    runner.go()
    runner.pauseAll()
    runner.go()
    runner.goById('x')
    expect(rows.has('x')).toBe(false)
    expect(messages(appendLog)).toContain('the show is paused — resume it (P) before firing a cue')
  })

  it('carries a held show’s handover over: the next cue starts when the held time is up', () => {
    const { runner, rows } = setup([wait('w', 1000, { advance: 'on-end' }), wait('x', 1000)])
    runner.go()
    vi.advanceTimersByTime(800)
    runner.pauseAll()
    vi.advanceTimersByTime(3000)
    expect(rows.has('x')).toBe(false)
    runner.resumeAll()
    vi.advanceTimersByTime(250)
    expect(rows.get('x')?.state).toBe('playing')
  })

  it('is ended by STOP with everything else, so the next GO runs on time', () => {
    const { runner, setLastRun } = setup([wait('w', 1000), wait('x', 500)])
    runner.go()
    runner.pauseAll()
    runner.stop()
    expect(runner.isHeld()).toBe(false)
    expect(engine.releaseClock).toHaveBeenCalled()
    // Past the repeat guard, so the second GO is a press of its own.
    vi.advanceTimersByTime(400)
    runner.go()
    vi.advanceTimersByTime(520)
    expect(setLastRun).toHaveBeenCalledWith('x', expect.objectContaining({ durationMs: 500 }))
  })

  it('toggles with one key', () => {
    const { runner } = setup([wait('w', 1000)])
    runner.go()
    runner.togglePause()
    expect(runner.isHeld()).toBe(true)
    runner.togglePause()
    expect(runner.isHeld()).toBe(false)
  })
})

describe('pausing one audio cue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('holds its end and its handover, and moves both on by the time held', async () => {
    const { runner, rows, setLastRun } = setup([audio('a', 2000, { advance: 'on-end' }), wait('next', 1000)])
    runner.go()
    await vi.advanceTimersByTimeAsync(500)
    expect(runner.pauseCue('a')).toBe(true)
    expect(engine.pause).toHaveBeenCalledWith('a')
    expect(rows.get('a')?.state).toBe('paused')

    await vi.advanceTimersByTimeAsync(4000)
    expect(setLastRun).not.toHaveBeenCalledWith('a', expect.anything())
    expect(rows.has('next')).toBe(false)

    expect(runner.resumeCue('a')).toBe(true)
    expect(engine.resume).toHaveBeenCalledWith('a')
    await vi.advanceTimersByTimeAsync(1400)
    expect(setLastRun).not.toHaveBeenCalledWith('a', expect.anything())
    await vi.advanceTimersByTimeAsync(200)
    expect(setLastRun).toHaveBeenCalledWith('a', expect.objectContaining({ outcome: 'success' }))
    expect(rows.get('next')?.state).toBe('playing')
  })

  it('leaves the rest of the show running while it is held', async () => {
    const { runner, setLastRun } = setup([audio('a', 2000), wait('w', 500)])
    runner.go()
    runner.goById('w')
    await vi.advanceTimersByTimeAsync(100)
    runner.pauseCue('a')
    await vi.advanceTimersByTimeAsync(500)
    expect(setLastRun).toHaveBeenCalledWith('w', expect.objectContaining({ outcome: 'success' }))
  })

  it('will not hold a cue that has no sound to hold, and says so', () => {
    const { runner, appendLog } = setup([wait('w', 1000)])
    runner.go()
    expect(runner.pauseCue('w')).toBe(false)
    expect(messages(appendLog)).toContain('only an audio or video cue that is playing can be paused on its own')
  })

  it('does not move a held cue’s playhead: a seek waits for the resume', async () => {
    const { runner } = setup([audio('a', 4000)])
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    runner.pauseCue('a')
    runner.seekCue('a', 2000)
    expect(engine.seek).not.toHaveBeenCalled()
  })

  it('toggles, and a stop takes the hold with the cue', async () => {
    const { runner } = setup([audio('a', 4000)])
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    expect(runner.togglePauseCue('a')).toBe(true)
    expect(runner.isPaused('a')).toBe(true)
    runner.stop('a')
    expect(runner.isPaused('a')).toBe(false)
  })
})
