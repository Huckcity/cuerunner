import type { Cue } from '../../../shared/cue'
import { expandTargets } from '../../../shared/cueTargets'
import { isVisualCue } from '../../../shared/visual'

/**
 * Where a fade's targets go: each kind of level to the engine that holds it. A sound's level
 * and pan are the audio engine's — a video's sound among them — a light's intensity is the
 * lighting engine's, and a picture's opacity (a video's, an image's, a text's) is its output's.
 * A group named as a target reaches every cue inside it, however deep, and each of those goes
 * where its own kind goes; a cue with no level a fade can move — a wait, a MIDI cue — is named
 * in `inert`, so the runner can say a fade aimed only at those did nothing. A target the show no
 * longer has is named in `missing`.
 */
export interface FadeRoutes {
  /** The cues with a sound: audio cues, and video cues for their sound. */
  audio: string[]
  light: string[]
  /** The cues with a picture: video, image and text cues. */
  pictures: string[]
  /** Groups named directly: stopped whole when the fade stops its targets. */
  groups: string[]
  inert: string[]
  missing: string[]
}

export function fadeRoutes(cues: readonly Cue[], ids: readonly string[]): FadeRoutes {
  const known = new Set(cues.map(cue => cue.id))
  const routes: FadeRoutes = { audio: [], light: [], pictures: [], groups: [], inert: [], missing: [] }
  for (const id of ids) if (!known.has(id)) routes.missing.push(id)
  const named = new Set(ids)
  for (const cue of expandTargets(cues, ids)) {
    // A live input is a sound like a file's: a fade moves its level and pan the same way.
    if (cue.type === 'audio' || cue.type === 'input') routes.audio.push(cue.id)
    else if (cue.type === 'light') routes.light.push(cue.id)
    else if (isVisualCue(cue)) {
      routes.pictures.push(cue.id)
      if (cue.type === 'video') routes.audio.push(cue.id)
    }
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
