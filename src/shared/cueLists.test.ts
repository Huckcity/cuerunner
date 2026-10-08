import { describe, expect, it } from 'vitest'
import type { Cue, WaitCue } from './cue'
import {
  canonicalCueList,
  cueListsRefusal,
  cuesOfList,
  defaultCueLists,
  findCueList,
  firstCueOfList,
  heldCueLists,
  isDefaultCueLists,
  listMembership,
  listOfCue,
  MAIN_CUE_LIST_ID,
  moveToList,
  newListName,
  settleListIds,
  withoutList
} from './cueLists'

function cue(id: string, parentId: string | null = null, listId?: string, type: 'wait' | 'group' = 'wait'): Cue {
  const base: WaitCue = {
    id, number: id, name: id, colorLabel: 'none', parentId, preWait: 0, postWait: 0,
    timelineOffset: 0, duration: 0, advance: 'none', isArmed: true, notes: '', type: 'wait'
  }
  const typed = type === 'group' ? ({ ...base, type: 'group', mode: 'sequence' } as Cue) : base
  return listId === undefined ? typed : { ...typed, listId }
}

const ids = (cues: readonly Cue[]): string[] => cues.map(entry => entry.id)

// Two lists interleaved in the array, with a group in each: the main list's 1, G (with g1, g2)
// and 2, and the effects list's x, H (with h1).
const SHOW: Cue[] = [
  cue('1'),
  cue('x', null, 'fx'),
  cue('G', null, undefined, 'group'),
  cue('g1', 'G'),
  cue('g2', 'G'),
  cue('H', null, 'fx', 'group'),
  cue('h1', 'H'),
  cue('2')
]

describe('the lists a show has', () => {
  it('is the main list alone when the file says nothing, and that is the default the file omits', () => {
    expect(heldCueLists(undefined)).toEqual(defaultCueLists())
    expect(isDefaultCueLists(defaultCueLists())).toBe(true)
    expect(isDefaultCueLists([{ id: MAIN_CUE_LIST_ID, name: 'Act One' }])).toBe(false)
    expect(isDefaultCueLists([...defaultCueLists(), { id: 'fx', name: 'Effects' }])).toBe(false)
    expect(isDefaultCueLists([{ id: MAIN_CUE_LIST_ID, name: 'Main Cue List', color: 'red' }])).toBe(false)
  })

  it('writes a list’s optional fields only where they say something, in one order', () => {
    expect(canonicalCueList({
      tileKeys: [], timecode: { offsetFrames: 0, enabled: true }, disarmed: false, cart: false, color: 'none',
      name: 'Effects', id: 'fx'
    })).toEqual({ id: 'fx', name: 'Effects' })
    const full = canonicalCueList({
      tileKeys: [{ key: 'q', cueId: 'x' }], timecode: { offsetFrames: 25, enabled: false }, disarmed: true,
      cart: true, color: 'blue', name: 'Effects', id: 'fx'
    })
    expect(Object.keys(full)).toEqual(['id', 'name', 'color', 'cart', 'disarmed', 'timecode', 'tileKeys'])
    expect(JSON.stringify(full.timecode)).toBe('{"enabled":false,"offsetFrames":25}')
  })

  it('refuses lists it cannot hold: none, an id twice, an empty id, no main list', () => {
    expect(cueListsRefusal(defaultCueLists())).toBeNull()
    expect(cueListsRefusal([])).toMatch(/empty/)
    expect(cueListsRefusal([...defaultCueLists(), { id: 'main', name: 'Again' }])).toMatch(/two cue lists/)
    expect(cueListsRefusal([...defaultCueLists(), { id: ' ', name: 'Blank' }])).toMatch(/no id/)
    expect(cueListsRefusal([{ id: 'fx', name: 'Effects' }])).toMatch(/no main cue list/)
  })
})

describe('which list a cue runs in', () => {
  it('reads a cue at the top level by the list it names, and a child by its group’s', () => {
    const membership = listMembership(SHOW)
    expect(Object.fromEntries(membership)).toEqual({
      1: 'main', x: 'fx', G: 'main', g1: 'main', g2: 'main', H: 'fx', h1: 'fx', 2: 'main'
    })
    expect(listOfCue(SHOW, 'h1')).toBe('fx')
    expect(listOfCue(SHOW, 'nope')).toBeNull()
  })

  it('walks one list’s running order with its groups whole, past the other list’s cues', () => {
    expect(ids(cuesOfList(SHOW, 'main'))).toEqual(['1', 'G', 'g1', 'g2', '2'])
    expect(ids(cuesOfList(SHOW, 'fx'))).toEqual(['x', 'H', 'h1'])
    expect(firstCueOfList(SHOW, 'fx')).toBe('x')
    expect(firstCueOfList(SHOW, 'empty')).toBeNull()
  })
})

