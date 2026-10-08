import { diffWorkspaces } from '../../../shared/showfile'
import type { Cue } from '../../../shared/cue'
import type { Workspace } from '../../../shared/workspace'
import { useStore } from '../store'
import { buildWorkspace } from './workspace'

// The one witness a save round trip keeps: the session as it stands now, against the
// shape the save carried out.
//
// A save builds its payload before it awaits the disk, so an edit that lands while the
// write is out is not in the bytes. `saveSucceeded` clears the flag when the round trip
// answers, and only something that compares the two can put it back. That comparison used
// to be hand-copied into every flow — `cues` identity, `past.length`, the name — which saw
// neither an edit to any other saved section nor the false positives a measurement
// produces. `diffWorkspaces` is the engine history, compare and merge read an edit with,
// so asking it is asking the app's own question: a change those surfaces read as an edit
// is an edit here, and an edit is exactly what stays unsaved.
//
// The one edit the diff is built not to see is the route to a cue's file: `filePath` is
// folded to the file's own name, because a show carried to another folder must not read
// as edited. A relink is not that — it is the operator pointing the cue at where its file
// is now — so the witness also asks whether any cue's route moved, which is what the
// store's relink writer dirties for.
//
// The caller runs this after `saveSucceeded`, which adopts the file's path and history
// and clears the flag. The history has no route in the diff, so the save's own entry —
// and a path that only just became a path — cannot read as an edit.
//
// The report is also the answer: `true` means the save did not carry everything, and a
// flow whose next step would discard the session — a close, an open — stops on it.
export function witnessSave(sent: Workspace): boolean {
  const {
    workspaceId, workspaceName, workspaceCreatedAt, showHistory,
    audioSettings, midiSettings, showSettings, triggerGuard, cues, markDirty
  } = useStore.getState()
  // The session as a save would carry it out now, built through the one constructor:
  // whatever section the saved shape gains, the witness compares it without knowing it.
  const now = buildWorkspace({
    id: workspaceId,
    name: workspaceName,
    createdAt: workspaceCreatedAt,
    history: showHistory,
    audioSettings,
    midiSettings,
    showSettings,
    triggerGuard,
    videoOutputs: useStore.getState().videoOutputs,
    cues
  })
  const diff = diffWorkspaces(sent, now)
  // A different show id means a load replaced the session while the write was out: the
  // bytes belong to a show that is no longer on screen, and reporting the old show's
  // work against the new one's dot would be a lie about what is unsaved.
  if (!diff.sameShow) return false
  if (diff.empty && !relinked(sent.cues, now.cues)) return false
  markDirty()
  return true
}

/**
 * Whether the route to any cue's file changed under the write. The diff folds the route
 * down to the file's own name, so a cue pointed at the same-named file in another folder
 * is invisible to it; the store's relink writer counts exactly that as an edit.
 */
function relinked(before: Cue[], after: Cue[]): boolean {
  const routes = new Map(before.map(cue => [cue.id, fileRoute(cue)]))
  return after.some(cue => routes.has(cue.id) && routes.get(cue.id) !== fileRoute(cue))
}

/** A cue's route to its file, for the cue types that carry one. */
function fileRoute(cue: Cue): string | null {
  const route = (cue as { filePath?: unknown }).filePath
  return typeof route === 'string' && route !== '' ? route : null
}
