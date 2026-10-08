import { createCue, FADE_DEFAULTS } from './cueDefaults'
import type { Cue, FadeCue, GroupCue, StopCue } from '../../../shared/cue'

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

/** The two cues a selection can have made for it: a fade out, or a stop. */
export type TargetingKind = 'fade' | 'stop'

/**
 * Whether a cue is something the kind can act on. A fade moves a sound's level, so it is
 * aimed at audio cues; a stop takes away anything that runs, which is every cue but a note.
 */
export function canTarget(kind: TargetingKind, cue: Cue): boolean {
  if (kind === 'fade') return cue.type === 'audio'
  return cue.type !== 'memo'
}

function aimed(kind: TargetingKind, target: Cue, number: string): FadeCue | StopCue {
  if (kind === 'fade') {
    return {
      ...(createCue('fade', number) as FadeCue),
      name: `Fade out ${target.name}`,
      targetCueId: target.id,
      // A fade made from the list is the fade an operator reaches for there: to silence,
      // and the cue taken away once it gets there.
      fadeProperty: 'volume',
      targetValue: 0,
      stopTargetWhenDone: true,
      duration: FADE_DEFAULTS.duration
    }
  }
  return { ...(createCue('stop', number) as StopCue), name: `Stop ${target.name}`, targetCueId: target.id }
}

/**
 * The cues a "fade these out" or "stop these" makes, in list order. One target is one cue
 * aimed at it. Several are one GO's worth: a timeline group with a cue aimed at each at
 * offset zero, so they all go together and the group is the one row the show steps over.
 *
 * Fade and stop cues name one target each, which is what this app's cue model is; the group
 * is how one press reaches several, and it reads as such on the list.
 */
export function targetingBlock(kind: TargetingKind, targets: readonly Cue[], number: string): Cue[] {
  const aimedAt = targets.filter(target => canTarget(kind, target))
  if (aimedAt.length === 0) return []
  if (aimedAt.length === 1) return [aimed(kind, aimedAt[0], number)]
  const group: GroupCue = {
    ...(createCue('group', number) as GroupCue),
    name: `${kind === 'fade' ? 'Fade out' : 'Stop'} ${aimedAt.length} cues`,
    mode: 'timeline'
  }
  const children = aimedAt.map((target, index) => ({
    ...aimed(kind, target, `${number}.${index + 1}`),
    parentId: group.id,
    timelineOffset: 0
  }))
  return [group, ...children]
}
