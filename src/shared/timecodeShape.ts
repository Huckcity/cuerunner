// The timecode section of the saved form, field by field: what the load funnel's shape check
// reads a file's `timecode` with. Declared the way the rest of the form's shapes are — the
// `satisfies` binds every field to `TimecodeShowSettings`, so a field added to the section and
// not declared here fails to compile — and kept beside the section's own module. What a kind
// cannot say — which words a rate or a stop behaviour may be — is `timecodeShowRefusal`'s
// (`./timecode`), which the funnel asks next.

import {
  TIMECODE_HOLD_MAX_MS,
  TIMECODE_HOLD_MIN_MS,
  TIMECODE_OFFSET_MAX_FRAMES,
  TIMECODE_TOLERANCE_MAX_FRAMES,
  type TimecodeShowSettings
} from './timecode'
import type { ShapeFields } from './workspaceSections'

export const TIMECODE_SHOW_SHAPE = {
  rate: 'string',
  holdMs: { bounded: [TIMECODE_HOLD_MIN_MS, TIMECODE_HOLD_MAX_MS] },
  chase: 'boolean',
  offsetFrames: { bounded: [-TIMECODE_OFFSET_MAX_FRAMES, TIMECODE_OFFSET_MAX_FRAMES] },
  onStop: 'string',
  toleranceFrames: { bounded: [0, TIMECODE_TOLERANCE_MAX_FRAMES] }
} as const satisfies ShapeFields<TimecodeShowSettings>
