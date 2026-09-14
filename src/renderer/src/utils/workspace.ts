import type { Workspace, WorkspaceIdentity } from '../types/workspace'

// The saved form of the current session. A real save and an autosave snapshot are built
// the same way, so a recovered workspace has the shape a saved one does.
//
// The identity is the caller's, not this function's: it belongs to the show. Minting one
// here meant every save rewrote the file's id and createdAt, which is churn in the
// direction that costs the most — a showfile in version control changed on every save
// without a single edit. The store holds the identity; see `loadWorkspace`.
export function buildWorkspace(
  name: string,
  cues: Workspace['cues'],
  audioSettings: Workspace['audioSettings'],
  midiSettings: Workspace['midiSettings'],
  showSettings: Workspace['showSettings'],
  identity: WorkspaceIdentity,
  triggerGuard: Workspace['triggerGuard']
): Workspace {
  return {
    version: 1,
    id: identity.id,
    name,
    createdAt: identity.createdAt,
    audioSettings,
    midiSettings,
    showSettings,
    triggerGuard,
    cues
  }
}
