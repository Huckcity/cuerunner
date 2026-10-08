import type { Cue } from '../../../shared/cue'
import { expandTargets } from '../../../shared/cueTargets'

/**
 * Where a fade's targets go: each kind of level to the engine that holds it. A sound's level
 * and pan are the audio engine's, a light's intensity is the lighting engine's. A group named
 * as a target reaches every cue inside it, however deep, and each of those goes where its own
 * kind goes; a cue with no level a fade can move — a wait, a MIDI cue — is named in `inert`, so
 * the runner can say a fade aimed only at those did nothing. A target the show no longer has is
 * named in `missing`.
 *
 * Picture cues' opacity is the outputs' to fade, and joins here as its own route where the
 * outputs exist.
 */
export interface FadeRoutes {
  audio: string[]
  light: string[]
  /** Groups named directly: stopped whole when the fade stops its targets. */
  groups: string[]
  inert: string[]
  missing: string[]
}

export function fadeRoutes(cues: readonly Cue[], ids: readonly string[]): FadeRoutes {
  const known = new Set(cues.map(cue => cue.id))
  const routes: FadeRoutes = { audio: [], light: [], groups: [], inert: [], missing: [] }
  for (const id of ids) if (!known.has(id)) routes.missing.push(id)
  const named = new Set(ids)
  for (const cue of expandTargets(cues, ids)) {
    if (cue.type === 'audio') routes.audio.push(cue.id)
    else if (cue.type === 'light') routes.light.push(cue.id)
    else if (cue.type === 'group') {
      if (named.has(cue.id)) routes.groups.push(cue.id)
    } else if (named.has(cue.id)) routes.inert.push(cue.id)
  }
  return routes
}

/**
 * A stop's targets in the order they are taken away: the groups first, so a child stopped in
 * the same breath cannot settle its group on to its next step, then everything else, each once.
 */
export function stopOrder(cues: readonly Cue[], ids: readonly string[]): { ordered: Cue[]; missing: string[] } {
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  const seen = new Set<string>()
  const groups: Cue[] = []
  const rest: Cue[] = []
  const missing: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const cue = byId.get(id)
    if (cue === undefined) missing.push(id)
    else if (cue.type === 'group') groups.push(cue)
    else rest.push(cue)
  }
  return { ordered: [...groups, ...rest], missing }
}
