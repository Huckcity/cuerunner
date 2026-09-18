import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { MissingMedia } from '../../../../shared/media'
import type { LoadNote, Workspace } from '../../../../shared/workspace'
import { formatClock } from '../../utils/cueDefaults'
import { buildWorkspace } from '../../utils/workspace'
import { NoticeBar } from './NoticeBar'

interface Snapshot {
  workspace: Workspace
  savedAt: number
  sourcePath: string | null
  selectedCueId?: string | null
  missingMedia: MissingMedia[]
  loadNotes: LoadNote[]
}

// Autosave writes snapshots to the user-data folder rather than over the operator's
// file. If one is waiting, the session ended without saving — offer the work back
// instead of applying it silently.
export function RecoveryNotice() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  useEffect(() => {
    // `recovery: null` is the ordinary "nothing to offer"; a snapshot this build cannot
    // read is the refusal arm, and is offered as nothing rather than caught.
    void window.cuerunner.workspace
      .recovery()
      .then(answer => { if (answer.ok && answer.recovery) setSnapshot(answer.recovery) })
  }, [])

  if (!snapshot) return null

  const name = snapshot.workspace.name || 'Untitled'

  // Where the session was standing: the cue the recovered show hands back. Nothing when
  // no cue was selected, and nothing when the cue it names is not in the snapshot — the
  // snapshot is a file on disk, and a file can say anything.
  const standingOn = snapshot.selectedCueId
    ? snapshot.workspace.cues.find(candidate => candidate.id === snapshot.selectedCueId) ?? null
    : null

  const recover = async (): Promise<void> => {
    const store = useStore.getState()
    // The only session-replacing flow without a dirty guard: recovering over unsaved
    // work would throw that work away behind the operator's back. Reuse the close
    // prompt — Save writes this session first, Don't Save discards it for the snapshot.
    if (store.isDirty) {
      const response = await window.cuerunner.workspace.confirmClose(store.workspaceName)
      if (response === 2) return
      if (response === 0) {
        try {
          // Through the one constructor, like every other save: a shape hand-built here
          // would be missing whatever section the constructor gains next.
          const saved = await window.cuerunner.workspace.save(
            buildWorkspace({
              id: store.workspaceId,
              name: store.workspaceName,
              createdAt: store.workspaceCreatedAt,
              history: store.showHistory,
              audioSettings: store.audioSettings,
              midiSettings: store.midiSettings,
              showSettings: store.showSettings,
              triggerGuard: store.triggerGuard,
              cues: store.cues
            }),
            store.workspacePath
          )
          if (!saved) return
          store.saveSucceeded(saved.path, store.workspaceName, saved.history)
        } catch {
          return
        }
      }
    }
    const live = useStore.getState()
    live.loadWorkspace(
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
      { id: snapshot.workspace.id, createdAt: snapshot.workspace.createdAt },
      // The snapshot's own guard, not the default: without it the next save writes the
      // default into the operator's file.
      snapshot.workspace.triggerGuard,
      // The file's own record of its saves travels with the snapshot, for the same
      // reason: a recovered session is the same show, not a new one.
      snapshot.workspace.history ?? []
    )
    // The place, not just the cues: standing where the session stood means the next GO
    // fires what it would have fired.
    if (standingOn !== null) live.select(standingOn.id)
    // The files the snapshot names may have moved since it was taken, so the same
    // missing-media report a normal open gives is shown here too — and the same goes for
    // grouping the snapshot needed repaired on its way back.
    live.setMissingMedia(snapshot.missingMedia)
    live.setLoadNotes(snapshot.loadNotes)
    // Recovered work is unsaved by definition: the file on disk is older than this. The
    // title bar's dot is the app's usual signal for that.
    live.markDirty()
    window.cuerunner.workspace.clearRecovery().catch(() => {})
    setSnapshot(null)
  }

  const discard = (): void => {
    window.cuerunner.workspace.clearRecovery().catch(() => {})
    setSnapshot(null)
  }

  return (
    <NoticeBar
      kind="recovery"
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
