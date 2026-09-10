import type { Cue } from '../types/cue'

/**
 * Wall-clock length of a group cue, derived from its children. A group's own
 * `duration` field is never written, so it always reads 0 in the cue list.
 *
 * - `sequence` sums its children's lengths;
 * - `timeline` ends at the furthest child (`timelineOffset + child length`);
 * - `playlist` fires one child per GO and `random` picks one, so neither has a
 *   knowable length → 0.
 *
 * Nested groups recurse. A malformed parent chain (a group that is its own
 * ancestor) stops at the repeated group instead of looping forever. Returns 0
 * when the group does not exist or its length cannot be known.
 */
export function groupDurationMs(cues: Cue[], groupId: string): number {
  const group = cues.find(c => c.id === groupId)
  if (!group || group.type !== 'group') return 0
  return cueLengthMs(cues, group, new Set())
}

function cueLengthMs(cues: Cue[], cue: Cue, seen: Set<string>): number {
  if (cue.type !== 'group') return cue.duration
  if (seen.has(cue.id)) return 0
  seen.add(cue.id)
  if (cue.mode === 'playlist' || cue.mode === 'random') return 0

  const children = cues.filter(c => c.parentId === cue.id)

  if (cue.mode === 'timeline') {
    let end = 0
    for (const child of children) {
      end = Math.max(end, child.timelineOffset + cueLengthMs(cues, child, seen))
    }
    return end
  }

  // sequence
  let total = 0
  for (const child of children) total += cueLengthMs(cues, child, seen)
  return total
}
