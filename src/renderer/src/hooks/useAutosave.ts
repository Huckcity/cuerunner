import { useEffect } from 'react'
import { useStore } from '../store'
import { buildWorkspace } from '../utils/workspace'

// Often enough that a crash costs seconds of work, rarely enough to be invisible during
// a show. The snapshot goes to the app's user-data folder and is offered back on the
// next launch; it never lands on the operator's own file.
const AUTOSAVE_INTERVAL_MS = 30_000

export function useAutosave(): void {
  useEffect(() => {
    const timer = setInterval(() => {
      const { isDirty, workspaceName, workspacePath, cues, audioSettings, midiSettings, showSettings, workspaceId, workspaceCreatedAt } =
        useStore.getState()
      if (!isDirty) return
      const snapshot = buildWorkspace(workspaceName, cues, audioSettings, midiSettings, showSettings, {
        id: workspaceId,
        createdAt: workspaceCreatedAt
      })
      window.winslab.workspace.autosave(snapshot, workspacePath).catch(() => {
        // A snapshot that cannot be written must never interrupt the show. The next
        // tick tries again.
      })
    }, AUTOSAVE_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [])
}
