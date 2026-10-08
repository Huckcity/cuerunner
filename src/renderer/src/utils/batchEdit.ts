import { createCue, FADE_DEFAULTS } from './cueDefaults'
import { isVisualCue } from '../../../shared/visual'
import type { Cue, FadeCue, StopCue } from '../../../shared/cue'

/**
 * What a batch edit from the cue list's menu sets across the selection. A field left out is
 * left as each cue has it; a field that only one kind of cue carries — an audio cue's level
 * and fades — is written to the cues that carry it and to no other, so a wait in the set is
 * not handed a volume it has nowhere to use.
 */
export interface BatchEdit {
  /** ms */
  preWait?: number
  /** ms */
  postWait?: number
  advance?: Cue['advance']
  /** 0–1, as the inspector's slider writes it. */
  volume?: number
  /** ms */
  fadeInDuration?: number
  /** ms */
  fadeOutDuration?: number
}

const EVERY_CUE = ['preWait', 'postWait', 'advance'] as const
const AUDIO_ONLY = ['volume', 'fadeInDuration', 'fadeOutDuration'] as const

/** Whether the edit touches the fields only an audio cue has. */
export function editsAudio(edit: BatchEdit): boolean {
  return AUDIO_ONLY.some(field => edit[field] !== undefined)
}

/**
 * The patch each cue in the set gets, by id. A cue the edit has nothing to say to is left out
 * of the result rather than handed an empty patch, so the edit is exactly the cues it changes.
 */
export function batchPatches(cues: readonly Cue[], ids: readonly string[], edit: BatchEdit): Record<string, Partial<Cue>> {
  const wanted = new Set(ids)
  const patches: Record<string, Partial<Cue>> = {}
  for (const cue of cues) {
    if (!wanted.has(cue.id)) continue
    const patch: Record<string, unknown> = {}
    for (const field of EVERY_CUE) {
      if (edit[field] !== undefined) patch[field] = edit[field]
    }
    if (cue.type === 'audio') {
      for (const field of AUDIO_ONLY) {
        if (edit[field] !== undefined) patch[field] = edit[field]
      }
    }
    // A value that is already the cue's is no change to it.
    const changed = Object.entries(patch).filter(([field, value]) => (cue as unknown as Record<string, unknown>)[field] !== value)
    if (changed.length > 0) patches[cue.id] = Object.fromEntries(changed) as Partial<Cue>
  }
  return patches
}

/**
 * New numbers for the cues asked for, in list order: `from`, then `from + step` and on, written
 * to the decimals the step has (from `1` by `0.5` reads `1`, `1.5`, `2`). A number another
 * cue keeps is not handed out twice — the answer is then a reason rather than a plan, because
 * two cues called 12 is a call the stage manager cannot make.
 */
export function renumbered(
  cues: readonly Cue[],
  ids: readonly string[],
  from: number,
  step: number
): { ok: true; patches: Record<string, Partial<Cue>> } | { ok: false; reason: string } {
  if (!Number.isFinite(from) || !Number.isFinite(step) || step <= 0) {
    return { ok: false, reason: 'A start and a step above zero are needed' }
  }
  const wanted = new Set(ids)
  const decimals = Math.max(decimalsOf(from), decimalsOf(step))
  const patches: Record<string, Partial<Cue>> = {}
  const given = new Set<string>()
  let next = from
  for (const cue of cues) {
    if (!wanted.has(cue.id)) continue
    // Rounded to the step's own decimals and written without trailing zeros: 1, 1.5, 2.
    const number = String(Number(next.toFixed(decimals)))
    given.add(number)
    if (cue.number !== number) patches[cue.id] = { number }
    next += step
  }
  const clash = cues.find(cue => !wanted.has(cue.id) && given.has(cue.number.trim()))
  if (clash) return { ok: false, reason: `Cue ${clash.number} is already called that` }
  return { ok: true, patches }
}

function decimalsOf(value: number): number {
  const text = String(value)
  return text.includes('.') ? Math.min(3, text.length - text.indexOf('.') - 1) : 0
}

/** The two cues a selection can have made for it: a fade out, or a stop. */
export type TargetingKind = 'fade' | 'stop'

/**
 * Whether a cue is something the kind can act on. A fade moves a level — a sound's, a light's
 * intensity, everything inside a group — so it is aimed at those; a stop takes away anything
 * that runs, which is every cue but a note.
 */
export function canTarget(kind: TargetingKind, cue: Cue): boolean {
  if (kind === 'fade') return cue.type === 'audio' || cue.type === 'light' || cue.type === 'group' || isVisualCue(cue)
  return cue.type !== 'memo'
}

/**
 * The cue a "fade these out" or "stop these" makes: one cue, aimed at every target in list
 * order, named for the one it acts on or for how many. A fade or a stop names any set of cues,
 * so one GO reaches them all from one row, with one time to edit.
 *
 * Several used to be a timeline group holding a cue aimed at each, because a cue could only
 * name one. Nothing is better about that shape now: a target that needs its own fade time is a
 * cue of its own, which is one Duplicate away, and the group cost the show a row per target.
 */
export function targetingBlock(kind: TargetingKind, targets: readonly Cue[], number: string): Cue[] {
  const aimedAt = targets.filter(target => canTarget(kind, target))
  if (aimedAt.length === 0) return []
  const ids = aimedAt.map(target => target.id)
  const named = aimedAt.length === 1 ? aimedAt[0].name : `${aimedAt.length} cues`
  if (kind === 'fade') {
    const fade: FadeCue = {
      ...(createCue('fade', number) as FadeCue),
      name: `Fade out ${named}`,
      targetCueIds: ids,
      // A fade made from the list is the fade an operator reaches for there: to silence — or,
      // for pictures with no sound of their own, to black — and the cues taken away once they
      // get there.
      fadeProperty: aimedAt.every(target => target.type === 'image' || target.type === 'text') ? 'opacity' : 'volume',
      targetValue: 0,
      stopTargetWhenDone: true,
      duration: FADE_DEFAULTS.duration
    }
    return [fade]
  }
  const stop = createCue('stop', number) as StopCue
  delete (stop as Partial<StopCue>).targetCueId
  return [{ ...stop, name: `Stop ${named}`, targetCueIds: ids }]
}
