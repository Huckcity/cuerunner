// What a remote's list addresses do to a show of several lists, against a recording of the
// runner's verbs: which list it finds, what it presses on it, and what the log keeps.
import { describe, it, expect, vi } from 'vitest'
import { runRemote, type RemoteDeps } from './oscRemote'
import { createCue } from '../utils/cueDefaults'
import type { Cue } from '../../../shared/cue'
import { defaultCueLists, type CueListInfo } from '../../../shared/cueLists'

function cueOf(number: string, listId?: string): Cue {
  const id = listId ? `${listId}-${number}` : `id-${number}`
  return { ...createCue('wait', number), id, name: `Cue ${number}`, ...(listId ? { listId } : {}) } as Cue
}

const LISTS: CueListInfo[] = [...defaultCueLists(), { id: 'fx', name: 'Effects' }]

function harness(cues: Cue[], selected: string | null = null) {
  let selection = selected
  let active = 'main'
  const playheads = new Map<string, string | null>()
  const deps = {
    getCues: () => cues,
    getSelected: () => selection,
    getCollapsed: () => new Set<string>(),
    select: vi.fn((id: string | null) => { selection = id }),
    go: vi.fn(),
    stop: vi.fn(),
    goById: vi.fn(),
    seekCue: vi.fn(),
    pauseAll: vi.fn(),
    resumeAll: vi.fn(),
    togglePause: vi.fn(),
    pauseCue: vi.fn((_: string) => true),
    resumeCue: vi.fn((_: string) => true),
    togglePauseCue: vi.fn((_: string) => true),
    log: vi.fn(),
    getCueLists: () => LISTS,
    getActiveListId: () => active,
    setActiveList: vi.fn((listId: string) => { active = listId }),
    goList: vi.fn(),
    stopList: vi.fn(),
    setListArmed: vi.fn(),
    setListPlayhead: vi.fn((listId: string, cueId: string | null) => { playheads.set(listId, cueId) }),
    getListPlayhead: (listId: string) => playheads.get(listId) ?? null
  } satisfies RemoteDeps
  return { deps, active: () => active }
}

const SOURCE = 'OSC from 10.0.0.5:53001'
const lines = (deps: { log: ReturnType<typeof vi.fn> }): string[] =>
  deps.log.mock.calls.map(([entry]) => (entry as { message: string }).message)

describe('runRemote, for a show of several lists', () => {
  const show = [cueOf('1'), cueOf('1', 'fx'), cueOf('2', 'fx')]

  it('presses GO and STOP on a list by name, and says which list', () => {
    const { deps } = harness(show)
    runRemote({ kind: 'list', list: 'effects', verb: 'go' }, deps, SOURCE)
    runRemote({ kind: 'list', list: '2', verb: 'stop' }, deps, SOURCE)
    expect(deps.goList).toHaveBeenCalledWith('fx')
    expect(deps.stopList).toHaveBeenCalledWith('fx')
    expect(lines(deps)).toEqual([`GO on “Effects” from ${SOURCE}`, `STOP on “Effects” from ${SOURCE}`])
  })

  it('brings a list to the front, arms and disarms it', () => {
    const { deps, active } = harness(show)
    runRemote({ kind: 'list', list: 'fx', verb: 'select' }, deps, SOURCE)
    expect(active()).toBe('fx')
    runRemote({ kind: 'list', list: 'fx', verb: 'disarm' }, deps, SOURCE)
    runRemote({ kind: 'list', list: 'fx', verb: 'arm' }, deps, SOURCE)
    expect(deps.setListArmed.mock.calls).toEqual([['fx', false], ['fx', true]])
  })

  it('moves a list’s own playhead with next and previous, leaving the one on screen alone', () => {
    const { deps } = harness(show, 'id-1')
    runRemote({ kind: 'list', list: 'fx', verb: 'next' }, deps, SOURCE)
    expect(deps.setListPlayhead).toHaveBeenLastCalledWith('fx', 'fx-1')
    runRemote({ kind: 'list', list: 'fx', verb: 'next' }, deps, SOURCE)
    expect(deps.setListPlayhead).toHaveBeenLastCalledWith('fx', 'fx-2')
    expect(deps.select).not.toHaveBeenCalled()
  })

  it('says so when no list answers to the name', () => {
    const { deps } = harness(show)
    runRemote({ kind: 'list', list: 'Interval', verb: 'go' }, deps, SOURCE)
    expect(deps.goList).not.toHaveBeenCalled()
    expect(lines(deps)).toEqual([`${SOURCE}: no cue list “Interval” in this show`])
  })

  it('reads /cue_id/{list id}/go as GO on that list, the way QLab counts a list as a cue', () => {
    const { deps } = harness(show)
    runRemote({ kind: 'cue-go', cue: { by: 'id', id: 'fx' } }, deps, SOURCE)
    expect(deps.goList).toHaveBeenCalledWith('fx')
    runRemote({ kind: 'cue-start', cue: { by: 'id', id: 'fx-2' } }, deps, SOURCE)
    expect(deps.goById).toHaveBeenCalledWith('fx-2')
  })

  it('finds a cue number in the list on screen first, where two lists use the same number', () => {
    const { deps } = harness(show)
    runRemote({ kind: 'cue-start', cue: { by: 'number', number: '1' } }, deps, SOURCE)
    expect(deps.goById).toHaveBeenLastCalledWith('id-1')
    runRemote({ kind: 'list', list: 'fx', verb: 'select' }, deps, SOURCE)
    runRemote({ kind: 'cue-start', cue: { by: 'number', number: '1' } }, deps, SOURCE)
    expect(deps.goById).toHaveBeenLastCalledWith('fx-1')
  })

  it('walks the list on screen with /select/next, not the whole show', () => {
    const fxFirst = [cueOf('1', 'fx'), cueOf('2'), cueOf('3', 'fx')]
    const { deps } = harness(fxFirst, 'id-2')
    runRemote({ kind: 'select-previous' }, deps, SOURCE)
    expect(deps.select).toHaveBeenLastCalledWith('id-2')
  })
})
