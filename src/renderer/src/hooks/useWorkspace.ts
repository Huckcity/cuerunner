import { useCallback, useEffect } from 'react'
import { useStore } from '../store'
import type { MissingMedia } from '../../../shared/media'
import type { ShowHistoryEntry } from '../../../shared/showfile'
import type { Workspace, WorkspaceIdentity } from '../types/workspace'
import { buildWorkspace } from '../utils/workspace'
import { cueEngine } from '../engine/CueEngine'

/** Reports a failure the operator has to know about, in the notice bar and the log. */
function reportFailure(message: string): void {
  const store = useStore.getState()
  store.setNotice(message)
  store.appendLog([{ level: 'error', message }])
}

// The File menu and the cue list's empty state both open the demo, so the flows read the
// store imperatively instead of closing over hook state.
async function guardDirty(): Promise<boolean> {
  const { isDirty, workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, triggerGuard, workspaceId, workspaceCreatedAt, showHistory, saveSucceeded } =
    useStore.getState()
  if (!isDirty) return true

  const response = await window.winslab.workspace.confirmClose(workspaceName)
  if (response === 2) return false   // Cancel
  if (response === 0) {              // Save
    const sentCues = useStore.getState().cues
    const sentEdits = useStore.getState().past.length
    let saved: { path: string; history: ShowHistoryEntry[] } | null
    try {
      saved = await window.winslab.workspace.save(buildWorkspace(
        workspaceName, cues, audioSettings, midiSettings, showSettings,
        { id: workspaceId, createdAt: workspaceCreatedAt }, triggerGuard, showHistory
      ), workspacePath)
    } catch (e) {
      // Closing without a save would lose the show, so the close stops here and says why.
      reportFailure(`Could not save before closing: ${message(e)}`)
      return false
    }
    if (!saved) return false     // User cancelled save dialog
    saveSucceeded(saved.path, workspaceName, saved.history)
    // An edit that landed while the save was in flight is not on disk: the close must
    // still ask. The undo depth is the cheap witness — every edit pushes exactly one.
    const after = useStore.getState()
    if (after.cues !== sentCues || after.past.length !== sentEdits) after.markDirty()
    await window.winslab.workspace.clearRecovery().catch(() => {})
  } else {
    // "Don't Save" discards the session, including its recovery snapshot.
    await window.winslab.workspace.clearRecovery().catch(() => {})
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
  identity?: WorkspaceIdentity
): void {
  const store = useStore.getState()
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
}

// The demo opens with no path: it is an example rather than a file the user owns, so
// saving it asks where to put a copy instead of writing over the bundled one.
export async function openDemoWorkspace(): Promise<void> {
  if (!await guardDirty()) return
  try {
    // The demo's audio is copied out of the app bundle as it loads, so there is never
    // anything missing to report. It is a template rather than a show someone owns, so
    // it takes a fresh identity: saving it as your own show must not keep the demo's.
    const demo = await window.winslab.workspace.openDemo()
    loadIntoStore(demo, null, [], { id: crypto.randomUUID(), createdAt: new Date().toISOString() })
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
  const workspace = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings, {
    id: workspaceId,
    createdAt: workspaceCreatedAt
  }, triggerGuard)
  try {
    const result = await window.winslab.workspace.relink(workspace, workspacePath, cueId)
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
  const workspace = buildWorkspace(
    workspaceName,
    cues,
    audioSettings,
    midiSettings,
    showSettings,
    { id: workspaceId, createdAt: workspaceCreatedAt },
    triggerGuard,
    showHistory
  )
  try {
    const answer = await window.winslab.workspace.exportBundle(workspace, workspacePath)
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
  const workspace = buildWorkspace(
    workspaceName,
    cues,
    audioSettings,
    midiSettings,
    showSettings,
    { id: workspaceId, createdAt: workspaceCreatedAt },
    triggerGuard,
    showHistory
  )
  try {
    const answer = await window.winslab.workspace.merge(workspace, workspacePath, {
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
    const opened = await window.winslab.workspace.openPath(filePath)
    loadIntoStore(opened.workspace, opened.path, opened.missingMedia)
    useStore.getState().setMergeReport(null)
  } catch (e) {
    reportFailure(`Could not open ${filePath}: ${message(e)}`)
  }
}

/** A bundle in: a show and its media unpacked where the operator says, then opened. */
export async function importShowBundle(): Promise<void> {
  if (!await guardDirty()) return
  try {
    const answer = await window.winslab.workspace.importBundle()
    if (!answer.ok) {
      reportFailure(answer.error)
      return
    }
    if (!answer.imported) return
    loadIntoStore(answer.imported.workspace, answer.imported.path, answer.imported.missingMedia)
  } catch (e) {
    reportFailure(`Could not open the bundle: ${message(e)}`)
  }
}

export function useWorkspace() {
  const { workspaceName, workspacePath, isDirty, loadWorkspace, setWorkspaceName } = useStore()

  // Keep window title in sync
  useEffect(() => {
    const title = `${workspaceName}${isDirty ? ' ●' : ''} — WinsLab`
    document.title = title
    window.winslab.workspace.setTitle(title)
  }, [workspaceName, isDirty])

  // When the main process intercepts the OS close button, run the dirty check.
  useEffect(() => {
    const off = window.winslab.app.onCloseRequested(async () => {
      const canClose = await guardDirty()
      if (canClose) window.winslab.app.confirmClose()
    })
    return off
  }, [])

  const newWorkspace = useCallback(async () => {
    if (!await guardDirty()) return
    loadWorkspace([], 'Untitled', null)
  }, [loadWorkspace])

  const openWorkspace = useCallback(async () => {
    if (!await guardDirty()) return
    try {
      const result = await window.winslab.workspace.open()
      if (!result) return
      loadIntoStore(result.workspace, result.path, result.missingMedia)
    } catch (e) {
      reportFailure(`Could not open the workspace: ${message(e)}`)
    }
  }, [])

  const openRecent = useCallback(async (filePath: string) => {
    if (!await guardDirty()) return
    try {
      // The bridge hands back the file it read alongside the workspace; the store wants
      // the workspace itself.
      const opened = await window.winslab.workspace.openPath(filePath)
      loadIntoStore(opened.workspace, opened.path, opened.missingMedia)
    } catch (e) {
      reportFailure(`Could not open ${filePath}: ${message(e)}`)
    }
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    const { workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, triggerGuard, workspaceId, workspaceCreatedAt, showHistory, saveSucceeded } =
      useStore.getState()
    // Snapshot the references, not the contents: the store replaces cues and the undo
    // stack wholesale on every edit, so identity is the revision witness. Marking saved
    // unconditionally would clear edits that landed while the disk was being written.
    const sentCues = cues
    const sentEdits = useStore.getState().past.length
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings, {
      id: workspaceId,
      createdAt: workspaceCreatedAt
    }, triggerGuard, showHistory)
    try {
      const saved = await window.winslab.workspace.save(ws, workspacePath)
      if (!saved) return false
      saveSucceeded(saved.path, workspaceName, saved.history)
      // Anything that moved while the save was in flight is still unsaved, even though
      // the round trip answered: compare against what went out.
      const after = useStore.getState()
      if (after.cues !== sentCues || after.past.length !== sentEdits) after.markDirty()
      // The session is on disk now, so there is nothing left to recover.
      await window.winslab.workspace.clearRecovery().catch(() => {})
      return true
    } catch (e) {
      reportFailure(`Could not save the workspace: ${message(e)}`)
      return false
    }
  }, [])

  const saveAs = useCallback(async (): Promise<boolean> => {
    const { workspaceName, cues, audioSettings, midiSettings, showSettings, triggerGuard, workspaceId, workspaceCreatedAt, showHistory, saveSucceeded } =
      useStore.getState()
    // Same round-trip witness as save: an edit landing mid-write stays dirty.
    const sentCues = cues
    const sentEdits = useStore.getState().past.length
    // Saving under another name is the same show in another file: the identity travels
    // with it, so both copies stay recognisably the same show.
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings, {
      id: workspaceId,
      createdAt: workspaceCreatedAt
    }, triggerGuard, showHistory)
    try {
      const saved = await window.winslab.workspace.saveAs(ws)
      if (!saved) return false
      saveSucceeded(saved.path, workspaceName, saved.history)
      const after = useStore.getState()
      if (after.cues !== sentCues || after.past.length !== sentEdits) after.markDirty()
      await window.winslab.workspace.clearRecovery().catch(() => {})
      return true
    } catch (e) {
      reportFailure(`Could not save the workspace: ${message(e)}`)
      return false
    }
  }, [])

  return { workspaceName, workspacePath, isDirty, newWorkspace, openWorkspace, openRecent, save, saveAs, setWorkspaceName }
}
