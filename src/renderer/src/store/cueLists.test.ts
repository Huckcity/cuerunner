// A show's cue lists in the store: each list keeps its own place, every edit lands in the list
// it was made in, every list operation is one undo, and a show with only its main list writes
// the bytes it always wrote.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './index'
import { buildWorkspace } from '../utils/workspace'
import type { Cue, WaitCue } from '../../../shared/cue'
import { cuesOfList, defaultCueLists, MAIN_CUE_LIST_ID, type CueListInfo } from '../../../shared/cueLists'
import type { Workspace } from '../../../shared/workspace'
import { settleCueListWrite } from './cueLists'

function cue(id: string, parentId: string | null = null, listId?: string, type: 'wait' | 'group' = 'wait'): Cue {
  const base: WaitCue = {
    id, number: id, name: id, colorLabel: 'none', parentId, preWait: 0, postWait: 0,
    timelineOffset: 0, duration: 0, advance: 'none', isArmed: true, notes: '', type: 'wait'
  }
  const typed = type === 'group' ? ({ ...base, type: 'group', mode: 'sequence' } as Cue) : base
  return listId === undefined ? typed : { ...typed, listId }
}

const LISTS: CueListInfo[] = [...defaultCueLists(), { id: 'fx', name: 'Effects' }]

function open(cues: Cue[], lists: CueListInfo[] | null = LISTS): void {
  useStore.getState().loadWorkspace(cues, 'Show', null, undefined, undefined, undefined, undefined, undefined, [],
    undefined, undefined, undefined, lists ?? undefined)
}

function saved(): Workspace {
  const s = useStore.getState()
  return buildWorkspace({
    id: s.workspaceId,
    name: s.workspaceName,
    createdAt: s.workspaceCreatedAt,
    history: s.showHistory,
    audioSettings: s.audioSettings,
    midiSettings: s.midiSettings,
    showSettings: s.showSettings,
    triggerGuard: s.triggerGuard,
    lighting: s.lighting,
    timecode: s.timecode,
    videoOutputs: s.videoOutputs,
    cueLists: s.cueLists,
    pictures: s.pictures,
    oscPatches: s.oscPatches,
    cues: s.cues
  })
}

const state = () => useStore.getState()
const ids = (cues: readonly Cue[]): string[] => cues.map(entry => entry.id)

beforeEach(() => {
  open([cue('1'), cue('x', null, 'fx'), cue('G', null, undefined, 'group'), cue('g1', 'G'), cue('y', null, 'fx'), cue('2')])
})

describe('opening a show of several lists', () => {
  it('opens on the first tab, standing on that list’s first cue', () => {
    expect(state().activeListId).toBe('main')
    expect(state().selectedId).toBe('1')
  })

  it('opens a show that says nothing about lists as its main list alone, and saves no section for it', () => {
    open([cue('1')], null)
    expect(state().cueLists).toEqual(defaultCueLists())
    expect(Object.keys(JSON.parse(JSON.stringify(saved())))).not.toContain('cueLists')
  })
})

describe('each list’s own place', () => {
  it('keeps where each list was left, and comes back to it', () => {
    state().select('2')
    state().setActiveList('fx')
    expect(state().selectedId).toBe('x')
    state().select('y')
    state().setActiveList('main')
    expect(state().selectedId).toBe('2')
    state().setActiveList('fx')
    expect(state().selectedId).toBe('y')
  })

  it('brings a list to the front when the hand lands in it — a remote’s select, a recovered place', () => {
    state().select('y')
    expect(state().activeListId).toBe('fx')
    expect(state().listCursors.main.selectedId).toBe('1')
  })

  it('reads and moves another list’s playhead without bringing it to the front', () => {
    expect(state().listPlayhead('fx')).toBe('x')
    state().setListPlayhead('fx', 'y')
    expect(state().activeListId).toBe('main')
    expect(state().listPlayhead('fx')).toBe('y')
    state().setListPlayhead('fx', null)
    expect(state().listPlayhead('fx')).toBeNull()
  })
})