describe('an edit settled into the lists', () => {
  it('puts a new cue in the list on screen, whatever list it was copied from', () => {
    const next = [...SHOW, cue('new'), cue('pasted', null, 'main')]
    const settled = settleListIds(SHOW, next, 'fx')
    expect(settled.find(c => c.id === 'new')?.listId).toBe('fx')
    expect(settled.find(c => c.id === 'pasted')?.listId).toBe('fx')
  })

  it('keeps a cue in its list when it leaves its group, and takes the name off one that joins a group', () => {
    const next = SHOW.map(c => c.id === 'h1' ? { ...c, parentId: null } : c.id === 'x' ? { ...c, parentId: 'H' } : c)
    const settled = settleListIds(SHOW, next, 'main')
    expect(settled.find(c => c.id === 'h1')?.listId).toBe('fx')
    expect(settled.find(c => c.id === 'x')).not.toHaveProperty('listId')
  })

  it('writes no list on a cue at the top level of the main list, and hands back the same array when nothing moved', () => {
    const next = SHOW.map(c => c.id === 'g1' ? { ...c, parentId: null } : c)
    const settled = settleListIds(SHOW, next, 'fx')
    expect(settled.find(c => c.id === 'g1')).not.toHaveProperty('listId')
    const same = SHOW.slice()
    expect(settleListIds(SHOW, same, 'fx')).toBe(same)
  })
})

describe('moving cues to another list', () => {
  it('takes a group with everything under it, to the end of the other list', () => {
    const moved = moveToList(SHOW, ['G'], 'fx')
    expect(ids(cuesOfList(moved, 'fx'))).toEqual(['x', 'H', 'h1', 'G', 'g1', 'g2'])
    expect(ids(cuesOfList(moved, 'main'))).toEqual(['1', '2'])
    expect(moved.find(c => c.id === 'G')?.listId).toBe('fx')
    expect(moved.find(c => c.id === 'g1')).not.toHaveProperty('listId')
  })

  it('lifts a child moved on its own out of its group, and carries one whose group moves too inside it', () => {
    const lifted = moveToList(SHOW, ['g2'], 'fx')
    expect(lifted.find(c => c.id === 'g2')).toMatchObject({ parentId: null, listId: 'fx' })
    const both = moveToList(SHOW, ['g1', 'G'], 'fx')
    expect(both.find(c => c.id === 'g1')).toMatchObject({ parentId: 'G' })
  })

  it('writes no list name on a cue moved back to the main list, and leaves cues already there alone', () => {
    const back = moveToList(SHOW, ['x', '1'], 'main')
    expect(back.find(c => c.id === 'x')).not.toHaveProperty('listId')
    expect(ids(cuesOfList(back, 'main'))).toEqual(['1', 'G', 'g1', 'g2', '2', 'x'])
    expect(moveToList(SHOW, ['1'], 'main')).toBe(SHOW)
  })

  it('deletes a list with every cue in it', () => {
    expect(ids(withoutList(SHOW, 'fx'))).toEqual(['1', 'G', 'g1', 'g2', '2'])
  })
})

describe('naming and finding a list', () => {
  const lists = [...defaultCueLists(), { id: 'fx-1', name: 'Effects' }, { id: 'pre', name: 'Pre-show' }]

  it('names a new list after the count, past any name already taken', () => {
    expect(newListName(defaultCueLists())).toBe('Cue List 2')
    expect(newListName([...defaultCueLists(), { id: 'a', name: 'Cue List 2' }])).toBe('Cue List 3')
    expect(newListName(defaultCueLists(), 'Cart')).toBe('Cart 2')
  })

  it('finds a list a remote names by id, by name in any case, or by its place', () => {
    expect(findCueList(lists, 'fx-1')?.name).toBe('Effects')
    expect(findCueList(lists, 'pre-SHOW')?.id).toBe('pre')
    expect(findCueList(lists, '1')?.id).toBe('main')
    expect(findCueList(lists, '3')?.id).toBe('pre')
    expect(findCueList(lists, '4')).toBeNull()
    expect(findCueList(lists, '')).toBeNull()
  })
})
