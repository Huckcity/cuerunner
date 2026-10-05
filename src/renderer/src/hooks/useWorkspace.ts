import { useCallback, useEffect } from 'react'
import { useStore } from '../store'
import type { MissingMedia } from '../../../shared/media'
import type { ShowHistoryEntry } from '../../../shared/showfile'
import type { LoadNote, Workspace, WorkspaceIdentity } from '../../../shared/workspace'
import { buildWorkspace } from '../utils/workspace'
import { witnessSave } from '../utils/saveWitness'
import { cueEngine } from '../engine/CueEngine'

/** Reports a failure the operator has to know about, in the notice bar and the log. */
function reportFailure(message: string): void {
  const store = useStore.getState()
  store.setNotice(message)
  store.appendLog([{ level: 'error', message }])
}

/** What a save answered with, as far as the name goes: the one it gave the show, if any. */
interface SavedName {
  name?: string
}

/**
 * The show's name once a save has answered. A save names a show nobody had named — after
 * the file it was put in, and in the bytes it wrote — and that name is the session's from
 * then on, unless the operator typed one of their own while the write was out: theirs is
 * the later decision, and the witness below reports the file as behind it.
 */
function nameAfterSave(sent: Workspace, saved: SavedName): string {
  const now = useStore.getState().workspaceName
  return saved.name !== undefined && now === sent.name ? saved.name : now
}

/**
 * The show as the save wrote it: the payload, under the name the save gave it when it gave
 * one. This is what the witness compares the session against — the name main put in the
 * file is the save's own bookkeeping, like the path and the history, and must not read as
 * an edit that is still unsaved.
 */
function asWritten(sent: Workspace, saved: SavedName): Workspace {
  return saved.name === undefined ? sent : { ...sent, name: saved.name }
}

