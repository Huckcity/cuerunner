import { CUE_TYPES, type CueType } from '../../../shared/cue'

/**
 * A cue type being dragged off the toolbar, as the drag carries it. Its own media type, so the
 * list can tell a new cue from a row being moved (`application/x-cue-render-index`) and from
 * files off the desktop (`Files`) while the drag is still in the air — the payload itself is
 * only readable on the drop.
 */
export const NEW_CUE_DRAG_TYPE = 'application/x-cuerunner-new-cue'

/** Starts a toolbar drag of one cue type. */
export function startNewCueDrag(dataTransfer: DataTransfer, type: CueType): void {
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(NEW_CUE_DRAG_TYPE, type)
}

/** Whether a drag in the air is a new cue off the toolbar. */
export function isNewCueDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(NEW_CUE_DRAG_TYPE)
}

/** The cue type a drop carries, or null for one that names no type this build has. */
export function droppedCueType(dataTransfer: DataTransfer): CueType | null {
  const type = dataTransfer.getData(NEW_CUE_DRAG_TYPE)
  return (CUE_TYPES as readonly string[]).includes(type) ? type as CueType : null
}
