// Two versions of a show of several lists, merged: the lists are a section and blend as one, a
// cue's list is a field and blends as one, and no merged cue is left naming a list the merged
// show does not have.
import { describe, expect, it } from 'vitest'
import type { Cue, WaitCue } from './cue'
import type { Workspace } from './workspace'
import { mergeWorkspaces } from './showfileMerge'
import { diffWorkspaces } from './showfile'
import { cuesOfList, defaultCueLists, type CueListInfo } from './cueLists'

function cue(id: string, over: Partial<WaitCue> = {}): Cue {
  return {
    id, number: id, name: id, colorLabel: 'none', parentId: null, preWait: 0, postWait: 0,
    timelineOffset: 0, duration: 0, advance: 'none', isArmed: true, notes: '', type: 'wait', ...over
  }
}

function show(cues: Cue[], cueLists?: CueListInfo[]): Workspace {
  return {
    version: 1, id: 'w', name: 'Show', createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' }, midiSettings: { outputPortName: '' },
    ...(cueLists ? { cueLists } : {}),
    cues
  }
}

const FX: CueListInfo[] = [...defaultCueLists(), { id: 'fx', name: 'Effects' }]
const ids = (cues: readonly Cue[]): string[] => cues.map(entry => entry.id)

describe('merging shows of several lists', () => {
  it('takes a list the other side added, with the cue it moved into it', () => {
    const base = show([cue('1'), cue('2')])
    const ours = show([cue('1', { name: 'Walk-in' }), cue('2')])
    const theirs = show([cue('1'), cue('2', { listId: 'fx' })], FX)
    const { workspace } = mergeWorkspaces(base, ours, theirs)
    expect(workspace.cueLists).toEqual(FX)
    expect(ids(cuesOfList(workspace.cues, 'fx'))).toEqual(['2'])
    expect(workspace.cues[0].name).toBe('Walk-in')
  })

  it('returns a cue to the main list when the list it was moved into is not in the merged show', () => {
    const base = show([cue('1'), cue('2')], FX)
    const ours = show([cue('1'), cue('2')])
    const theirs = show([cue('1'), cue('2', { listId: 'fx' })], FX)
    const { workspace, notes } = mergeWorkspaces(base, ours, theirs)
    expect(workspace.cueLists).toBeUndefined()
    expect(workspace.cues.find(c => c.id === '2')).not.toHaveProperty('listId')
    expect(notes.map(note => note.detail)).toContain('its cue list is not in the merged show: placed in the main list')
  })

  it('reports a cue moved to another list as a change to that cue, and the lists as a setting', () => {
    const before = show([cue('1'), cue('2')])
    const after = show([cue('1'), cue('2', { listId: 'fx' })], FX)
    const diff = diffWorkspaces(before, after)
    expect(diff.changed.map(change => change.id)).toEqual(['2'])
    expect(diff.settings.map(setting => setting.path)).toEqual(['lists'])
  })
})
