// The cue colour palette, in one place: the swatch rows (the inspector, the context menu)
// and the bar on every cue row all draw the same eight colours, and a label added to one
// of them without the others would be a colour a cue cannot be set to.
import type { CueColor } from '../types/cue'

/** The swatches, in the order every picker offers them. */
export const CUE_COLORS: CueColor[] = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']

export const CUE_COLOR_VAR: Record<CueColor, string> = {
  none:   'var(--cue-color-none)',
  red:    'var(--cue-color-red)',
  orange: 'var(--cue-color-orange)',
  yellow: 'var(--cue-color-yellow)',
  green:  'var(--cue-color-green)',
  blue:   'var(--cue-color-blue)',
  purple: 'var(--cue-color-purple)',
  pink:   'var(--cue-color-pink)',
}

/** The same colours where a swatch has to be drawn without a token — 'none' is a border. */
export const CUE_COLOR_SWATCH: Record<CueColor, string> = {
  ...CUE_COLOR_VAR,
  none: 'var(--border-input)'
}