import type { AudioCue } from '../../../shared/cue'

/** The stretch of a file a scrub bar spans, ms from the file's own start. */
export interface ScrubRegion {
  startMs: number
  endMs: number
}

/**
 * The part of its file an audio cue plays — its in point to its out point, or to the end of
 * the file — which is what a bar dragged along drops the playhead into. Null when there is no
 * length to span yet: a file nobody has measured has no place for the end of the bar.
 */
export function scrubbableRegion(cue: Pick<AudioCue, 'startTime' | 'endTime' | 'duration'>): ScrubRegion | null {
  const endMs = cue.endTime ?? cue.duration
  if (!(endMs > cue.startTime)) return null
  return { startMs: cue.startTime, endMs }
}

/**
 * Where in the file a point on the bar is. The very end is held back a little, so a drag to
 * the right edge plays the last moment of the cue rather than ending it before a sound.
 */
export function scrubPositionMs(region: ScrubRegion, fraction: number): number {
  const clamped = Math.min(1, Math.max(0, fraction))
  const span = region.endMs - region.startMs
  const position = region.startMs + clamped * span
  return Math.round(Math.min(position, region.endMs - Math.min(250, span / 10)))
}
