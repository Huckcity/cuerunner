import type { AudioCue } from '../../../shared/cue'

/**
 * Splitting one audio cue into two that play what it played, end to end.
 *
 * This is a duplication with slices rather than a trim: both halves stay ordinary audio
 * cues, so a group, a timeline or a trigger holds them exactly as it held the original,
 * and nothing downstream has to know a split happened. What the operator chose at the
 * moment of splitting is rarely where the boundary should be, so the split is not final —
 * both boundaries can be dragged afterwards, and moving one moves both, because a pair
 * that no longer meets is two cues rather than one that was cut.
 *
 * The region is expressed in file time, and `null` end means the end of the file, which
 * is where a split leaves it: the tail half keeps `endTime: null` so it still ends with
 * the file if a longer file is later chosen.
 *
 * What fires the cue — its triggers and the script line it is pinned to — stays with the
 * head, which is the half that kept the cue's identity. Both halves are the same music cut
 * in two, not two cues the same message should fire.
 */

/** What one split produces: the head of the cue, and the tail that continues it. */
export interface CueSplit {
  head: AudioCue
  /** The tail is a new cue: it takes a fresh id and number, and one of the pair's names. */
  tail: Omit<AudioCue, 'id' | 'number' | 'name'>
  /** What the pair is called, before the numbering that keeps the two distinct. */
  baseName: string
}

/** Where a cue's region ends, in file milliseconds: its own end, or the file's. */
export function regionEndMs(cue: AudioCue): number {
  return cue.endTime ?? cue.duration
}

/** How a half is named: one name for both, numbered so the pair reads as a pair. */
export function partName(base: string, existingNames: Set<string>): string {
  if (!existingNames.has(base)) return base
  for (let n = 2; n <= existingNames.size + 1; n++) {
    const candidate = `${base} ${n}`
    if (!existingNames.has(candidate)) return candidate
  }
  return base
}

/**
 * Splits a cue, or answers `null` when the point is not inside its region — a split at
 * the head or the tail would make an empty cue, and one outside the region is not this
 * cue's business at all.
 */
export function splitAudioCue(cue: AudioCue, atMs: number): CueSplit | null {
  const from = cue.startTime
  const to = regionEndMs(cue)
  if (to <= from) return null
  if (atMs <= from || atMs >= to) return null

  // What the pair is called, before the numbering that keeps the two apart: the name the
  // operator gave the cue. A track cut in two is still that track, and a name the app
  // invents ("Clip 3") is a name the operator has to correct before they can see which
  // two rows are the pair. A cue that has no name of its own is named by its number,
  // which is what the list shows for it anyway.
  const baseName = cue.name.trim() === '' ? `Clip ${cue.number}` : cue.name
  const tail: Omit<AudioCue, 'id' | 'number' | 'name'> = {
    ...cue,
    // The cut is a butt splice: nothing fades in where the operator is trying to make
    // the join seamless, and they can put one back if that is what they meant.
    fadeInDuration: 0,
    startTime: atMs,
    endTime: cue.endTime,
    // What fires the cue stays with the half that kept its identity. A tail that carried
    // the same OSC address or MIDI note would be fired by the same message as the head —
    // one press, two cues — and the script line a cue is pinned to is the line it was
    // cut from, which is now the head's.
    triggers: [],
    scriptLine: null
  }
  return {
    head: { ...cue, endTime: atMs },
    tail,
    baseName
  }
}
