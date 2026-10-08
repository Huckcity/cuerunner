import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './index'
import { buildWorkspace } from '../utils/workspace'
import { witnessSave } from '../utils/saveWitness'
import type { Cue } from '../../../shared/cue'
import type { Workspace } from '../../../shared/workspace'

function resetStore() {
  useStore.setState({
    cues: [],
    workspaceName: 'Untitled',
    workspacePath: null,
    // The file's own history: a case that sets one must not leak into the next.
    showHistory: [],
    isDirty: false,
    selectedId: null,
    running: new Map()
  })
}

/** The session as a save carries it out, for the witness to compare against. */
function savedShape(): Workspace {
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
    cues: s.cues
  })
}

const fakeCues: Cue[] = [
  {
    id: 'c1', number: '1', name: 'House to half', type: 'wait',
    colorLabel: 'orange', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 3000,
    advance: 'none', isArmed: true, notes: ''
  },
  {
    id: 'c2', number: '2', name: 'Scene 1 music', type: 'wait',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 5000,
    advance: 'none', isArmed: true, notes: ''
  }
]

describe('store — isDirty tracking', () => {
  beforeEach(resetStore)

  it('starts clean', () => {
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('addCue marks dirty', () => {
    useStore.getState().addCue('wait')
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('removeCue marks dirty', () => {
    useStore.getState().addCue('wait')
    useStore.setState({ isDirty: false })
    const id = useStore.getState().cues[0].id
    useStore.getState().removeCues([id])
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('updateCue marks dirty', () => {
    useStore.getState().addCue('wait')
    useStore.setState({ isDirty: false })
    const id = useStore.getState().cues[0].id
    useStore.getState().updateCue(id, { name: 'New name' })
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('moveCue marks dirty', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')
    useStore.setState({ isDirty: false })
    useStore.getState().moveCue(1, 0)
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('duplicateCue marks dirty', () => {
    useStore.getState().addCue('wait')
    useStore.setState({ isDirty: false })
    const id = useStore.getState().cues[0].id
    useStore.getState().duplicateCues([id])
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('setWorkspaceName marks dirty', () => {
    useStore.getState().setWorkspaceName('My Show')
    expect(useStore.getState().isDirty).toBe(true)
  })
})

describe('store — loadWorkspace', () => {
  beforeEach(resetStore)

  it('replaces cues with loaded ones', () => {
    useStore.getState().addCue('wait') // pre-existing
    useStore.getState().loadWorkspace(fakeCues, 'My Show', '/shows/my-show.cuerunner')
    expect(useStore.getState().cues).toHaveLength(2)
    expect(useStore.getState().cues[0].name).toBe('House to half')
  })

  it('sets workspace name and path', () => {
    useStore.getState().loadWorkspace(fakeCues, 'My Show', '/shows/my-show.cuerunner')
    expect(useStore.getState().workspaceName).toBe('My Show')
    expect(useStore.getState().workspacePath).toBe('/shows/my-show.cuerunner')
  })

  it('clears dirty flag after load', () => {
    useStore.getState().addCue('wait') // makes dirty
    useStore.getState().loadWorkspace(fakeCues, 'My Show', '/shows/my-show.cuerunner')
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('selects the first cue on load', () => {
    useStore.getState().loadWorkspace(fakeCues, 'My Show', '/shows/my-show.cuerunner')
    expect(useStore.getState().selectedId).toBe('c1')
  })

  it('sets selectedId to null if loaded with empty cue list', () => {
    useStore.getState().loadWorkspace([], 'Empty Show', null)
    expect(useStore.getState().selectedId).toBeNull()
  })

  it('clears running state on load', () => {
    useStore.setState({ running: new Map([['old', { cueId: 'old', state: 'playing', startedAt: 0, progress: 0 }]]) })
    useStore.getState().loadWorkspace(fakeCues, 'My Show', null)
    expect(useStore.getState().running.size).toBe(0)
  })
})


describe('store — saveSucceeded', () => {
  beforeEach(resetStore)

  it('clears dirty flag', () => {
    useStore.getState().addCue('wait')
    useStore.getState().saveSucceeded('/shows/my-show.cuerunner', 'My Show', [])
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('stays dirty when an edit landed after the save went out', () => {
    useStore.getState().addCue('wait')
    // What the save carried out, before the second cue landed: the witness compares the
    // session against exactly this.
    const sent = savedShape()
    useStore.getState().addCue('wait')
    // The name the store already has: the only thing that can report here is the cue
    // edit, not the save adopting a name it was handed.
    useStore.getState().saveSucceeded('/shows/hamlet.cuerunner', useStore.getState().workspaceName, [])
    witnessSave(sent)
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('updates path and name', () => {
    useStore.getState().saveSucceeded('/new/path.cuerunner', 'Renamed', [])
    expect(useStore.getState().workspacePath).toBe('/new/path.cuerunner')
    expect(useStore.getState().workspaceName).toBe('Renamed')
  })

  it('stays dirty when the show was renamed while the save was out', () => {
    // The file was written with the name the save carried out, and the operator typed
    // another one while it was in the air. Renaming is not an undo step, so only the
    // witness's comparison of the saved shape sees it.
    const sent = savedShape()
    useStore.getState().setWorkspaceName('Hamlet (revised)')

    // The save finishes, adopting the name the store has now rather than the sent one.
    useStore.getState().saveSucceeded('/shows/hamlet.cuerunner', useStore.getState().workspaceName, [])
    witnessSave(sent)

    expect(useStore.getState().workspaceName).toBe('Hamlet (revised)')
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('carries the history the file was written with, so the next save appends to it', () => {
    const entry = { at: '2026-09-16T10:00:00.000Z', by: 'adam', cues: [], settings: [] }
    useStore.getState().saveSucceeded('/shows/hamlet.cuerunner', 'Hamlet', [entry])

    expect(useStore.getState().showHistory).toEqual([entry])
  })
})

describe('store — the showfile’s own history', () => {
  beforeEach(resetStore)

  it('adopts the history of the file it loads', () => {
    const entry = { at: '2026-09-14T18:00:00.000Z', by: 'associate', cues: [], settings: ['name'] }
    useStore.getState().loadWorkspace(
      [], 'Hamlet', '/shows/hamlet.cuerunner', undefined, undefined, undefined, undefined, undefined,
      [entry]
    )

    expect(useStore.getState().showHistory).toEqual([entry])
  })

  it('starts a show with an empty history, and adopts one when a file has it', () => {
    expect(useStore.getState().showHistory).toEqual([])

    // A file written before the history existed has none, and a load says so rather than
    // carrying the last show's.
    useStore.getState().saveSucceeded('/shows/other.cuerunner', 'Other', [
      { at: '2026-09-15T00:00:00.000Z', by: 'adam', cues: [], settings: [] }
    ])
    useStore.getState().loadWorkspace([], 'Untitled', null)

    expect(useStore.getState().showHistory).toEqual([])
  })
})

describe('store — the show’s identity', () => {
  beforeEach(resetStore)

  const loaded = { id: 'w-my-show', createdAt: '2026-01-01T00:00:00.000Z' }

  it('is adopted from the file that is opened', () => {
    useStore.getState().loadWorkspace(fakeCues, 'My Show', '/shows/my-show.cuerunner', undefined, undefined, undefined, loaded)

    expect(useStore.getState().workspaceId).toBe('w-my-show')
    expect(useStore.getState().workspaceCreatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('is minted for a new show, not inherited from the last one', () => {
    useStore.getState().loadWorkspace(fakeCues, 'My Show', '/shows/my-show.cuerunner', undefined, undefined, undefined, loaded)

    useStore.getState().loadWorkspace([], 'Untitled', null)

    const { workspaceId, workspaceCreatedAt } = useStore.getState()
    expect(workspaceId).not.toBe('w-my-show')
    expect(workspaceId).not.toBe('')
    expect(Number.isNaN(Date.parse(workspaceCreatedAt))).toBe(false)
  })

  it('survives editing the show', () => {
    useStore.getState().loadWorkspace(fakeCues, 'My Show', '/shows/my-show.cuerunner', undefined, undefined, undefined, loaded)

    useStore.getState().updateCue('c1', { name: 'Renamed' })

    expect(useStore.getState().workspaceId).toBe('w-my-show')
    expect(useStore.getState().workspaceCreatedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})
