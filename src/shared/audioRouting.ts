// Older workspaces routed an audio cue through a list of outputs that carried a level
// and a pan each, and only the first entry ever reached the audio graph: the device and
// channel-pair fields beside them were written but never wired. The new schema has a
// master level and pan on the cue itself, and real crosspoints (file channel → device
// channel) for routing. This is the migration between the two, kept pure so the workspace
// loader and the tests can both call it.

import type { AudioCrosspoint } from '../renderer/src/types/cue'

export interface MigratedAudioRouting {
  /** Master level, 0–1. */
  volume: number
  /** Master pan, −1 (left) to 1 (right). */
  pan: number
  /** Crosspoints, or null for automatic channel routing. */
  outputs: AudioCrosspoint[] | null
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const isCrosspoint = (value: unknown): value is AudioCrosspoint => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.inputChannel === 'number' && typeof entry.outputChannel === 'number'
}

/**
 * Routing for one audio cue as the new schema wants it. Idempotent: a cue that already
 * carries a numeric master volume and pan is returned with its crosspoints untouched.
 *
 * A legacy cue's first output is preserved exactly — its level becomes the master
 * volume and its pan the master pan — which is what the old player actually played.
 * A legacy cue with no usable output (or an outputs list that was empty, which the old
 * player read as "default") becomes automatic routing at full level.
 */
export function migrateLegacyAudioRouting(cue: {
  volume?: unknown
  pan?: unknown
  outputs?: unknown
}): MigratedAudioRouting {
  const outputs = Array.isArray(cue.outputs) ? cue.outputs : null
  const master = typeof cue.volume === 'number' && typeof cue.pan === 'number'

  if (master) {
    const crosspoints = outputs?.filter(isCrosspoint) ?? null
    return {
      volume: clamp(cue.volume as number, 0, 1),
      pan: clamp(cue.pan as number, -1, 1),
      // An empty array is a deliberate silence and must survive as one; anything that
      // was not crosspoints on an already-migrated cue is no routing at all.
      outputs: outputs === null ? null : crosspoints && crosspoints.length > 0 ? crosspoints : outputs.length === 0 ? [] : null
    }
  }

  const first = outputs && outputs.length > 0 ? (outputs[0] as Record<string, unknown>) : null
  const volume = typeof first?.volume === 'number' ? (first.volume as number) : 1
  const pan = typeof first?.pan === 'number' ? (first.pan as number) : 0
  return { volume: clamp(volume, 0, 1), pan: clamp(pan, -1, 1), outputs: null }
}
