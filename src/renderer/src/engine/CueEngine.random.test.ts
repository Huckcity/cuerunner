// A random group fired again and again plays every child once before any twice.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CueEngine } from './CueEngine'
import type { Cue, GroupCue, WaitCue } from '../../../shared/cue'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import { createCue } from '../utils/cueDefaults'

vi.mock('./audioEngineClient')

const runners: CueEngine[] = []
afterEach(() => { for (const runner of runners.splice(0)) runner.dispose() })

describe('a random group', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('plays each of its children once in every run of as many GOs as it has children', () => {
    const group: GroupCue = { ...(createCue('group') as GroupCue), id: 'g', mode: 'random' }
    const children: WaitCue[] = ['a', 'b', 'c'].map(id => ({ ...(createCue('wait') as WaitCue), id, parentId: 'g', duration: 100 }))
    const cues: Cue[] = [group, ...children]
    const started: string[] = []
    const runner = new CueEngine()
    runner.init({
      getCues: () => cues,
      getSelected: () => 'g',
      setSelected: vi.fn(),
      setRunning: (id, state) => { if (state?.state === 'playing' && id !== 'g') started.push(id) },
      clearAllRunning: vi.fn(),
      syncCueDuration: vi.fn(),
      setLastRun: vi.fn(),
      appendLog: vi.fn(),
      getWorkspacePath: () => null,
      getMidiDefaultPort: () => '',
      getTriggerGuard: () => DEFAULT_TRIGGER_GUARD
    })
    runners.push(runner)

    for (let i = 0; i < 9; i++) {
      runner.goById('g')
      vi.advanceTimersByTime(500)
    }
    expect(started).toHaveLength(9)
    for (let pass = 0; pass < 3; pass++) {
      expect(started.slice(pass * 3, pass * 3 + 3).sort()).toEqual(['a', 'b', 'c'])
    }
  })
})
