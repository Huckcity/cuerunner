import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { MissingMedia } from '../../../../shared/media'
import type { Workspace } from '../../types/workspace'
import { formatClock } from '../../utils/cueDefaults'
import { NoticeBar } from './NoticeBar'

interface Snapshot {
  workspace: Workspace
  savedAt: number
  sourcePath: string | null
  selectedCueId?: string | null
  missingMedia: MissingMedia[]
}

// Autosave writes snapshots to the user-data folder rather than over the operator's
// file. If one is waiting, the session ended without saving — offer the work back
// instead of applying it silently.
export function RecoveryNotice() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  useEffect(() => {
    window.winslab.workspace
      .recovery()
      .then(found => { if (found) setSnapshot(found) })
      .catch(() => { /* no snapshot, nothing to offer */ })
  }, [])

  if (!snapshot) return null

  const name = snapshot.workspace.name || 'Untitled'

  // Where the session was standing: the cue the recovered show hands back. Nothing when
  // no cue was selected, and nothing when the cue it names is not in the snapshot — the
  // snapshot is a file on disk, and a file can say anything.
  const standingOn = snapshot.selectedCueId
    ? snapshot.workspace.cues.find(candidate => candidate.id === snapshot.selectedCueId) ?? null
    : null

  const recover = (): void => {
    const store = useStore.getState()
    store.loadWorkspace(
      snapshot.workspace.cues,
      name,
      snapshot.sourcePath,
      snapshot.workspace.audioSettings,
      snapshot.workspace.midiSettings,
      // The snapshot carries the show settings too — the scenes, the plot, the triggers'
      // ports. Recovering without them would hand back a show with its desk emptied, and
      // the next save would write that emptiness over the operator's file.
      snapshot.workspace.showSettings,
      // The snapshot is this show as it was, so it keeps the show's identity: recovering
      // and saving must write the file it came from, not a file with a new id.
      { id: snapshot.workspace.id, createdAt: snapshot.workspace.createdAt }
    )
    // The place, not just the cues: standing where the session stood means the next GO
    // fires what it would have fired.
    if (standingOn !== null) store.select(standingOn.id)
    // The files the snapshot names may have moved since it was taken, so the same
    // missing-media report a normal open gives is shown here too.
    store.setMissingMedia(snapshot.missingMedia)
    // Recovered work is unsaved by definition: the file on disk is older than this. The
    // title bar's dot is the app's usual signal for that.
    store.markDirty()
    window.winslab.workspace.clearRecovery().catch(() => {})
    setSnapshot(null)
  }

  const discard = (): void => {
    window.winslab.workspace.clearRecovery().catch(() => {})
    setSnapshot(null)
  }

  return (
    <NoticeBar
      kind="recovery"
      onDismiss={discard}
      actions={
        <>
          <button className="app-notice-action" onClick={recover}>Recover</button>
          <button className="app-notice-action" onClick={discard}>Discard</button>
        </>
      }
    >
      Unsaved work from “{name}” ({formatClock(snapshot.savedAt)}) was found after the last
      session ended without saving.
      {standingOn !== null && (
        <> It was standing on <strong>{standingOn.number} · {standingOn.name || 'untitled'}</strong>.</>
      )}
    </NoticeBar>
  )
}
