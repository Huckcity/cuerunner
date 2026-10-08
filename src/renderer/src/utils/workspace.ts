import { savedShape, type WorkspaceValues } from '../../../shared/workspaceSections'
import type { Workspace } from '../../../shared/workspace'
import { isEmptyLighting, type LightingSettings } from '../../../shared/dmx'
import { isDefaultTimecodeShow, type TimecodeShowSettings } from '../../../shared/timecode'
import { canonicalCueList, isDefaultCueLists, type CueListInfo } from '../../../shared/cueLists'
import { isDefaultPictureSettings, type PictureSettings } from '../../../shared/visual'

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
//
// The lighting rig is the one section every caller has to name, even as nothing: it is
// optional on the saved form, so a call site that forgot it would compile and save a show
// without its rig. A show with no rig writes no section, the way a show with no past writes
// no history — so a show saved before lighting existed stays byte-identical.
//
// The show's timecode is a section every caller has to name, even as nothing: it is
// optional on the saved form, so a call site that forgot it would compile and save a show
// that had stopped chasing. A show that leaves it at the defaults writes no section — so a
// show saved before timecode existed, or that never touched it, stays byte-identical.
//
// The video outputs the same: named at every call, even where there are none, and a show with
// none writes no section.
//
// The cue lists are named by every caller the same way: a call site that forgot them would
// compile and save every list's cues into a show that has only its main list — which the load
// funnel would then repair into one list. A show with only its main list under its own name
// writes no section, so a show saved before lists existed stays byte-identical.
//
// And the show's picture settings: named at every call, and a show that leaves them at the
// defaults writes no section.
export function buildWorkspace(
  values: Omit<WorkspaceValues, 'version' | 'lighting' | 'timecode' | 'videoOutputs' | 'cueLists' | 'pictures'> & {
    lighting: LightingSettings | undefined
    timecode: TimecodeShowSettings | undefined
    videoOutputs: WorkspaceValues['videoOutputs']
    cueLists: CueListInfo[] | undefined
    pictures: PictureSettings | undefined
  }
): Workspace {
  return savedShape({
    version: 1,
    ...values,
    // A file with nothing to say about its past says nothing: an empty array here would
    // be the key every save of every show carries for no reason.
    history: values.history && values.history.length > 0 ? values.history : undefined,
    lighting: values.lighting === undefined || isEmptyLighting(values.lighting) ? undefined : values.lighting,
    timecode: values.timecode === undefined || isDefaultTimecodeShow(values.timecode) ? undefined : values.timecode,
    // The same for a show with no video output: its bytes are what they were before
    // outputs existed.
    videoOutputs: values.videoOutputs && values.videoOutputs.length > 0 ? values.videoOutputs : undefined,
    cueLists: values.cueLists === undefined || isDefaultCueLists(values.cueLists)
      ? undefined
      : values.cueLists.map(canonicalCueList),
    // And for a show whose pictures stay up until they are stopped, as they always did.
    pictures: values.pictures === undefined || isDefaultPictureSettings(values.pictures) ? undefined : values.pictures
  })
}
