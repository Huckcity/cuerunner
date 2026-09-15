import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { CueRunner } from './CueRunner'
import type { Cue, WaitCue, GroupCue } from '../types/cue'
import { DEFAULT_TRIGGER_GUARD } from '../types/workspace'

vi.mock('./audioEngineClient')
vi.mock('./networkClient', () => ({
  network: { request: vi.fn(), cancel: vi.fn() }
}))

function makeGroup(id: string, overrides: Partial<GroupCue> = {}): GroupCue {
  return {
    id, number: id, name: id, type: 'group',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
    advance: 'none', isArmed: true, notes: '',
    mode: 'sequence',
    ...overrides
  }
}

function makeWait(id: string, parentId: string | null, overrides: Partial<WaitCue> = {}): WaitCue {
  return {
    id, number: id, name: id, type: 'wait',
    colorLabel: 'none', parentId, preWait: 0, postWait: 0, timelineOffset: 0, duration: 100,
    advance: 'none', isArmed: true, notes: '',
    ...overrides
  }
}

// Runners left behind by a test still hold scheduled work; disposing them keeps a
// later test's clock from firing an earlier test's cues.
const runners: CueRunner[] = []
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose()
})

function setup(cues: Cue[]) {
  const runner = new CueRunner()
  const setRunning = vi.fn()
  const setSelected = vi.fn()

  runner.init({
    getCues: () => cues,
    getSelected: () => cues[0]?.id ?? null,
    setSelected,
    setRunning,
    clearAllRunning: vi.fn(),
    syncCueDuration: vi.fn(),
    setLastRun: vi.fn(),
    appendLog: vi.fn(),
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => 'default-midi-port',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD,
    isPro: () => true
  })
  runners.push(runner)
  return { runner, setRunning, setSelected }
}

describe('CueRunner — group cue (sequence mode)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('runs all children in order before calling done', () => {
    const group = makeGroup('g1')
    const c1 = makeWait('c1', 'g1', { duration: 100 })
    const c2 = makeWait('c2', 'g1', { duration: 100 })
    const c3 = makeWait('c3', 'g1', { duration: 100 })
    const { runner, setRunning } = setup([group, c1, c2, c3])

    runner.go()
    vi.advanceTimersByTime(1000)

    const fired = setRunning.mock.calls
      .filter(c => c[1]?.state === 'playing')
      .map(c => c[0])
    expect(fired).toContain('c1')
    expect(fired).toContain('c2')
    expect(fired).toContain('c3')
  })

  it('runs children sequentially — c2 does not start until c1 finishes', () => {
    const group = makeGroup('g1')
    const c1 = makeWait('c1', 'g1', { duration: 500 })
    const c2 = makeWait('c2', 'g1', { duration: 100 })
    const { runner, setRunning } = setup([group, c1, c2])

    runner.go()
    vi.advanceTimersByTime(200) // c1 is still playing

    const firedSoFar = setRunning.mock.calls
      .filter(c => c[1]?.state === 'playing')
      .map(c => c[0])
    expect(firedSoFar).toContain('c1')
    expect(firedSoFar).not.toContain('c2')

    vi.advanceTimersByTime(1000)
    const allFired = setRunning.mock.calls
      .filter(c => c[1]?.state === 'playing')
      .map(c => c[0])
    expect(allFired).toContain('c2')
  })

  it('skips disarmed children', () => {
    const group = makeGroup('g1')
    const c1 = makeWait('c1', 'g1', { isArmed: false })
    const c2 = makeWait('c2', 'g1')
    const { runner, setRunning } = setup([group, c1, c2])

    runner.go()
    vi.advanceTimersByTime(1000)

    const fired = setRunning.mock.calls.filter(c => c[1]?.state === 'playing').map(c => c[0])
    expect(fired).not.toContain('c1')
    expect(fired).toContain('c2')
  })

  it('calls done immediately when child list is empty', () => {
    const group = makeGroup('g1')
    const { runner, setRunning } = setup([group])

    runner.go()
    vi.advanceTimersByTime(100)

    expect(setRunning).toHaveBeenCalledWith('g1', null)
  })
})

describe('CueRunner — group cue (random mode)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('fires exactly one child in random mode', () => {
    const group = makeGroup('g1', { mode: 'random' })
    const c1 = makeWait('c1', 'g1')
    const c2 = makeWait('c2', 'g1')
    const c3 = makeWait('c3', 'g1')
    const { runner, setRunning } = setup([group, c1, c2, c3])

    runner.go()
    vi.advanceTimersByTime(1000)

    const fired = setRunning.mock.calls
      .filter(c => c[1]?.state === 'playing')
      .map(c => c[0])
      .filter(id => id !== 'g1')
    expect(fired).toHaveLength(1)
    expect(['c1', 'c2', 'c3']).toContain(fired[0])
  })
})

