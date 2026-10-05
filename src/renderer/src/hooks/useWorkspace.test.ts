// The load notes a damaged bundle carries have to reach the store. `importShowBundle`
// is where the bundle channel's answer is turned into a loaded show, and a dropped
// `loadNotes` there would repair the grouping silently — exactly what the note exists to
// prevent.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { cueEngine } from '../engine/CueEngine'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useStore } from '../store'
import { importShowBundle, openDemoWorkspace, useWorkspace } from './useWorkspace'
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

// A show that replaces the one on screen takes over the engine too: every flow that loads
// one says so to the runner, and a flow that loaded nothing — a refusal — says nothing, so
// the show that is open goes on playing.
describe('useWorkspace — a show that is replaced stops playing', () => {
  let container: HTMLDivElement
  let root: Root
  let flows: ReturnType<typeof useWorkspace>

  function Harness(): null {
    flows = useWorkspace()
    return null
  }

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ cues: [], isDirty: false, workspaceName: 'Untitled', workspacePath: null, notice: null, log: [] })
    act(() => { root.render(createElement(Harness)) })
    vi.spyOn(cueEngine, 'stopForShowChange').mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  const opened = { path: '/shows/Broken Grouping.cuerunner', workspace: repaired(), missingMedia: [], loadNotes: [] }

  it('stops the runner before an opened file is loaded', async () => {
    vi.mocked(window.cuerunner.workspace.open).mockResolvedValue({ ok: true, opened })
    // The stop is said while the show that is leaving is still the one in the store.
    vi.mocked(cueEngine.stopForShowChange).mockImplementation(() => {
      expect(useStore.getState().workspaceName).toBe('Untitled')
    })

    await act(async () => { await flows.openWorkspace() })

    expect(cueEngine.stopForShowChange).toHaveBeenCalledTimes(1)
    expect(useStore.getState().workspaceName).toBe('Broken Grouping')
  })

  it('stops it for a recent file, the demo and a bundle', async () => {
    vi.mocked(window.cuerunner.workspace.openPath).mockResolvedValue({ ok: true, opened })
    vi.mocked(window.cuerunner.workspace.openDemo).mockResolvedValue({ ok: true, workspace: repaired() })
    importBundle().mockResolvedValue({ ok: true, imported: opened })

    await act(async () => { await flows.openRecent(opened.path) })
    await act(async () => { await openDemoWorkspace() })
    await act(async () => { await importShowBundle() })

    expect(cueEngine.stopForShowChange).toHaveBeenCalledTimes(3)
  })

  it('stops it for a new show', async () => {
    useStore.setState({ cues: [waitCue('c1', null)] })

    await act(async () => { await flows.newWorkspace() })

    expect(cueEngine.stopForShowChange).toHaveBeenCalledTimes(1)
    expect(useStore.getState().cues).toEqual([])
  })

  it('leaves the show playing when the file is refused, or the dialog is cancelled', async () => {
    vi.mocked(window.cuerunner.workspace.open).mockResolvedValue({ ok: false, error: 'that file is not a show' })
    await act(async () => { await flows.openWorkspace() })
    vi.mocked(window.cuerunner.workspace.open).mockResolvedValue({ ok: true, opened: null })
    await act(async () => { await flows.openWorkspace() })

    expect(cueEngine.stopForShowChange).not.toHaveBeenCalled()
  })
})

