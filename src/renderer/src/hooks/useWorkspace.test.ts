// The load notes a damaged bundle carries have to reach the store. `importShowBundle`
// is where the bundle channel's answer is turned into a loaded show, and a dropped
// `loadNotes` there would repair the grouping silently — exactly what the note exists to
// prevent.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useStore } from '../store'
import { importShowBundle, useWorkspace } from './useWorkspace'
import type { Cue } from '../../../shared/cue'
import type { ShowHistoryEntry } from '../../../shared/showfile'
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

// `save` and `saveAs` build their payload before the disk answers. An edit landing while
// the write is out is not in the bytes, so the round trip's witness has to keep it
// unsaved; a round trip nothing moved under has to leave the session clean. The bridge
// promise is held by the test, so the window the real write takes is exact.
describe('useWorkspace — the write is witnessed when it answers', () => {
  let container: HTMLDivElement
  let root: Root
  let startSave: () => Promise<boolean>
  let startSaveAs: () => Promise<boolean>

  function Harness(): null {
    const workspace = useWorkspace()
    startSave = workspace.save
    startSaveAs = workspace.saveAs
    return null
  }

  /** The two save flows a test drives, by the action it names. */
  const flows: Record<'save' | 'saveAs', () => Promise<boolean>> = {
    save: () => startSave(),
    saveAs: () => startSaveAs()
  }

  /** A fresh session, with the saved-shape fields cleared for the next flow. */
  function resetSession(): void {
    useStore.setState({
      cues: [],
      isDirty: false,
      workspaceName: 'Untitled',
      workspacePath: null,
      showHistory: [],
      past: [],
      future: [],
      selectedId: null,
      selectedIds: [],
      selectionAnchorId: null
    })
  }

  /**
   * Holds the flow's bridge promise until the returned function releases it: the write
   * stays in flight, which is the window an edit can land in. What it releases is
   * whatever the save answered — a saved file, or the null the prompt's Abandon gives.
   */
  function hold(
    flow: 'save' | 'saveAs'
  ): (saved: { path: string; history: ShowHistoryEntry[] } | null) => void {
    const gate = Promise.withResolvers<{ path: string; history: ShowHistoryEntry[] } | null>()
    ;(window.cuerunner.workspace[flow] as unknown as Mock).mockImplementation(() => gate.promise)
    return gate.resolve
  }

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(resetSession)
    ;(window.cuerunner.workspace.save as unknown as Mock).mockReset()
    ;(window.cuerunner.workspace.saveAs as unknown as Mock).mockReset()
    act(() => { root.render(createElement(Harness)) })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps the session dirty when an edit lands while the write is out', async () => {
    const clearRecovery = window.cuerunner.workspace.clearRecovery as unknown as Mock
    for (const flow of ['save', 'saveAs'] as const) {
      clearRecovery.mockClear()
      act(() => {
        resetSession()
        useStore.getState().addCue('wait')
      })
      const release = hold(flow)
      let pending!: Promise<boolean>
      act(() => { pending = flows[flow]() })
      // The edit lands after the payload went out: whatever the round trip answers, the
      // file it wrote does not carry this cue.
      act(() => { useStore.getState().addCue('wait') })
      await act(async () => {
        release({ path: '/shows/witness.cuerunner', history: [] })
        await pending
      })
      expect(useStore.getState().isDirty, `${flow} left an edit unsaved`).toBe(true)
      // The snapshot is that cue's only copy: unsaved work keeps it.
      expect(clearRecovery, `${flow} cleared the recovery snapshot over unsaved work`)
        .not.toHaveBeenCalled()
    }
  })

  it('leaves the session clean when nothing changed while the write was out', async () => {
    const clearRecovery = window.cuerunner.workspace.clearRecovery as unknown as Mock
    for (const flow of ['save', 'saveAs'] as const) {
      clearRecovery.mockClear()
      act(() => {
        resetSession()
        useStore.getState().addCue('wait')
      })
      const release = hold(flow)
      let pending!: Promise<boolean>
      act(() => { pending = flows[flow]() })
      await act(async () => {
        release({ path: '/shows/witness.cuerunner', history: [] })
        await pending
      })
      expect(useStore.getState().isDirty, `${flow} marked a clean round trip dirty`).toBe(false)
      expect(useStore.getState().workspacePath).toBe('/shows/witness.cuerunner')
      // Nothing is unsaved, so the crash-recovery copy has done its job.
      expect(clearRecovery, `${flow} left the snapshot behind after a clean round trip`)
        .toHaveBeenCalledTimes(1)
    }
  })

  it('refuses a save whose show was replaced while the write was out', async () => {
    const clearRecovery = window.cuerunner.workspace.clearRecovery as unknown as Mock
    for (const flow of ['save', 'saveAs'] as const) {
      clearRecovery.mockClear()
      act(() => {
        resetSession()
        useStore.getState().addCue('wait')
      })
      const release = hold(flow)
      let pending!: Promise<boolean>
      act(() => { pending = flows[flow]() })
      // Another show is loaded, and edited, before the write answers: the answer belongs
      // to the show that was on screen when it went out.
      act(() => {
        useStore.getState().loadWorkspace(
          [], 'Another Show', '/shows/another.cuerunner', undefined, undefined, undefined,
          { id: `w-replaced-${flow}`, createdAt: '2026-09-19T00:00:00.000Z' }
        )
        useStore.getState().setWorkspaceName('Another Show (edited)')
      })
      let result: boolean | undefined
      await act(async () => {
        release({ path: '/shows/witness.cuerunner', history: [] })
        result = await pending
      })
      // The loaded show keeps its own file and its unsaved work: the old save adopts
      // neither its path over the loaded show's, nor the loaded show's edits as saved.
      expect(result, `${flow} claimed a save it did not make`).toBe(false)
      expect(useStore.getState().workspacePath).toBe('/shows/another.cuerunner')
      expect(useStore.getState().workspaceName).toBe('Another Show (edited)')
      expect(useStore.getState().isDirty, `${flow} cleared the loaded show's work`).toBe(true)
      expect(clearRecovery, `${flow} cleared a snapshot it must not touch`).not.toHaveBeenCalled()
    }
  })

  it('refuses the close when an edit landed while the close’s own save was out', async () => {
    const confirmDialog = window.cuerunner.workspace.confirmClose as unknown as Mock
    const confirmed = window.cuerunner.app.confirmClose as unknown as Mock
    const onCloseRequested = window.cuerunner.app.onCloseRequested as unknown as Mock
    confirmDialog.mockResolvedValue(0)          // Save: the arm a closing operator picks
    confirmed.mockClear()
    act(() => { useStore.getState().addCue('wait') })

    const close = onCloseRequested.mock.calls.at(-1)![0] as () => Promise<void>
    const release = hold('save')
    let closing!: Promise<void>
    act(() => { closing = close() })
    act(() => { useStore.getState().addCue('wait') })
    await act(async () => {
      release({ path: '/shows/witness.cuerunner', history: [] })
      await closing
    })

    // The save answered without the second cue, so the close is refused rather than
    // taking the window down on work that is not on disk.
    expect(confirmed).not.toHaveBeenCalled()
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('refuses the close when the save was abandoned at the prompt', async () => {
    // The changed-file prompt's Abandon answers null, the same not-saved answer a cancelled
    // dialog gives. The window must stay up with the work still unsaved: a close that did
    // not save is a close that loses the show.
    const confirmDialog = window.cuerunner.workspace.confirmClose as unknown as Mock
    const confirmed = window.cuerunner.app.confirmClose as unknown as Mock
    const onCloseRequested = window.cuerunner.app.onCloseRequested as unknown as Mock
    confirmDialog.mockResolvedValue(0)
    confirmed.mockClear()
    act(() => { useStore.getState().addCue('wait') })

    const close = onCloseRequested.mock.calls.at(-1)![0] as () => Promise<void>
    const release = hold('save')
    let closing!: Promise<void>
    act(() => { closing = close() })
    await act(async () => {
      release(null)
      await closing
    })

    expect(confirmed).not.toHaveBeenCalled()
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('closes when the close prompt’s save carried everything', async () => {
    const confirmDialog = window.cuerunner.workspace.confirmClose as unknown as Mock
    const confirmed = window.cuerunner.app.confirmClose as unknown as Mock
    const onCloseRequested = window.cuerunner.app.onCloseRequested as unknown as Mock
    confirmDialog.mockResolvedValue(0)
    confirmed.mockClear()
    act(() => { useStore.getState().addCue('wait') })

    const close = onCloseRequested.mock.calls.at(-1)![0] as () => Promise<void>
    const release = hold('save')
    let closing!: Promise<void>
    act(() => { closing = close() })
    await act(async () => {
      release({ path: '/shows/witness.cuerunner', history: [] })
      await closing
    })

    expect(confirmed).toHaveBeenCalledTimes(1)
    expect(useStore.getState().isDirty).toBe(false)
  })
})
