// The cue lists section of the saved form, field by field: what the load funnel's shape check
// reads a file's `cueLists` with, element by element. Declared the way the rest of the form's
// shapes are — the `satisfies` binds every field to `CueListInfo`, so a field added to a list
// and not declared here fails to compile — and kept beside the section's own module. What a kind
// cannot say — an id twice, no main list — is `cueListsRefusal`'s (`./cueLists`), which the
// funnel asks next.

import { CUE_LIST_OFFSET_MAX_FRAMES, type CueListInfo } from './cueLists'
import type { ShapeFields } from './workspaceSections'

export const CUE_LIST_SHAPE = {
  id: 'string',
  name: 'string',
  color: { absent: true, of: 'string' },
  cart: { absent: true, of: 'boolean' },
  disarmed: { absent: true, of: 'boolean' },
  timecode: {
    absent: true,
    of: {
      enabled: 'boolean',
      offsetFrames: { bounded: [-CUE_LIST_OFFSET_MAX_FRAMES, CUE_LIST_OFFSET_MAX_FRAMES] }
    }
  },
  tileKeys: { absent: true, of: { elements: { cueId: 'string', key: 'string' } } }
} as const satisfies ShapeFields<CueListInfo>

/** The section as the funnel reads it: a list whose every element is one list's fields. */
export const CUE_LISTS_SHAPE = { elements: CUE_LIST_SHAPE } as const
