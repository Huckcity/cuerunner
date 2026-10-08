import type { Cue } from '../../../shared/cue'
import { actedOnIds, expandTargets, fadeTargetIds, STOP_ALL, stopTargetIds } from '../../../shared/cueTargets'
import { cueLabel } from '../../../shared/showfile'
import type { RunningCue } from '../store'

/** How many targets a line names before it says how many more. */
const NAMED = 3

/**
 * What a cue acts on, as a line reads it — `2 Storm, 4 Rain`, `everything`, `5 cues` — or null
 * for a cue that acts on nothing. A target the show no longer has is said as such.
 */
export function actingOn(cue: Cue, cues: readonly Cue[]): string | null {
  if (cue.type === 'stop' && stopTargetIds(cue) === STOP_ALL) return 'everything'
  const ids = actedOnIds(cue)
  if (ids.length === 0) return cue.type === 'fade' || cue.type === 'stop' || cue.type === 'control' ? 'nothing chosen' : null
  const byId = new Map(cues.map(entry => [entry.id, entry]))
  const named = ids.slice(0, NAMED).map(id => {
    const target = byId.get(id)
    return target === undefined ? 'a cue not in this show' : cueLabel(target)
  })
  const more = ids.length - named.length
  return more > 0 ? `${named.join(', ')} +${more} more` : named.join(', ')
}

/**
 * The cues a fade that is running now is moving: every sound and light it names, and every one
 * inside a group it names. Read for the Active tab, which marks those rows as fading.
 */
export function fadedBy(cues: readonly Cue[], running: ReadonlyMap<string, RunningCue>): Set<string> {
  const fading = new Set<string>()
  for (const cue of cues) {
    if (cue.type !== 'fade') continue
    const run = running.get(cue.id)
    if (run === undefined || run.state !== 'playing') continue
    for (const target of expandTargets(cues, fadeTargetIds(cue))) {
      if (target.type === 'audio' || target.type === 'light') fading.add(target.id)
    }
  }
  return fading
}
