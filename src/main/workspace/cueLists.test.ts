// A show's cue lists through the load funnel and the serialiser: a file's lists are read
// field by field and refused by name when they are not this build's shape, a cue naming a list
// the file does not have is repaired into the main list and said so, and a show with only its
// main list writes no section — so a show saved before lists existed saves byte-identical.
import { describe, it, expect, vi } from 'vitest'
import type { CueBase, GroupCue, WaitCue } from '../../shared/cue'
import type { LoadNote, Workspace } from '../../shared/workspace'
import { Refusal } from '../ipc/refusal'
import { migrateWorkspace } from './WorkspaceManager'
import { serialiseWorkspace } from './serialise'

vi.mock('electron', () => ({ app: {}, dialog: {}, BrowserWindow: {} }))

const SHOW = '/shows/Press Night.cuerunner'

function base(id: string): Omit<CueBase, 'triggers' | 'refire' | 'scriptLine' | 'listId'> {
  return {
    id, number: id, name: id, colorLabel: 'none', parentId: null, preWait: 0, postWait: 0,
    timelineOffset: 0, duration: 0, advance: 'none', isArmed: true, notes: ''
  }
}

const wait = (id: string, over: Partial<WaitCue> = {}): WaitCue => ({ ...base(id), type: 'wait', ...over })
const group = (id: string, over: Partial<GroupCue> = {}): GroupCue => ({ ...base(id), type: 'group', mode: 'sequence', ...over })

function show(over: Partial<Workspace> = {}): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Press Night',
    createdAt: '2024-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [],
    ...over
  }
}

const LISTS = [{ id: 'main', name: 'Main Cue List' }, { id: 'fx', name: 'Effects', cart: true }]

describe('a file’s cue lists through the funnel', () => {
  it('reads a show of several lists as it was written', () => {
    const loaded = migrateWorkspace(show({ cueLists: LISTS, cues: [wait('1'), wait('x', { listId: 'fx' })] }), SHOW)
    expect(loaded.cueLists).toEqual(LISTS)
    expect(loaded.cues[1].listId).toBe('fx')
  })

  const refused: Array<{ what: string; lists: unknown; fact: string }> = [
    {
      what: 'a list with a field this build does not write',
      lists: [{ id: 'main', name: 'Main Cue List', autoload: true }],
      fact: 'a field this version of Cuerunner does not know (cueLists.0.autoload)'
    },
    { what: 'a list with no name', lists: [{ id: 'main' }], fact: 'no cueLists.0.name field' },
    { what: 'a section that is not a list', lists: { main: 'Main' }, fact: 'cueLists as an object' },
    { what: 'two lists with one id', lists: [LISTS[0], { id: 'main', name: 'Again' }], fact: 'two cue lists with the id “main”' },
    { what: 'no main list', lists: [{ id: 'fx', name: 'Effects' }], fact: 'no main cue list' },
    {
      what: 'a list offset past the clock’s range',
      lists: [LISTS[0], { id: 'fx', name: 'Effects', timecode: { enabled: true, offsetFrames: 1e12 } }],
      fact: 'cueLists.1.timecode.offsetFrames as a number'
    }
  ]
  for (const entry of refused) {
    it(`refuses ${entry.what}, naming the fact and the file`, () => {
      const document = show({ cueLists: entry.lists as Workspace['cueLists'] })
      expect(() => migrateWorkspace(document, SHOW)).toThrow(Refusal)
      expect(() => migrateWorkspace(document, SHOW)).toThrow(entry.fact)
      expect(() => migrateWorkspace(document, SHOW)).toThrow(SHOW)
    })
  }

  it('returns a cue naming a list the file does not have to the main list, and notes it', () => {
    const notes: LoadNote[] = []
    const loaded = migrateWorkspace(show({ cueLists: LISTS, cues: [wait('1', { listId: 'gone' })] }), SHOW, notes)
    expect(loaded.cues[0]).not.toHaveProperty('listId')
    expect(notes).toEqual([expect.objectContaining({ cueId: '1', kind: 'missing-list' })])
  })

  it('takes a list name off a child, which runs in its group’s list, and notes it', () => {
    const notes: LoadNote[] = []
    const loaded = migrateWorkspace(show({
      cueLists: LISTS,
      cues: [group('G', { listId: 'fx' }), wait('g1', { parentId: 'G', listId: 'main' })]
    }), SHOW, notes)
    expect(loaded.cues[1]).not.toHaveProperty('listId')
    expect(notes).toEqual([expect.objectContaining({ cueId: 'g1', kind: 'list-in-group' })])
  })

  it('takes the main list’s own name off a cue without a note: it says what saying nothing says', () => {
    const notes: LoadNote[] = []
    const loaded = migrateWorkspace(show({ cues: [wait('1', { listId: 'main' })] }), SHOW, notes)
    expect(loaded.cues[0]).not.toHaveProperty('listId')
    expect(notes).toEqual([])
  })

  it('places a cue the grouping repair lifted out of a missing group in the main list', () => {
    const notes: LoadNote[] = []
    const loaded = migrateWorkspace(show({ cueLists: LISTS, cues: [wait('g1', { parentId: 'nowhere' })] }), SHOW, notes)
    expect(loaded.cues[0]).toMatchObject({ parentId: null })
    expect(loaded.cues[0]).not.toHaveProperty('listId')
  })
})

describe('a file’s cue lists through the serialiser', () => {
  it('writes the section after the timecode and before the cues, and a show without one writes none', () => {
    const withLists = JSON.parse(serialiseWorkspace(show({ cueLists: LISTS, cues: [wait('x', { listId: 'fx' })] }), '/shows'))
    const keys = Object.keys(withLists)
    expect(keys.indexOf('cueLists')).toBe(keys.indexOf('cues') - 1)
    expect(withLists.cues[0].listId).toBe('fx')
    expect(Object.keys(JSON.parse(serialiseWorkspace(show({ cues: [wait('1')] }), '/shows')))).not.toContain('cueLists')
  })

  it('saves an old show back byte-identical through the funnel', () => {
    const before = serialiseWorkspace(show({
      triggerGuard: { windowMs: 300 },
      cues: [wait('1'), group('G'), wait('g1', { parentId: 'G' })]
    }), '/shows')
    const after = serialiseWorkspace(migrateWorkspace(JSON.parse(before) as Workspace, SHOW), '/shows')
    expect(after).toBe(before)
  })
})
