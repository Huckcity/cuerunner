import { useCallback, useEffect } from 'react'
import { useStore } from '../store'
import type { Workspace } from '../types/workspace'
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
  const { isDirty, workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, saveSucceeded } =
    useStore.getState()
  if (!isDirty) return true

  const response = await window.winslab.workspace.confirmClose(workspaceName)
  if (response === 2) return false   // Cancel
  if (response === 0) {              // Save
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings)
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

function loadIntoStore(workspace: Workspace, path: string | null): void {
  useStore.getState().loadWorkspace(
    workspace.cues,
    workspace.name || 'Untitled',
    path,
    workspace.audioSettings,
    workspace.midiSettings,
    workspace.showSettings
  )
}

// The demo opens with no path: it is an example rather than a file the user owns, so
// saving it asks where to put a copy instead of writing over the bundled one.
export async function openDemoWorkspace(): Promise<void> {
  if (!await guardDirty()) return
  try {
    loadIntoStore(await window.winslab.workspace.openDemo(), null)
  } catch (e) {
    reportFailure(`Could not open the demo workspace: ${message(e)}`)
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
      loadIntoStore(result.workspace, result.path)
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
      loadIntoStore(opened.workspace, opened.path)
    } catch (e) {
      reportFailure(`Could not open ${filePath}: ${message(e)}`)
    }
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    const { workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, saveSucceeded } =
      useStore.getState()
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings)
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
    const { workspaceName, cues, audioSettings, midiSettings, showSettings, saveSucceeded } =
      useStore.getState()
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings)
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
