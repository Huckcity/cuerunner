// The load notes a damaged bundle carries have to reach the store. `importShowBundle`
// is where the bundle channel's answer is turned into a loaded show, and a dropped
// `loadNotes` there would repair the grouping silently — exactly what the note exists to
// prevent.
import { describe, it, expect, beforeEach, type Mock } from 'vitest'
import { useStore } from '../store'
import { importShowBundle } from './useWorkspace'
import type { Cue } from '../../../shared/cue'
import type { LoadNote, Workspace } from '../../../shared/workspace'

const notes: LoadNote[] = [
  {
    cueId: 'o1',
    kind: 'missing-group',
    detail: 'it has no group in this file: still fires with the show, at the top level'
  },
  {
    cueId: 'g1',
    kind: 'reordered',
    detail: 'its children were gathered into one block behind it'
  }
]

function waitCue(id: string, parentId: string | null): Cue {
  return {
    id, number: id, name: `Cue ${id}`, type: 'wait', colorLabel: 'none', parentId,
    preWait: 0, postWait: 0, timelineOffset: 0, duration: 1000,
    advance: 'none', isArmed: true, notes: ''
  }
}

/** The show the bundle's repaired showfile would come back as. */
function repaired(): Workspace {
  return {
    version: 1,
    id: 'w-broken',
    name: 'Broken Grouping',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [waitCue('g1', null), waitCue('c1', 'g1'), waitCue('o1', null)]
  }
}

const importBundle = (): Mock => window.cuerunner.workspace.importBundle as unknown as Mock

describe('importShowBundle', () => {
  beforeEach(() => {
    useStore.setState({
      cues: [],
      selectedId: null,
      isDirty: false,
      missingMedia: [],
      loadNotes: []
    })
    importBundle().mockReset()
  })

  it('sets the load notes a damaged bundle carries, beside its missing media', async () => {
    importBundle().mockResolvedValue({
      ok: true,
      imported: {
        path: '/shows/Broken Grouping.cuerunner',
        workspace: repaired(),
        missingMedia: [],
        loadNotes: notes
      }
    })

    await importShowBundle()

    const state = useStore.getState()
    expect(state.loadNotes).toEqual(notes)
    expect(state.workspacePath).toBe('/shows/Broken Grouping.cuerunner')
    // The workspace that reached the store is the repaired one.
    expect(state.cues.map(cue => [cue.id, cue.parentId])).toEqual([
      ['g1', null], ['c1', 'g1'], ['o1', null]
    ])
  })
})
