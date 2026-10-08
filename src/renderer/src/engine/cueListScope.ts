// What the runner reads about a show's cue lists: one list's running order, and which of the
// cues it is running are in a given list.
//
// The runner was written for one list, where the cue after a cue is the next one in the array.
// With several, the next one in the array may be another list's, and a GO or an advance that
// walked into it would fire a cue nobody pressed for. So every walk the runner makes along the
// show is made along the cue's own list — and a show with one list, which is every show saved
// before lists existed, walks the array exactly as it always has.

import type { Cue } from '../../../shared/cue'
import { cuesOfList, listMembership, listOfCue, MAIN_CUE_LIST_ID } from '../../../shared/cueLists'

/** Whether every cue is in the main list: then the show's array is the list's running order. */
function oneList(cues: readonly Cue[]): boolean {
  return cues.every(cue => cue.listId === undefined)
}

/**
 * The running order a cue runs in: its own list's cues, children with their groups, in array
 * order. The array itself when the show has one list, so nothing about a one-list show moves.
 */
export function sequenceOf(cues: Cue[], cueId: string | null): Cue[] {
  if (oneList(cues)) return cues
  return cuesOfList(cues, listOfCue(cues, cueId) ?? MAIN_CUE_LIST_ID)
}

/** Which of these cue ids run in `listId`. */
export function idsInList(cues: readonly Cue[], ids: Iterable<string>, listId: string): string[] {
  const membership = listMembership(cues)
  return [...ids].filter(id => (membership.get(id) ?? MAIN_CUE_LIST_ID) === listId)
}
