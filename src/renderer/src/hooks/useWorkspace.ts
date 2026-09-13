import { useCallback, useEffect } from 'react'
import { useStore } from '../store'
import type { MissingMedia } from '../../../shared/media'
import type { Workspace, WorkspaceIdentity } from '../types/workspace'
import { buildWorkspace } from '../utils/workspace'

/** Reports a failure the operator has to know about, in the notice bar and the log. */
function reportFailure(message: string): void {
  const store = useStore.getState()
  store.setNotice(message)
  store.appendLog([{ level: 'error', message }])
}

// The File menu and the cue list's empty state both open the demo, so the flows read the
// store imperatively instead of closing over hook state.
async function guardDirty(): Promise<boolean> {
  const { isDirty, workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, workspaceId, workspaceCreatedAt, saveSucceeded } =
    useStore.getState()
  if (!isDirty) return true

  const response = await window.winslab.workspace.confirmClose(workspaceName)
  if (response === 2) return false   // Cancel
  if (response === 0) {              // Save
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings, {
      id: workspaceId,
      createdAt: workspaceCreatedAt
    })
    let savedPath: string | null
    try {
      savedPath = await window.winslab.workspace.save(ws, workspacePath)
    } catch (e) {
      // Closing without a save would lose the show, so the close stops here and says why.
      reportFailure(`Could not save before closing: ${message(e)}`)
      return false
    }
    if (!savedPath) return false     // User cancelled save dialog
    saveSucceeded(savedPath, workspaceName)
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
    identity ?? { id: workspace.id, createdAt: workspace.createdAt }
  )
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
  const { workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, workspaceId, workspaceCreatedAt } =
    useStore.getState()
  const workspace = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings, {
    id: workspaceId,
    createdAt: workspaceCreatedAt
  })
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
    const { workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, workspaceId, workspaceCreatedAt, saveSucceeded } =
      useStore.getState()
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings, {
      id: workspaceId,
      createdAt: workspaceCreatedAt
    })
    try {
      const savedPath = await window.winslab.workspace.save(ws, workspacePath)
      if (!savedPath) return false
      saveSucceeded(savedPath, workspaceName)
      // The session is on disk now, so there is nothing left to recover.
      await window.winslab.workspace.clearRecovery().catch(() => {})
      return true
    } catch (e) {
      reportFailure(`Could not save the workspace: ${message(e)}`)
      return false
    }
  }, [])

  const saveAs = useCallback(async (): Promise<boolean> => {
    const { workspaceName, cues, audioSettings, midiSettings, showSettings, workspaceId, workspaceCreatedAt, saveSucceeded } =
      useStore.getState()
    // Saving under another name is the same show in another file: the identity travels
    // with it, so both copies stay recognisably the same show.
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings, {
      id: workspaceId,
      createdAt: workspaceCreatedAt
    })
    try {
      const savedPath = await window.winslab.workspace.saveAs(ws)
      if (!savedPath) return false
      saveSucceeded(savedPath, workspaceName)
      await window.winslab.workspace.clearRecovery().catch(() => {})
      return true
    } catch (e) {
      reportFailure(`Could not save the workspace: ${message(e)}`)
      return false
    }
  }, [])

  return { workspaceName, workspacePath, isDirty, newWorkspace, openWorkspace, openRecent, save, saveAs, setWorkspaceName }
}
