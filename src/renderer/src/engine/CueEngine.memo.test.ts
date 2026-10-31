// The memo cue: a note in the stack that does nothing, at once, so the show runs through it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { CueEngine } from './CueEngine'
import type { Cue, MemoCue, WaitCue } from '../../../shared/cue'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import { createCue } from '../utils/cueDefaults'

vi.mock('./audioEngineClient')

const runners: CueEngine[] = []
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose()
})

function memo(overrides: Partial<MemoCue> = {}): MemoCue {
  return { ...(createCue('memo') as MemoCue), id: 'memo', number: '2', notes: 'Hold for the bow', ...overrides }
}

function wait(overrides: Partial<WaitCue> = {}): WaitCue {
  return { ...(createCue('wait') as WaitCue), duration: 1000, ...overrides }
}

function setup(cues: Cue[], selected: string): { runner: CueEngine; setRunning: Mock; setLastRun: Mock; setSelected: Mock } {
  const runner = new CueEngine()
  let selection: string | null = selected
  const setRunning = vi.fn()
  const setLastRun = vi.fn()
  const setSelected = vi.fn((id: string | null) => { selection = id })
  runner.init({
    getCues: () => cues,
    getSelected: () => selection,
    setSelected,
    setRunning,
    clearAllRunning: vi.fn(),
    syncCueDuration: vi.fn(),
    setLastRun,
    appendLog: vi.fn(),
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD
  })
  runners.push(runner)
  return { runner, setRunning, setLastRun, setSelected }
}

describe('a memo cue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('is born with nothing to set beyond what every cue carries', () => {
    const cue = createCue('memo', '7')
    expect(cue).toMatchObject({ type: 'memo', name: 'Memo', number: '7', notes: '' })
  })

  it('completes the moment it is fired', () => {
    const { runner, setLastRun } = setup([memo()], 'memo')
    runner.go()
    vi.advanceTimersByTime(30)
    expect(setLastRun).toHaveBeenCalledWith('memo', expect.objectContaining({ outcome: 'success', durationMs: 0 }))
  })

  it('passes an on-end chain straight through to the cue after it', () => {
    const before = wait({ id: 'w1', advance: 'on-end', duration: 500 })
    const note = memo({ advance: 'on-end' })
    const after = wait({ id: 'w2' })
    const { runner, setRunning } = setup([before, note, after], 'w1')

    runner.go()
    vi.advanceTimersByTime(530)

    // The wait ended, the memo took no time, and the cue after it is running.
    expect(setRunning).toHaveBeenCalledWith('w2', expect.objectContaining({ state: 'playing' }))
  })

  it('takes the selection one step on, as GO on any cue does', () => {
    const { runner, setSelected } = setup([memo(), wait({ id: 'w2' })], 'memo')
    runner.go()
    expect(setSelected).toHaveBeenLastCalledWith('w2')
  })
})
