// Normalising cues to the show's loudness target: measure each cue's file in the engine,
// then set every trim at once.
//
// The measuring is the slow half and happens first, for every cue; the writing is one edit
// — one undo step however many cues were in it (`patchCues`) — so a batch over a selection
// either lands whole or, if the operator undoes it, goes back whole. A cue whose file could
// not be measured, or is silent, is left as it was and said so in the result.

import type { AudioCue, Cue } from '../../../shared/cue'
import { audioRoutingOf } from '../../../shared/audioRouting'
import { normalizePlan, type CueLoudness, type NormalizePlan } from '../../../shared/loudness'
import type { AudioSettings } from '../../../shared/workspace'
import { audioEngine } from '../engine/audioEngineClient'

export interface NormalizeOutcome {
  cueId: string
  /** The plan that was applied, or null when the cue was left alone. */
  plan: NormalizePlan | null
  measured: CueLoudness | null
  /** Why a cue was left alone. */
  problem: string | null
}

/** Whether a cue is one normalise acts on: an audio cue with a file. */
export function normalizable(cue: Cue): cue is AudioCue {
  return cue.type === 'audio' && (cue as AudioCue).filePath !== ''
}

/**
 * Measures `cues` and returns the patch for each that can be normalised, with what was
 * found. The caller writes the patches as one edit.
 */
export async function planNormalize(
  cues: readonly Cue[],
  settings: AudioSettings
): Promise<{ patches: Record<string, Partial<AudioCue>>; outcomes: NormalizeOutcome[] }> {
  const routing = audioRoutingOf(settings)
  const patches: Record<string, Partial<AudioCue>> = {}
  const outcomes: NormalizeOutcome[] = []
  for (const cue of cues) {
    if (!normalizable(cue)) continue
    try {
      const loudness = await audioEngine.loudness(cue.filePath)
      const measured: CueLoudness = {
        filePath: cue.filePath,
        integratedLufs: Number(loudness.integratedLufs.toFixed(2)),
        truePeakDb: Number(loudness.truePeakDb.toFixed(2)),
        silent: loudness.silent
      }
      const plan = normalizePlan(loudness, routing.loudnessTargetLufs, routing.truePeakCeilingDb)
      patches[cue.id] = plan === null ? { loudness: measured } : { loudness: measured, trim: plan.trim }
      outcomes.push({ cueId: cue.id, plan, measured, problem: plan === null ? 'the file is silent' : null })
    } catch (error) {
      outcomes.push({
        cueId: cue.id,
        plan: null,
        measured: null,
        problem: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return { patches, outcomes }
}

/** One line for the log or the inspector: what a batch did. */
export function normalizeSummary(outcomes: readonly NormalizeOutcome[]): string {
  const done = outcomes.filter(outcome => outcome.plan !== null)
  const capped = done.filter(outcome => outcome.plan!.limitedBy !== 'target')
  const left = outcomes.length - done.length
  const parts = [`normalised ${done.length} cue${done.length === 1 ? '' : 's'}`]
  if (capped.length > 0) parts.push(`${capped.length} held short of the target`)
  if (left > 0) parts.push(`${left} left as ${left === 1 ? 'it was' : 'they were'}`)
  return parts.join(', ')
}
