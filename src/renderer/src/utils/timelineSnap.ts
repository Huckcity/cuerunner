import type { Cue } from '../types/cue'

/**
 * How close, in screen pixels, a dragged block's edge has to come to a snap point
 * before it locks on. Measuring in pixels rather than milliseconds keeps the pull
 * feeling the same at every zoom level.
 */
export const SNAP_THRESHOLD_PX = 8

export interface SnapResult {
  /** The block's offset in ms — unchanged when nothing was close enough. */
  offset: number
  /** The time the block locked onto, or null when it did not snap. */
  guideMs: number | null
}

/**
 * Times a dragged block can lock onto: the start of the group, plus both edges of
 * every sibling. The dragged block is left out because a block must not snap to
 * itself.
 */
export function snapTargetsFor(children: Cue[], draggedId: string): number[] {
  const targets = [0]
  for (const child of children) {
    if (child.id === draggedId) continue
    targets.push(child.timelineOffset, child.timelineOffset + child.duration)
  }
  return targets
}

/**
 * Snaps a dragged block to the nearest target edge. Both ends of the block are
 * candidates, so a block dropped after another lands flush with its end instead of
 * merely near it.
 *
 * Targets are expected to include the group start (see `snapTargetsFor`): that makes
 * the block's leading edge the closest candidate whenever a trailing-edge snap would
 * land before 0, so a drag can pull a block back to the start but never past it.
 */
export function snapOffset(
  rawOffsetMs: number,
  durationMs: number,
  targets: readonly number[],
  pxPerMs: number,
  thresholdPx: number = SNAP_THRESHOLD_PX
): SnapResult {
  const raw = Math.max(0, Math.round(rawOffsetMs))
  const thresholdMs = thresholdPx / pxPerMs

  let snappedOffset: number | null = null
  let guideMs: number | null = null
  let closest = Infinity

  for (const edge of [raw, raw + durationMs]) {
    for (const target of targets) {
      const distance = Math.abs(target - edge)
      if (distance > thresholdMs || distance >= closest) continue
      closest = distance
      snappedOffset = raw + target - edge
      guideMs = target
    }
  }

  return snappedOffset === null ? { offset: raw, guideMs: null } : { offset: snappedOffset, guideMs }
}
