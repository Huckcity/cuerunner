// Folding a cue's silence trim into the region it plays.
//
// The operator's region and the measurement of the file are two different things and
// they stay two different things: the region is what the operator set — start, end, the
// two grips in the waveform — and the measurement is what the file turned out to be.
// What a trimmed cue plays is the intersection, so turning the trim off gives the whole
// region back, and a region edited while the trim is on is still exactly theirs the
// moment it is off. That is also why nothing here writes to the cue: a trim is a way of
// playing a region, not an edit to it.

import type { AudioCue, Cue } from '../types/cue'

/** The part of a file a cue plays, in ms from the file's start; a null end is the file's. */
export interface PlayRegion {
  startMs: number
  endMs: number | null
}

/**
 * What a cue plays, with the silence trim folded in when the trim is on and this machine
 * is licensed to apply it. `trim` is the caller's answer to both of those questions
 * (`CueEngine` reads them per firing), because a utility has no business knowing what a
 * licence is.
 *
 * A cue with the trim on and no measurement yet plays its whole region: the scan is a
 * pass over the file, and a GO that waited for one would be a GO waiting on a disk.
 *
 * A region the trim would empty is left as the operator set it — the intersection of the
 * two is not allowed to be nothing — and `trimAmounts` reports no trim for it, because
 * the trim is not what took that silence away.
 */
export function playRegion(cue: AudioCue, trim: boolean): PlayRegion {
  const sound = cue.soundRegion
  if (!trim || sound == null || sound.silent) {
    return { startMs: cue.startTime, endMs: cue.endTime }
  }
  const startMs = Math.max(cue.startTime, sound.startMs)
  const endMs = cue.endTime !== null ? Math.min(cue.endTime, sound.endMs) : sound.endMs
  // A region the trim would empty — the operator's region sitting entirely inside the
  // silence at one end — is left as they set it. The trim is there to drop silence, not
  // to take the cue away, and a cue that plays nothing is the one thing a region must
  // never be.
  if (endMs <= startMs) return { startMs: cue.startTime, endMs: cue.endTime }
  return { startMs, endMs }
}

/**
 * What the trim drops from the cue's own region, in ms: `headMs` and `tailMs`. Null when
 * there is nothing to report — the trim is off, nobody has measured the file, or the file
 * is quiet end to end. Counted against the region the operator set, so a region that
 * starts after the sound does reports no head trim: the trim is not what took that
 * silence away.
 */
export function trimAmounts(cue: AudioCue): { headMs: number; tailMs: number } | null {
  const sound = cue.soundRegion
  if (cue.trimSilence !== true || sound == null || sound.silent) return null
  const played = playRegion(cue, true)
  const endMs = cue.endTime ?? sound.durationMs
  return {
    headMs: Math.max(0, played.startMs - cue.startTime),
    tailMs: Math.max(0, endMs - (played.endMs ?? endMs))
  }
}

/**
 * The cues waiting to be measured: audio cues playing with the trim on, whose file is
 * there and nobody has scanned yet. What is left out is the settled cases — a cue with
 * no file to read, one already measured, and one whose scan the engine has refused —
 * with the refusal keyed by path, so a cue relinked to a different file is a question
 * nobody has asked yet.
 *
 * A file the workspace could not find is left in: the scan is what answers for it, and
 * its refusal is what the cue's panel reads, rather than a cue left saying it is still
 * measuring a file that is not there.
 */
export function cuesAwaitingSilence(cues: Cue[], failures: Record<string, string>): AudioCue[] {
  const awaiting: AudioCue[] = []
  for (const cue of cues) {
    if (cue.type !== 'audio') continue
    if (cue.trimSilence !== true) continue
    if (cue.filePath === '') continue
    if (cue.soundRegion != null) continue
    if (failures[cue.id] === cue.filePath) continue
    awaiting.push(cue)
  }
  return awaiting
}