describe('edits in a show of several lists', () => {
  it('adds a cue to the list on screen', () => {
    state().setActiveList('fx')
    state().addCue('wait', 'y')
    const added = state().cues.find(c => !['1', 'x', 'G', 'g1', 'y', '2'].includes(c.id))!
    expect(added.listId).toBe('fx')
    expect(ids(cuesOfList(state().cues, 'fx'))).toEqual(['x', 'y', added.id])
  })

  it('keeps a cue dragged out of a group in the group’s list, and takes the name off one dragged in', () => {
    open([cue('x', null, 'fx'), cue('H', null, 'fx', 'group'), cue('h1', 'H')])
    state().setActiveList('fx')
    const from = state().cues.findIndex(c => c.id === 'h1')
    state().moveCue(from, state().cues.length, null)
    expect(state().cues.find(c => c.id === 'h1')?.listId).toBe('fx')
    state().moveCue(0, state().cues.length, 'H')
    expect(state().cues.find(c => c.id === 'x')).not.toHaveProperty('listId')
  })

  it('moves a group to another list whole, keeps the hand in this one, and undoes as one edit', () => {
    state().select('G')
    state().moveCuesToList(['G'], 'fx')
    expect(ids(cuesOfList(state().cues, 'fx'))).toEqual(['x', 'y', 'G', 'g1'])
    expect(state().activeListId).toBe('main')
    expect(state().selectedId).toBe('2')
    state().undo()
    expect(ids(cuesOfList(state().cues, 'main'))).toEqual(['1', 'G', 'g1', '2'])
    state().redo()
    expect(ids(cuesOfList(state().cues, 'fx'))).toEqual(['x', 'y', 'G', 'g1'])
  })
})

describe('the list operations', () => {
  it('adds a list after the others and brings it to the front, empty; undo takes it away again', () => {
    state().addCueList()
    const added = state().cueLists[2]
    expect(added.name).toBe('Cue List 3')
    expect(state().activeListId).toBe(added.id)
    expect(state().selectedId).toBeNull()
    expect(state().isDirty).toBe(true)
    state().undo()
    expect(state().cueLists).toEqual(LISTS)
    expect(state().activeListId).toBe('main')
  })

  it('renames, colours, reorders, disarms and makes a cart of a list, each one undo', () => {
    state().updateCueList('fx', { name: '  Sound effects  ' })
    state().updateCueList('fx', { color: 'blue', cart: true, disarmed: true })
    state().moveCueList('fx', 0)
    expect(state().cueLists).toEqual([
      { id: 'fx', name: 'Sound effects', color: 'blue', cart: true, disarmed: true },
      { id: 'main', name: 'Main Cue List' }
    ])
    state().undo()
    expect(state().cueLists[0].id).toBe('main')
    state().undo()
    state().undo()
    expect(state().cueLists).toEqual(LISTS)
  })

  it('keeps the name a list had when it is renamed to nothing', () => {
    state().updateCueList('fx', { name: '   ' })
    expect(state().cueLists[1].name).toBe('Effects')
  })

  it('deletes a list with its cues and lands on the tab before it; undo brings both back', () => {
    state().setActiveList('fx')
    state().removeCueList('fx')
    expect(state().cueLists).toEqual(defaultCueLists())
    expect(ids(state().cues)).toEqual(['1', 'G', 'g1', '2'])
    expect(state().activeListId).toBe('main')
    state().undo()
    expect(state().cueLists).toEqual(LISTS)
    expect(ids(state().cues)).toContain('x')
  })

  it('never deletes the main list', () => {
    state().removeCueList(MAIN_CUE_LIST_ID)
    expect(state().cueLists).toEqual(LISTS)
  })

  it('saves the lists a show has, and a cue’s list beside it', () => {
    const file = saved()
    expect(file.cueLists).toEqual(LISTS)
    expect(file.cues.find(c => c.id === 'x')?.listId).toBe('fx')
    expect(file.cues.find(c => c.id === '1')).not.toHaveProperty('listId')
  })
})

describe('the settling rule, on its own', () => {
  it('hands a write back unchanged when it touches no cue and no place', () => {
    const write = { isDirty: true }
    expect(settleCueListWrite(state(), write)).toBe(write)
  })
})
