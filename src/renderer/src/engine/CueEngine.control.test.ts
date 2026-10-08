// The Control cue: one verb on the cues it names — start, stop, pause, resume, load to a time,
// reset, go to, arm, disarm — and then it is over, so a chain runs through it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CueEngine } from './CueEngine'
import { audioEngine } from './audioEngineClient'
import type { AudioCue, ControlAction, ControlCue, Cue, GroupCue, WaitCue } from '../../../shared/cue'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import { createCue } from '../utils/cueDefaults'
import type { CueRunResult, RunningCue } from '../store'

vi.mock('./audioEngineClient')

const engine = vi.mocked(audioEngine)
const runners: CueEngine[] = []
afterEach(() => { for (const runner of runners.splice(0)) runner.dispose() })

function setup(cues: Cue[], selected = cues[0].id) {
  const runner = new CueEngine()
  const running = new Map<string, RunningCue>()
  const lastRuns = new Map<string, CueRunResult>()
  const setSelected = vi.fn()
  const setArmed = vi.fn((ids: string[], armed: boolean) => {
    for (const cue of cues) if (ids.includes(cue.id)) cue.isArmed = armed
  })
  const appendLog = vi.fn()
  runner.init({
    getCues: () => cues,
    getSelected: () => selected,
    setSelected,
    setRunning: (id, state) => { if (state === null) running.delete(id); else running.set(id, state) },
    clearAllRunning: () => running.clear(),
    syncCueDuration: vi.fn(),
    setLastRun: (id, result) => { lastRuns.set(id, result) },
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD,
    getRunning: () => running,
    isPro: () => false,
    setArmed
  })
  runners.push(runner)
  const logged = (): string[] => appendLog.mock.calls.flat(2).map((entry: { message: string }) => entry.message)
  return { runner, running, lastRuns, setSelected, setArmed, logged }
}

const tone = (id: string, number = id): AudioCue =>
  ({ ...(createCue('audio', number) as AudioCue), id, filePath: `/${id}.wav`, duration: 20_000 })
const wait = (id: string, ms = 5000): WaitCue => ({ ...(createCue('wait', id) as WaitCue), id, duration: ms })
const control = (action: ControlAction, targets: string[], patch: Partial<ControlCue> = {}): ControlCue =>
  ({ ...(createCue('control', 'c') as ControlCue), id: 'c', action, targetCueIds: targets, ...patch })

