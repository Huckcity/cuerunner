import type { Workspace, WorkspaceIdentity } from '../../../shared/workspace'

// The saved form of the current session. A real save and an autosave snapshot are built
// the same way, so a recovered workspace has the shape a saved one does.
//
// The identity is the caller's, not this function's: it belongs to the show. Minting one
// here meant every save rewrote the file's id and createdAt, which is churn in the
// direction that costs the most — a showfile in version control changed on every save
// without a single edit. The store holds the identity; see `loadWorkspace`.
//
// The history is the file's, not this function's, for the same reason and in the same
// direction: the main process compares the file about to be replaced with what is about
// to replace it and writes the entry itself. The store carries the result back, so a save
// appends to the file's history rather than replacing it with this session's.
export function buildWorkspace(
  name: string,
  cues: Workspace['cues'],
  audioSettings: Workspace['audioSettings'],
  midiSettings: Workspace['midiSettings'],
  showSettings: Workspace['showSettings'],
  identity: WorkspaceIdentity,
  triggerGuard: Workspace['triggerGuard'],
  history: Workspace['history'] = []
): Workspace {
  return {
    version: 1,
    id: identity.id,
    name,
    createdAt: identity.createdAt,
    // A file with nothing to say about its past says nothing: an empty array here would
    // be the key every save of every show carries for no reason.
    history: history && history.length > 0 ? history : undefined,
    audioSettings,
    midiSettings,
    showSettings,
    triggerGuard,
    cues
  }
}
