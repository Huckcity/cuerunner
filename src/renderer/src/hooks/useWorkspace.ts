import { useCallback, useEffect } from 'react'
import { useStore } from '../store'
import type { Workspace } from '../types/workspace'

function buildWorkspace(
  name: string,
  cues: Workspace['cues'],
  audioSettings: Workspace['audioSettings'],
  midiSettings: Workspace['midiSettings'],
): Workspace {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    audioSettings,
    midiSettings,
    cues
  }
}

// The File menu and the cue list's empty state both open the demo, so the flows read the
// store imperatively instead of closing over hook state.
async function guardDirty(): Promise<boolean> {
  const { isDirty, workspaceName, workspacePath, cues, audioSettings, midiSettings, saveSucceeded } =
    useStore.getState()
  if (!isDirty) return true

  const response = await window.winslab.workspace.confirmClose(workspaceName)
  if (response === 2) return false   // Cancel
  if (response === 0) {              // Save
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings)
    const savedPath = await window.winslab.workspace.save(ws, workspacePath)
    if (!savedPath) return false     // User cancelled save dialog
    saveSucceeded(savedPath, workspaceName)
  }
  return true
}

function loadIntoStore(workspace: Workspace, path: string | null): void {
  useStore.getState().loadWorkspace(
    workspace.cues,
    workspace.name || 'Untitled',
    path,
    workspace.audioSettings,
    workspace.midiSettings
  )
}

// The demo opens with no path: it is an example rather than a file the user owns, so
// saving it asks where to put a copy instead of writing over the bundled one.
export async function openDemoWorkspace(): Promise<void> {
  if (!await guardDirty()) return
  try {
    loadIntoStore(await window.winslab.workspace.openDemo(), null)
  } catch (e) {
    alert(`Could not open the demo workspace: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function useWorkspace() {
  const { workspaceName, workspacePath, isDirty, loadWorkspace, saveSucceeded, setWorkspaceName } = useStore()

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
    const result = await window.winslab.workspace.open()
    if (!result) return
    loadIntoStore(result.workspace, result.path)
  }, [])

  const openRecent = useCallback(async (filePath: string) => {
    if (!await guardDirty()) return
    try {
      loadIntoStore(await window.winslab.workspace.openPath(filePath), filePath)
    } catch {
      alert(`Could not open file: ${filePath}`)
    }
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    const { workspaceName, workspacePath, cues, audioSettings, midiSettings, saveSucceeded } =
      useStore.getState()
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings)
    const savedPath = await window.winslab.workspace.save(ws, workspacePath)
    if (!savedPath) return false
    saveSucceeded(savedPath, workspaceName)
    return true
  }, [])

  const saveAs = useCallback(async (): Promise<boolean> => {
    const { workspaceName, cues, audioSettings, midiSettings, saveSucceeded } = useStore.getState()
    const ws = buildWorkspace(workspaceName, cues, audioSettings, midiSettings)
    const savedPath = await window.winslab.workspace.saveAs(ws)
    if (!savedPath) return false
    saveSucceeded(savedPath, workspaceName)
    return true
  }, [])

  return { workspaceName, workspacePath, isDirty, newWorkspace, openWorkspace, openRecent, save, saveAs, setWorkspaceName }
}