describe('a Control cue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('starts every cue it names, where they are, and completes at once', async () => {
    const cues: Cue[] = [control('start', ['w1', 'w2']), wait('w1'), wait('w2')]
    const { runner, running, lastRuns } = setup(cues)
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(running.has('w1')).toBe(true)
    expect(running.has('w2')).toBe(true)
    expect(lastRuns.get('c')).toMatchObject({ outcome: 'success' })
  })

  it('leaves a running target to its own policy, and says so for a disarmed one', async () => {
    const off = { ...wait('w2'), isArmed: false }
    const cues: Cue[] = [control('start', ['w1', 'w2']), wait('w1'), off]
    const { runner, running, logged } = setup(cues)
    runner.goById('w1')
    await vi.advanceTimersByTimeAsync(1000)
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    // w1 was not restarted: its run still counts from the first second.
    expect(running.get('w1')?.startedAt).toBeLessThan(Date.now() - 900)
    expect(running.has('w2')).toBe(false)
    expect(logged()).toContain('not started: it is disarmed')
  })

  it('never acts on itself', async () => {
    const cues: Cue[] = [control('start', ['c'])]
    const { runner, lastRuns } = setup(cues)
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(lastRuns.get('c')).toMatchObject({ outcome: 'error', error: 'no cue chosen' })
  })

  it('stops what it names, a group whole', async () => {
    const group: GroupCue = { ...(createCue('group', 'g') as GroupCue), id: 'g', mode: 'sequence' }
    const child = { ...wait('gw'), parentId: 'g' }
    const cues: Cue[] = [control('stop', ['g', 'w1']), group, child, wait('w1')]
    const { runner, running } = setup(cues)
    runner.goById('g')
    runner.goById('w1')
    await vi.advanceTimersByTimeAsync(100)
    expect(running.has('gw')).toBe(true)
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(running.has('g')).toBe(false)
    expect(running.has('gw')).toBe(false)
    expect(running.has('w1')).toBe(false)
  })

  it('pauses and resumes the sounds it names, and those inside a group it names', async () => {
    const group: GroupCue = { ...(createCue('group', 'g') as GroupCue), id: 'g', mode: 'timeline' }
    const inside = { ...tone('a2'), parentId: 'g' }
    const cues: Cue[] = [control('pause', ['a1', 'g']), tone('a1'), group, inside, control('resume', ['a1', 'g'], { id: 'r' })]
    const { runner, running } = setup(cues)
    runner.goById('a1')
    runner.goById('g')
    await vi.advanceTimersByTimeAsync(200)
    runner.goById('c')
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.pause).toHaveBeenCalledWith('a1')
    expect(engine.pause).toHaveBeenCalledWith('a2')
    expect(running.get('a1')?.state).toBe('paused')
    runner.goById('r')
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.resume).toHaveBeenCalledWith('a1')
    expect(engine.resume).toHaveBeenCalledWith('a2')
  })

  it('loads a cue to a time, so its next firing starts there — once — with its file decoded', async () => {
    const cues: Cue[] = [control('load', ['a1'], { loadToMs: 12_000 }), tone('a1')]
    const { runner } = setup(cues)
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.prepare).toHaveBeenCalledWith('a1', '/a1.wav')
    expect(runner.loadedOffset('a1')).toBe(12_000)

    runner.goById('a1')
    await vi.advanceTimersByTimeAsync(200)
    expect(engine.start).toHaveBeenCalledWith('a1', expect.any(Number), expect.objectContaining({ startTime: 12_000, fadeInDuration: 0 }))
    expect(runner.loadedOffset('a1')).toBeNull()

    runner.stop('a1')
    engine.start.mockClear()
    runner.goById('a1')
    await vi.advanceTimersByTimeAsync(200)
    expect(engine.start).toHaveBeenCalledWith('a1', expect.any(Number), expect.objectContaining({ startTime: 0 }))
  })

  it('moves a playing cue to the load time rather than readying it', async () => {
    const cues: Cue[] = [tone('a1'), control('load', ['a1'], { loadToMs: 3000 })]
    const { runner } = setup(cues)
    runner.goById('a1')
    await vi.advanceTimersByTimeAsync(300)
    runner.goById('c')
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.seek).toHaveBeenCalledWith('a1', 3000)
    expect(runner.loadedOffset('a1')).toBeNull()
  })

  it('resets what it names: stopped, its load forgotten, a playlist back at its first child', async () => {
    const playlist: GroupCue = { ...(createCue('group', 'p') as GroupCue), id: 'p', mode: 'playlist' }
    const cues: Cue[] = [
      control('load', ['a1'], { id: 'l', loadToMs: 5000 }),
      tone('a1'),
      playlist,
      { ...wait('p1', 100), parentId: 'p' },
      { ...wait('p2', 100), parentId: 'p' },
      control('reset', ['a1', 'p'])
    ]
    const { runner, running } = setup(cues)
    runner.goById('l')
    // The playlist plays its first child, and stands at its second.
    runner.goById('p')
    await vi.advanceTimersByTimeAsync(20)
    expect(running.has('p1')).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    runner.goById('c')
    await vi.advanceTimersByTimeAsync(50)
    expect(runner.loadedOffset('a1')).toBeNull()
    // The next firing of the playlist starts at its first child again.
    runner.goById('p')
    await vi.advanceTimersByTimeAsync(20)
    expect(running.has('p1')).toBe(true)
    expect(running.has('p2')).toBe(false)
  })

  it('moves the playhead to its first target, firing nothing', async () => {
    const cues: Cue[] = [control('goto', ['w2', 'w1']), wait('w1'), wait('w2')]
    const { runner, setSelected, running } = setup(cues)
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(setSelected).toHaveBeenLastCalledWith('w2')
    expect(running.has('w1')).toBe(false)
    expect(running.has('w2')).toBe(false)
  })

  it('arms and disarms what it names, as one edit of the show', async () => {
    const off = { ...wait('w1'), isArmed: false }
    const cues: Cue[] = [control('arm', ['w1', 'w2']), off, wait('w2'), control('disarm', ['w2'], { id: 'd' })]
    const { runner, setArmed } = setup(cues)
    runner.goById('c')
    await vi.advanceTimersByTimeAsync(50)
    // Only what changes is edited: w2 was armed already.
    expect(setArmed).toHaveBeenCalledWith(['w1'], true)
    runner.goById('d')
    await vi.advanceTimersByTimeAsync(50)
    expect(setArmed).toHaveBeenLastCalledWith(['w2'], false)
  })

  it('says how many of its targets the show no longer has, and acts on the rest', async () => {
    const cues: Cue[] = [control('start', ['gone', 'w1']), wait('w1')]
    const { runner, lastRuns, running } = setup(cues)
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(running.has('w1')).toBe(true)
    expect(lastRuns.get('c')).toMatchObject({ outcome: 'error', error: '1 of the cues it acts on is not in the show' })
  })

  it('hands the show on at once, so a chain runs through it', async () => {
    const cues: Cue[] = [{ ...control('goto', ['w2']), advance: 'on-end' }, wait('w1'), wait('w2')]
    const { runner, running } = setup(cues)
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    expect(running.has('w1')).toBe(true)
  })
})