// The picked-file refusal as the operator reads it. Main refuses a file that is not a show
// with a sentence naming it; what the window has to show is that sentence, prefixed by the
// action it attempted — never the parse text the JSON reader produced on the way.
describe('useWorkspace — a file that is not a show', () => {
  let container: HTMLDivElement
  let root: Root
  let openWorkspace: () => Promise<void>

  function Harness(): null {
    openWorkspace = useWorkspace().openWorkspace
    return null
  }

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({
      cues: [],
      isDirty: false,
      workspaceName: 'Untitled',
      workspacePath: null,
      notice: null,
      log: []
    })
    act(() => { root.render(createElement(Harness)) })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('names the file and says it is not a show, with no parser text in the notice', async () => {
    const file = '/shows/Half Show.cuerunner'
    vi.mocked(window.cuerunner.workspace.open).mockResolvedValue({
      ok: false,
      error: `that file is not a show — ${file} is not JSON`
    })

    await act(async () => { await openWorkspace() })

    const state = useStore.getState()
    expect(state.notice).toBe(`Could not open the workspace: that file is not a show — ${file} is not JSON`)
    expect(state.notice).not.toContain('Unexpected token')
    // And the session log carries the same sentence, which is what outlives the notice.
    expect(state.log.map(entry => entry.message)).toContain(state.notice)
  })

  it('reports a refused demo the same way, and loads nothing in its place', async () => {
    // The demo is the app's own file and answers the same arm every other load does: the
    // sentence reaches the notice and the log, and the session keeps the show it had.
    const demo = '/app/resources/demo/Demo Show.cuerunner'
    vi.mocked(window.cuerunner.workspace.openDemo).mockResolvedValue({
      ok: false,
      error: `that show says version 2 and this build writes version 1 — ${demo} was probably saved by another build`
    })

    await act(async () => { await openDemoWorkspace() })

    const state = useStore.getState()
    expect(state.notice).toBe(
      `Could not open the demo workspace: that show says version 2 and this build writes version 1` +
      ` — ${demo} was probably saved by another build`
    )
    expect(state.log.map(entry => entry.message)).toContain(state.notice)
    // Nothing was loaded in its place: the session is still the untitled show it was.
    expect(state.workspaceName).toBe('Untitled')
    expect(state.cues).toEqual([])
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
   * whatever the save answered — a saved file, or the null the prompt's Abandon gives —
   * wrapped as the channel answers it, since a save reports a refusal in the same shape.
   */
  function hold(
    flow: 'save' | 'saveAs'
  ): (saved: { path: string; history: ShowHistoryEntry[]; name?: string } | null) => void {
    const gate = Promise.withResolvers<{ path: string; history: ShowHistoryEntry[]; name?: string } | null>()
    ;(window.cuerunner.workspace[flow] as unknown as Mock).mockImplementation(() =>
      gate.promise.then(saved => ({ ok: true as const, saved }))
    )
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

  it('takes the name a first save gave the show, and stays clean', async () => {
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
        // Main named the untitled show after the file, and wrote that name into it.
        release({ path: '/shows/Macbeth.cuerunner', history: [], name: 'Macbeth' })
        await pending
      })
      expect(useStore.getState().workspaceName, `${flow} left the show untitled`).toBe('Macbeth')
      // The name is the save's own bookkeeping, like the path: it is in the file, so it
      // must not read as an edit the file is behind.
      expect(useStore.getState().isDirty, `${flow} read its own naming as an edit`).toBe(false)
      expect(clearRecovery).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps a name typed while the write was out, over the one the save gave', async () => {
    for (const flow of ['save', 'saveAs'] as const) {
      act(() => {
        resetSession()
        useStore.getState().addCue('wait')
      })
      const release = hold(flow)
      let pending!: Promise<boolean>
      act(() => { pending = flows[flow]() })
      act(() => { useStore.getState().setWorkspaceName('The Scottish Play') })
      await act(async () => {
        release({ path: '/shows/Macbeth.cuerunner', history: [], name: 'Macbeth' })
        await pending
      })
      // The operator's is the later decision, and the file — which says Macbeth — is
      // behind it: the session says so.
      expect(useStore.getState().workspaceName).toBe('The Scottish Play')
      expect(useStore.getState().isDirty, `${flow} called a renamed show saved`).toBe(true)
    }
  })

  it('closes on a close-prompt save that named the show', async () => {
    const confirmDialog = window.cuerunner.workspace.confirmClose as unknown as Mock
    const confirmed = window.cuerunner.app.confirmClose as unknown as Mock
    const onCloseRequested = window.cuerunner.app.onCloseRequested as unknown as Mock
    confirmDialog.mockResolvedValue(0)          // Save
    confirmed.mockClear()
    act(() => { useStore.getState().addCue('wait') })

    const close = onCloseRequested.mock.calls.at(-1)![0] as () => Promise<void>
    const release = hold('save')
    let closing!: Promise<void>
    act(() => { closing = close() })
    await act(async () => {
      release({ path: '/shows/Macbeth.cuerunner', history: [], name: 'Macbeth' })
      await closing
    })

    // The file carries everything, under the name the save gave it: a witness that read
    // that name as unsaved work would keep the window open for ever.
    expect(confirmed).toHaveBeenCalledTimes(1)
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
