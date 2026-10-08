// The runner in a show of several cue lists: GO walks one list, an advance never crosses into
// another, STOP is the list on screen's, and a list taken out of the show fires nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CueEngine } from './CueEngine'
import { audioEngine } from './audioEngineClient'
import type { AudioCue, Cue, WaitCue } from '../../../shared/cue'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import { defaultCueLists, type CueListInfo } from '../../../shared/cueLists'
import { createCue } from '../utils/cueDefaults'

vi.mock('./audioEngineClient')

const engine = vi.mocked(audioEngine)
const runners: CueEngine[] = []
afterEach(() => { for (const runner of runners.splice(0)) runner.dispose() })

function wait(id: string, overrides: Partial<WaitCue> = {}): WaitCue {
  return { ...(createCue('wait') as WaitCue), id, number: id, name: id, duration: 1000, ...overrides }
}

function tone(id: string, overrides: Partial<AudioCue> = {}): AudioCue {
  return { ...(createCue('audio') as AudioCue), id, number: id, filePath: `/${id}.wav`, duration: 10_000, ...overrides }
}

const LISTS: CueListInfo[] = [...defaultCueLists(), { id: 'fx', name: 'Effects' }]

function setup(cues: Cue[], options: { lists?: CueListInfo[]; active?: string; selected?: string; stopFadeMs?: number } = {}) {
  const runner = new CueEngine()
  let selection: string | null = options.selected ?? null
  const playheads = new Map<string, string | null>()
  const setRunning = vi.fn()
  const appendLog = vi.fn()
  const clearAllRunning = vi.fn()
  const setSelected = vi.fn((id: string | null) => { selection = id })
  const setListPlayhead = vi.fn((listId: string, id: string | null) => { playheads.set(listId, id) })
  runner.init({
    getCues: () => cues,
    getSelected: () => selection,
    setSelected,
    setRunning,
    clearAllRunning,
    syncCueDuration: vi.fn(),
    setLastRun: vi.fn(),
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => ({ ...DEFAULT_TRIGGER_GUARD, windowMs: 0, stopFadeMs: options.stopFadeMs }),
    isPro: () => false,
    getCueLists: () => options.lists ?? LISTS,
    getActiveListId: () => options.active ?? 'main',
    getListPlayhead: listId => playheads.has(listId) ? playheads.get(listId) ?? null : cues.find(c => c.listId === listId)?.id ?? null,
    setListPlayhead
  })
  runners.push(runner)
  return { runner, setRunning, setSelected, setListPlayhead, appendLog, clearAllRunning, playheads }
}

const messages = (appendLog: ReturnType<typeof vi.fn>): string[] =>
  appendLog.mock.calls.flat(2).map((entry: { message: string }) => entry.message)

describe('GO in a show of several lists', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('moves the playhead to the next cue of the same list, past another list’s cues between them', () => {
    const cues = [wait('1'), wait('x', { listId: 'fx' }), wait('2')]
    const { runner, setSelected, setRunning } = setup(cues, { selected: '1' })
    runner.go()
    expect(setRunning).toHaveBeenCalledWith('1', expect.objectContaining({ state: 'playing' }))
    expect(setSelected).toHaveBeenLastCalledWith('2')
  })

  it('ends a list at its own last cue: an advance never hands over to another list', async () => {
    const cues = [wait('1', { advance: 'on-end', duration: 200 }), wait('x', { listId: 'fx' })]
    const { runner, setSelected, setRunning } = setup(cues, { selected: '1' })
    runner.go()
    expect(setSelected).toHaveBeenLastCalledWith(null)
    await vi.advanceTimersByTimeAsync(400)
    expect(setRunning).not.toHaveBeenCalledWith('x', expect.anything())
  })

  it('runs a list named by a remote on its own playhead, without touching the one on screen', () => {
    const cues = [wait('1'), wait('x', { listId: 'fx' }), wait('y', { listId: 'fx' })]
    const { runner, setSelected, setListPlayhead, setRunning } = setup(cues, { selected: '1' })
    runner.go('fx')
    expect(setRunning).toHaveBeenCalledWith('x', expect.objectContaining({ state: 'playing' }))
    expect(setListPlayhead).toHaveBeenLastCalledWith('fx', 'y')
    expect(setSelected).not.toHaveBeenCalled()
  })

  it('fires nothing in a list that has been taken out of the show, by GO or by a trigger, and says so', () => {
    const lists = [...defaultCueLists(), { id: 'fx', name: 'Effects', disarmed: true }]
    const cues = [wait('1'), wait('x', { listId: 'fx' })]
    const { runner, setRunning, appendLog } = setup(cues, { lists, selected: '1' })
    runner.go('fx')
    runner.goById('x')
    expect(setRunning).not.toHaveBeenCalledWith('x', expect.anything())
    expect(messages(appendLog)).toContain('not fired: the list “Effects” is disarmed')
    // The list beside it fires as it always did.
    runner.go()
    expect(setRunning).toHaveBeenCalledWith('1', expect.objectContaining({ state: 'playing' }))
  })
})

describe('STOP in a show of several lists', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('stops the list on screen and lets another list’s cue play on', async () => {
    const cues = [tone('a'), tone('x', { listId: 'fx' })]
    const { runner, clearAllRunning, setRunning } = setup(cues, { selected: 'a' })
    runner.go()
    runner.goById('x')
    await vi.advanceTimersByTimeAsync(100)
    engine.stop.mockClear()
    runner.operatorStop()
    expect(engine.stop).toHaveBeenCalledWith('a', 0)
    expect(engine.stop).not.toHaveBeenCalledWith('x', expect.anything())
    expect(engine.stopAll).not.toHaveBeenCalled()
    expect(clearAllRunning).not.toHaveBeenCalled()
    expect(setRunning).toHaveBeenLastCalledWith('a', null)
  })

  it('is the whole show’s STOP when nothing outside the list on screen is running', async () => {
    const cues = [tone('a'), tone('x', { listId: 'fx' })]
    const { runner } = setup(cues, { selected: 'a' })
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    runner.operatorStop()
    expect(engine.stopAll).toHaveBeenCalledWith(0)
  })

  it('fades the list over the show’s STOP fade, and cuts it on a second press', async () => {
    const cues = [tone('a'), tone('b'), tone('x', { listId: 'fx' })]
    const { runner } = setup(cues, { selected: 'a', stopFadeMs: 1500 })
    runner.go()
    runner.goById('x')
    await vi.advanceTimersByTimeAsync(100)
    engine.stop.mockClear()
    runner.operatorStop()
    expect(engine.stop).toHaveBeenCalledWith('a', 1500)
    runner.goById('b')
    await vi.advanceTimersByTimeAsync(100)
    engine.stop.mockClear()
    runner.operatorStop()
    expect(engine.stop).toHaveBeenCalledWith('b', 0)
    expect(engine.stop).not.toHaveBeenCalledWith('x', expect.anything())
  })

  it('stops a list a remote names, groups and all', async () => {
    const group = { ...createCue('group'), id: 'G', listId: 'fx' } as Cue
    const child = tone('g1', { parentId: 'G' })
    const cues = [tone('a'), group, child]
    const { runner } = setup(cues, { selected: 'a' })
    runner.go()
    runner.goById('G')
    await vi.advanceTimersByTimeAsync(100)
    engine.stop.mockClear()
    expect(runner.stopList('fx')).toBeGreaterThan(0)
    expect(engine.stop).toHaveBeenCalledWith('g1', 0)
    expect(engine.stop).not.toHaveBeenCalledWith('a', expect.anything())
  })
})