// The File menu and the cue list's empty state both open the demo, so the flows read the
// store imperatively instead of closing over hook state.
async function guardDirty(): Promise<boolean> {
  const { isDirty, workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, triggerGuard, workspaceId, workspaceCreatedAt, showHistory, saveSucceeded } =
    useStore.getState()
  if (!isDirty) return true

  const response = await window.cuerunner.workspace.confirmClose(workspaceName)
  if (response === 2) return false   // Cancel
  if (response === 0) {              // Save
    // The payload is built out of the try, so the object the save carries out is the
    // object the witness below is handed: a second build for the witness would compare
    // the session against values nothing was ever written from.
    const sent = buildWorkspace({
      id: workspaceId,
      name: workspaceName,
      createdAt: workspaceCreatedAt,
      history: showHistory,
      audioSettings,
      midiSettings,
      showSettings,
      triggerGuard,
      cues
    })
    let saved: { path: string; history: ShowHistoryEntry[]; name?: string } | null
    try {
      const answer = await window.cuerunner.workspace.save(sent, workspacePath)
      // A save this build refused is an answer rather than a fault: the file the save
      // would have replaced is exactly as it was, and the sentence is what the operator
      // has to read before the close can mean anything.
      if (!answer.ok) {
        reportFailure(`Could not save before closing: ${answer.error}`)
        return false
      }
      saved = answer.saved
    } catch (e) {
      // Closing without a save would lose the show, so the close stops here and says why.
      reportFailure(`Could not save before closing: ${message(e)}`)
      return false
    }
    if (!saved) return false     // User cancelled save dialog
    // A load replaced the session while the write was out: the answer belongs to the
    // show that was on screen then, and closing now would act on the wrong show.
    if (useStore.getState().workspaceId !== workspaceId) return false
    // The name the store has now, not the one this save was sent with: a rename typed
    // while the file was being written is the operator's, and the witness below reports
    // the file as behind it. A show the save itself named takes that name: see
    // `nameAfterSave`.
    saveSucceeded(saved.path, nameAfterSave(sent, saved), saved.history)
    // An edit that landed while the save was in flight is not on disk, so the flow must
    // not proceed on it: the witness is the one comparison every save flow keeps, and
    // when it reports, the close stops here — the next prompt offers the save again —
    // with the recovery snapshot left in place for the work still unsaved.
    if (witnessSave(asWritten(sent, saved))) return false
    await window.cuerunner.workspace.clearRecovery().catch(() => {})
  } else {
    // "Don't Save" discards the session, including its recovery snapshot.
    await window.cuerunner.workspace.clearRecovery().catch(() => {})
  }
  return true
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function loadIntoStore(
  workspace: Workspace,
  path: string | null,
  missingMedia: MissingMedia[],
  loadNotes: LoadNote[],
  identity?: WorkspaceIdentity
): void {
  const store = useStore.getState()
  // Here rather than when the flow began: a file this build refuses, or a dialog the
  // operator backed out of, leaves the show that is open playing as it was.
  cueEngine.stopForShowChange()
  store.loadWorkspace(
    workspace.cues,
    workspace.name || 'Untitled',
    path,
    workspace.audioSettings,
    workspace.midiSettings,
    workspace.showSettings,
    identity ?? { id: workspace.id, createdAt: workspace.createdAt },
    workspace.triggerGuard,
    workspace.history ?? []
  )
  // The guard remembers what pressed what; a show that has just opened has no presses
  // behind it, and the first GO of the night must not be mistaken for a repeat of the
  // one from the show that was open before.
  cueEngine.resetGuards()
  store.setMissingMedia(missingMedia)
  store.setLoadNotes(loadNotes)
}

// The demo opens with no path: it is an example rather than a file the user owns, so
// saving it asks where to put a copy instead of writing over the bundled one.
export async function openDemoWorkspace(): Promise<void> {
  if (!await guardDirty()) return
  try {
    // The demo's audio is copied out of the app bundle as it loads, so there is never
    // anything missing to report. It is a template rather than a show someone owns, so
    // it takes a fresh identity: saving it as your own show must not keep the demo's.
    const answer = await window.cuerunner.workspace.openDemo()
    // A refusal is the answer for a demo this build cannot read — the app's own file, put
    // through the same funnel as an operator's — so it is branched on rather than caught,
    // and lands in the notice bar beside every other load's.
    if (!answer.ok) {
      reportFailure(`Could not open the demo workspace: ${answer.error}`)
      return
    }
    loadIntoStore(
      answer.workspace,
      null,
      [],
      [],
      { id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    )
  } catch (e) {
    reportFailure(`Could not open the demo workspace: ${message(e)}`)
  }
}

/**
 * Points one missing file at where it is now. The main process applies the same move to
 * every other file it accounts for, so one pick can put a whole folder back together.
 * Whatever is left is reported again for another pick.
 */
export async function relinkMissingMedia(cueId: string): Promise<void> {
  const { workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, triggerGuard, workspaceId, workspaceCreatedAt } =
    useStore.getState()
  const workspace = buildWorkspace({
    id: workspaceId,
    name: workspaceName,
    createdAt: workspaceCreatedAt,
    audioSettings,
    midiSettings,
    showSettings,
    triggerGuard,
    cues
  })
  try {
    const result = await window.cuerunner.workspace.relink(workspace, workspacePath, cueId)
    // Only cues that actually moved are written back, so an unresolved file keeps the
    // path it was last seen at instead of losing it.
    const resolved: Record<string, string> = {}
    for (const cue of result.workspace.cues) {
      if (cue.type !== 'audio') continue
      const current = cues.find(c => c.id === cue.id)
      if (current?.type === 'audio' && current.filePath !== cue.filePath) {
        resolved[cue.id] = cue.filePath
      }
    }
    const store = useStore.getState()
    store.applyRelinkedMedia(resolved)
    store.setMissingMedia(result.missingMedia)
  } catch (e) {
    reportFailure(`Could not relink media: ${message(e)}`)
  }
}

/**
 * The show and the audio it plays, written to one file the operator names. Media the
 * machine does not have is left out and reported rather than failing the export: the
 * bundle is still worth having, and the operator is the one who knows where that file
 * went.
 */
export async function exportShowBundle(): Promise<void> {
  const {
    workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings,
    triggerGuard, workspaceId, workspaceCreatedAt, showHistory
  } = useStore.getState()
  // A show with unsaved edits is the show as it stands: what the bundle carries is what
  // is on screen, not what was last written.
  const workspace = buildWorkspace({
    id: workspaceId,
    name: workspaceName,
    createdAt: workspaceCreatedAt,
    history: showHistory,
    audioSettings,
    midiSettings,
    showSettings,
    triggerGuard,
    cues
  })
  try {
    const answer = await window.cuerunner.workspace.exportBundle(workspace, workspacePath)
    if (!answer.ok) {
      reportFailure(answer.error)
      return
    }
    if (!answer.exported) return
    const store = useStore.getState()
    store.appendLog([{
      level: 'info',
      message: `Exported ${answer.exported.path}`
    }])
    if (answer.exported.missing.length > 0) {
      const names = answer.exported.missing.map(path => path.split(/[\\/]/).pop()).join(', ')
      store.setNotice(
        `${answer.exported.missing.length} of the show's files were not on this machine and are `
        + `not in the bundle: ${names}`
      )
    }
  } catch (e) {
    reportFailure(`Could not export the bundle: ${message(e)}`)
  }
}

/**
 * Two files merged into a third: the other person's copy of the show, and the version the
 * two of you started from. The result is written where the operator says and this show is
 * left exactly as it is — a merge is something to look at before trusting it, and the
 * show being merged into is still being worked on.
 */
export async function mergeAnotherShow(policy: 'ours' | 'theirs' = 'ours', again = false): Promise<void> {
  const {
    workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings,
    triggerGuard, workspaceId, workspaceCreatedAt, showHistory, setMergeReport
  } = useStore.getState()
  // The show as it stands, unsaved edits included: merging in a version of a show that is
  // not what is on screen is merging the wrong thing.
  const workspace = buildWorkspace({
    id: workspaceId,
    name: workspaceName,
    createdAt: workspaceCreatedAt,
    history: showHistory,
    audioSettings,
    midiSettings,
    showSettings,
    triggerGuard,
    cues
  })
  try {
    const answer = await window.cuerunner.workspace.merge(workspace, workspacePath, {
      policy,
      ...(again ? { again: true } : {})
    })
    if (!answer.ok) {
      reportFailure(answer.error)
      return
    }
    if (!answer.merged) return
    setMergeReport({
      path: answer.merged.path,
      notes: answer.merged.notes,
      tally: answer.merged.tally,
      policy
    })
  } catch (e) {
    reportFailure(`Could not merge the show: ${message(e)}`)
  }
}

/** Opens the show a merge wrote, over the one that is open. */
export async function openMergedShow(filePath: string): Promise<void> {
  if (!await guardDirty()) return
  try {
    const answer = await window.cuerunner.workspace.openPath(filePath)
    if (!answer.ok) {
      reportFailure(`Could not open ${filePath}: ${answer.error}`)
      return
    }
    // The merge reports what it and its input reads repaired through its own report, but
    // the file it wrote is a load like any other — the merge's own parent repair does not
    // fix a parent that is not a group — so the load bar speaks for it too.
    loadIntoStore(
      answer.opened.workspace,
      answer.opened.path,
      answer.opened.missingMedia,
      answer.opened.loadNotes
    )
    useStore.getState().setMergeReport(null)
  } catch (e) {
    reportFailure(`Could not open ${filePath}: ${message(e)}`)
  }
}

/** A bundle in: a show and its media unpacked where the operator says, then opened. */
export async function importShowBundle(): Promise<void> {
  if (!await guardDirty()) return
  try {
    const answer = await window.cuerunner.workspace.importBundle()
    if (!answer.ok) {
      reportFailure(answer.error)
      return
    }
    if (!answer.imported) return
    loadIntoStore(
      answer.imported.workspace,
      answer.imported.path,
      answer.imported.missingMedia,
      answer.imported.loadNotes
    )
  } catch (e) {
    reportFailure(`Could not open the bundle: ${message(e)}`)
  }
}

export function useWorkspace() {
  const { workspaceName, workspacePath, isDirty, loadWorkspace, setWorkspaceName } = useStore()

  // Keep window title in sync
  useEffect(() => {
    const title = `${workspaceName}${isDirty ? ' ●' : ''} — Cuerunner`
    document.title = title
    window.cuerunner.workspace.setTitle(title)
  }, [workspaceName, isDirty])

  // When the main process intercepts the OS close button, run the dirty check.
  useEffect(() => {
    const off = window.cuerunner.app.onCloseRequested(async () => {
      const canClose = await guardDirty()
      if (canClose) window.cuerunner.app.confirmClose()
    })
    return off
  }, [])

  const newWorkspace = useCallback(async () => {
    if (!await guardDirty()) return
    // An empty show is a show like any other: what the last one left running goes with it.
    cueEngine.stopForShowChange()
    loadWorkspace([], 'Untitled', null)
  }, [loadWorkspace])

  const openWorkspace = useCallback(async () => {
    if (!await guardDirty()) return
    try {
      const answer = await window.cuerunner.workspace.open()
      // A refusal is the answer for a file this build cannot read — an oversize show, one
      // saved by a newer version — so it is branched on rather than caught. A cancel is
      // the null inside the success arm.
      if (!answer.ok) {
        reportFailure(`Could not open the workspace: ${answer.error}`)
        return
      }
      if (!answer.opened) return
      loadIntoStore(
        answer.opened.workspace,
        answer.opened.path,
        answer.opened.missingMedia,
        answer.opened.loadNotes
      )
    } catch (e) {
      reportFailure(`Could not open the workspace: ${message(e)}`)
    }
  }, [])

  const openRecent = useCallback(async (filePath: string) => {
    if (!await guardDirty()) return
    try {
      // The bridge hands back the file it read alongside the workspace; the store wants
      // the workspace itself. A file it cannot read is the refusal arm — an answer, not
      // something to catch.
      const answer = await window.cuerunner.workspace.openPath(filePath)
      if (!answer.ok) {
        reportFailure(`Could not open ${filePath}: ${answer.error}`)
        return
      }
      loadIntoStore(
        answer.opened.workspace,
        answer.opened.path,
        answer.opened.missingMedia,
        answer.opened.loadNotes
      )
    } catch (e) {
      reportFailure(`Could not open ${filePath}: ${message(e)}`)
    }
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    const { workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, triggerGuard, workspaceId, workspaceCreatedAt, showHistory, saveSucceeded } =
      useStore.getState()
    // The saved shape the bridge is handed, kept as that exact object: the round trip's
    // witness compares it against the session, so it must be the bytes that went out
    // rather than a second build of the same values.
    const ws = buildWorkspace({
      id: workspaceId,
      name: workspaceName,
      createdAt: workspaceCreatedAt,
      history: showHistory,
      audioSettings,
      midiSettings,
      showSettings,
      triggerGuard,
      cues
    })
    try {
      const answer = await window.cuerunner.workspace.save(ws, workspacePath)
      // This build refusing its own file is an answer — the show it would have written is
      // not one it will read back — so the sentence goes to the operator and the file on
      // disk is left alone.
      if (!answer.ok) {
        reportFailure(`Could not save the workspace: ${answer.error}`)
        return false
      }
      const saved = answer.saved
      if (!saved) return false
      // A load replaced the session while the write was out: this answer belongs to the
      // show that was on screen then, and adopting its path over the loaded show's would
      // point the next save at the wrong file.
      if (useStore.getState().workspaceId !== workspaceId) return false
      // The name the store has now, not the one this save was sent with: see guardDirty.
      saveSucceeded(saved.path, nameAfterSave(ws, saved), saved.history)
      // Anything that moved while the save was in flight is still unsaved, even though
      // the round trip answered: the witness compares against what went out, and while it
      // reports, the snapshot stays — it is that work's only copy.
      if (!witnessSave(asWritten(ws, saved))) {
        // The session is on disk now, so there is nothing left to recover.
        await window.cuerunner.workspace.clearRecovery().catch(() => {})
      }
      return true
    } catch (e) {
      reportFailure(`Could not save the workspace: ${message(e)}`)
      return false
    }
  }, [])

  const saveAs = useCallback(async (): Promise<boolean> => {
    const { workspaceName, cues, audioSettings, midiSettings, showSettings, triggerGuard, workspaceId, workspaceCreatedAt, showHistory, saveSucceeded } =
      useStore.getState()
    // Saving under another name is the same show in another file: the identity travels
    // with it, so both copies stay recognisably the same show. The same round-trip
    // witness as save keeps an edit that landed mid-write dirty.
    const ws = buildWorkspace({
      id: workspaceId,
      name: workspaceName,
      createdAt: workspaceCreatedAt,
      history: showHistory,
      audioSettings,
      midiSettings,
      showSettings,
      triggerGuard,
      cues
    })
    try {
      const answer = await window.cuerunner.workspace.saveAs(ws)
      // Same regime as save: a refusal is an answer, and the name the operator picked is
      // not written to.
      if (!answer.ok) {
        reportFailure(`Could not save the workspace: ${answer.error}`)
        return false
      }
      const saved = answer.saved
      if (!saved) return false
      // A load replaced the session while the write was out: see save.
      if (useStore.getState().workspaceId !== workspaceId) return false
      saveSucceeded(saved.path, nameAfterSave(ws, saved), saved.history)
      // The same rule as save: the snapshot goes only when the witness reports nothing.
      if (!witnessSave(asWritten(ws, saved))) {
        await window.cuerunner.workspace.clearRecovery().catch(() => {})
      }
      return true
    } catch (e) {
      reportFailure(`Could not save the workspace: ${message(e)}`)
      return false
    }
  }, [])

  return { workspaceName, workspacePath, isDirty, newWorkspace, openWorkspace, openRecent, save, saveAs, setWorkspaceName }
}