describe('CueRunner — group cue (playlist mode)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  const fired = (setRunning: Mock) => setRunning.mock.calls
    .filter(c => c[1]?.state === 'playing')
    .map(c => c[0])
  const timesFired = (setRunning: Mock, id: string) => fired(setRunning).filter(x => x === id).length

  it('fires one armed child per GO, in order', () => {
    const group = makeGroup('g1', { mode: 'playlist' })
    const { runner, setRunning } = setup([group, makeWait('w1', 'g1'), makeWait('w2', 'g1')])

    runner.go()
    expect(fired(setRunning)).toContain('w1')
    expect(fired(setRunning)).not.toContain('w2')

    vi.advanceTimersByTime(100)
    // A second press is a second press: the guard's window has passed.
    runner.resetGuards()
    runner.go()
    expect(fired(setRunning)).toContain('w2')
    expect(timesFired(setRunning, 'w1')).toBe(1)
  })

  it('starts a new pass after the last child', () => {
    const group = makeGroup('g1', { mode: 'playlist' })
    const { runner, setRunning } = setup([group, makeWait('w1', 'g1'), makeWait('w2', 'g1')])

    runner.go()
    vi.advanceTimersByTime(100)
    // A second press is a second press: the guard's window has passed.
    runner.resetGuards()
    runner.go()
    vi.advanceTimersByTime(100)
    // A second press is a second press: the guard's window has passed.
    runner.resetGuards()
    runner.go()

    expect(timesFired(setRunning, 'w1')).toBe(2)
    expect(timesFired(setRunning, 'w2')).toBe(1)
  })

  it('skips disarmed children', () => {
    const group = makeGroup('g1', { mode: 'playlist' })
    const armed = makeWait('w1', 'g1')
    const disarmed = makeWait('w2', 'g1', { isArmed: false })
    const { runner, setRunning } = setup([group, armed, disarmed])

    runner.go()
    vi.advanceTimersByTime(100)
    // A second press is a second press: the guard's window has passed.
    runner.resetGuards()
    runner.go()

    expect(fired(setRunning)).not.toContain('w2')
    expect(timesFired(setRunning, 'w1')).toBe(2)
  })

  it('holds the selection on the group while stepping, then hands it over', () => {
    const group = makeGroup('g1', { mode: 'playlist' })
    const { runner, setSelected } = setup([group, makeWait('w1', 'g1'), makeWait('w2', 'g1'), makeWait('next', null)])

    runner.go()
    expect(setSelected).toHaveBeenLastCalledWith('g1')

    vi.advanceTimersByTime(100)
    // A second press is a second press: the guard's window has passed.
    runner.resetGuards()
    runner.go()
    expect(setSelected).toHaveBeenLastCalledWith('next')
  })

  it('does not hand over mid-pass even when advance is on-end', () => {
    const group = makeGroup('g1', { mode: 'playlist', advance: 'on-end' })
    const { runner, setRunning } = setup([group, makeWait('w1', 'g1'), makeWait('w2', 'g1'), makeWait('next', null)])

    runner.go()
    vi.advanceTimersByTime(100)

    expect(fired(setRunning)).not.toContain('next')
  })

  it('STOP ALL returns the playlist to its first child', () => {
    const group = makeGroup('g1', { mode: 'playlist' })
    const { runner, setRunning } = setup([group, makeWait('w1', 'g1'), makeWait('w2', 'g1')])

    runner.go()
    vi.advanceTimersByTime(100)
    runner.stop()
    runner.resetGuards()
    runner.go()

    expect(timesFired(setRunning, 'w1')).toBe(2)
    expect(timesFired(setRunning, 'w2')).toBe(0)
  })
})

describe('CueRunner — selection skips group children', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('GO on a group advances selection past its children to the next top-level cue', () => {
    const group = makeGroup('g1')
    const c1 = makeWait('c1', 'g1')
    const c2 = makeWait('c2', 'g1')
    const next = makeWait('next', null)
    const setSelected = vi.fn()

    const runner = new CueRunner()
    runner.init({
      getCues: () => [group, c1, c2, next],
      getSelected: () => 'g1',
      setSelected,
      setRunning: vi.fn(),
      clearAllRunning: vi.fn(),
      syncCueDuration: vi.fn(),
      setLastRun: vi.fn(),
      appendLog: vi.fn(),
      getWorkspacePath: () => null,
      getMidiDefaultPort: () => 'default-midi-port',
      getTriggerGuard: () => DEFAULT_TRIGGER_GUARD,
      isPro: () => true
    })
    runners.push(runner)

    runner.go()
    expect(setSelected).toHaveBeenCalledWith('next')
  })
})
