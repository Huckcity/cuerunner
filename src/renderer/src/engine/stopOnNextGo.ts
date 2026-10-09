// Which pictures a GO takes down: the ones set to go on the next GO, whatever that GO fires.
//
// A caption, a title card, a still between scenes — pictures that are meant to be up until the
// show moves on, with no length of their own and no stop cue written for each. A picture cue
// says so itself (`stopOnNextGo`), or leaves it to the show's default (`PictureSettings`); the
// next press of GO — from the keyboard, the button, a trigger or a desk, since they all fire the
// same way (spine AD-21) — takes each one down over its own fade out.
//
// Two are left where they are: the cue the GO fires (a picture re-fired is replaced, not
// stopped), and a picture the GO's own crossfade is about to dissolve away — stopping it would
// cut the dissolve to black, which is the one thing a crossfade is there to avoid.
//
// "The next GO" is the next GO in the picture's own cue list (spine AD-28): a list is a running
// order of its own, and a sound effect fired from a cart list mid-scene must not wipe the
// surtitles the main list put up. A GO in another list leaves the picture alone; the picture's
// own list moving on is what takes it down.

import type { Cue } from '../../../shared/cue'
import { isVisualCue, outputFor, stopsOnNextGo, type PictureSettings, type VideoOutput } from '../../../shared/visual'
import { listMembership, MAIN_CUE_LIST_ID } from '../../../shared/cueLists'

export interface GoStop {
  cueId: string
  /** Over the picture's own fade out. */
  fadeMs: number
}

export function picturesTakenByGo(input: {
  cues: readonly Cue[]
  /** The cues whose pictures are up, or on their way up. */
  showing: readonly string[]
  /** The cue the GO fires. */
  incoming: Cue
  settings: PictureSettings
  outputs: readonly VideoOutput[]
}): GoStop[] {
  const { cues, showing, incoming, settings, outputs } = input
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  const membership = listMembership(cues)
  const list = (cueId: string): string => membership.get(cueId) ?? MAIN_CUE_LIST_ID
  const incomingList = list(incoming.id)
  const dissolving = isVisualCue(incoming) && incoming.crossfade
    ? { outputId: outputFor(outputs, incoming.outputId)?.id ?? null, layer: incoming.layer }
    : null
  const stops: GoStop[] = []
  for (const cueId of showing) {
    if (cueId === incoming.id) continue
    const cue = byId.get(cueId)
    if (cue === undefined || !isVisualCue(cue) || !stopsOnNextGo(cue, settings)) continue
    if (list(cueId) !== incomingList) continue
    if (dissolving !== null && dissolving.outputId !== null &&
      outputFor(outputs, cue.outputId)?.id === dissolving.outputId && cue.layer <= dissolving.layer) continue
    stops.push({ cueId, fadeMs: Math.max(0, cue.fadeOutDuration) })
  }
  return stops
}
