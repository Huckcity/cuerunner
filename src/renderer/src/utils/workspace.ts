import { savedShape, type WorkspaceValues } from '../../../shared/workspaceSections'
import type { Workspace } from '../../../shared/workspace'

// The saved form of the current session. A real save and an autosave snapshot are built
// the same way, so a recovered workspace has the shape a saved one does.
//
// The values are keyed by the saved form's own declaration: a required section added
// there is a value every one of these call sites stops compiling without, and a key the
// shape does not declare cannot be passed at all. The optional sections keep
// `Workspace`'s own optionality — a session with nothing to say about its history writes
// no history key — and `version` is the one value no caller has: the format's own
// literal, fixed by `Workspace`.
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
export function buildWorkspace(values: Omit<WorkspaceValues, 'version'>): Workspace {
  return savedShape({
    version: 1,
    ...values,
    // A file with nothing to say about its past says nothing: an empty array here would
    // be the key every save of every show carries for no reason.
    history: values.history && values.history.length > 0 ? values.history : undefined
  })
}
