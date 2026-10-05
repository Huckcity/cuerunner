import type { Cue } from '../../../../shared/cue'

/**
 * How a cue reads in a list of cues to aim at: its number and its whole name.
 *
 * The name used to be cut at twenty characters, which is exactly where two cues from the
 * same scene stop being told apart — "Act 2 Scene 3 underscore (long)" and "… (short)"
 * were one entry twice. The select is held to the row's width by the panel's own layout,
 * so the list can say the name in full.
 */
export function targetLabel(cue: Pick<Cue, 'number' | 'name'>): string {
  return `${cue.number} ${cue.name || 'untitled'}`
}
