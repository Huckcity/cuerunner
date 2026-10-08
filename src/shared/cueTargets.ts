// The cues a cue acts on, read one way wherever they are read.
//
// A Fade and a Stop cue used to name one target in `targetCueId`; they name a list now, in
// `targetCueIds`. A show saved before the list existed is not rewritten on load — the load
// funnel migrates nothing, and a show that has not been edited saves the bytes it was opened
// with — so the single field stays legal on disk and is read here as a list of one. An edit of
// the targets writes the list and takes the single field away (`fadeTargetsPatch`,
// `stopTargetsPatch`), which is the moment the show changes shape: because the operator
// changed it. An OSC cue's messages are read the same way (`oscMessages`).
//
// Everything that reads a target — the runner, the inspectors, the batch cues, the Active tab,
// the compare view, the merge, the clipboard, the importer — reads it through here, so the two
// spellings cannot be read two ways.

import type { ControlCue, Cue, FadeCue, OscCue, OscMessage, OscPatch, StopCue } from './cue'

/** The word a stop of everything is written as, in `targetCueId`. */
export const STOP_ALL = 'all'

/** The cues a fade moves, in the order it names them: the list, or the one a legacy fade named. */
export function fadeTargetIds(cue: Pick<FadeCue, 'targetCueId' | 'targetCueIds'>): string[] {
  if (Array.isArray(cue.targetCueIds)) return [...cue.targetCueIds]
  return typeof cue.targetCueId === 'string' && cue.targetCueId !== '' ? [cue.targetCueId] : []
}

/**
 * What a stop takes away: `'all'`, or the cues it names. A list wins over the single field; a
 * stop with neither names nothing, which the runner reports rather than reads as everything.
 */
export function stopTargetIds(cue: Pick<StopCue, 'targetCueId' | 'targetCueIds'>): string[] | typeof STOP_ALL {
  if (Array.isArray(cue.targetCueIds)) return [...cue.targetCueIds]
  if (cue.targetCueId === STOP_ALL) return STOP_ALL
  return typeof cue.targetCueId === 'string' && cue.targetCueId !== '' ? [cue.targetCueId] : []
}

/**
 * The patch that makes a fade name these cues. The single field is taken away by naming it
 * undefined, which the store's patch reads as "remove" — a cue carries one spelling, never two.
 */
export function fadeTargetsPatch(ids: readonly string[]): Pick<FadeCue, 'targetCueId' | 'targetCueIds'> {
  return { targetCueIds: [...new Set(ids)], targetCueId: undefined }
}

/** The patch that makes a stop take away everything, or these cues. */
export function stopTargetsPatch(
  ids: readonly string[] | typeof STOP_ALL
): Pick<StopCue, 'targetCueId' | 'targetCueIds'> {
  if (ids === STOP_ALL) return { targetCueId: STOP_ALL, targetCueIds: undefined }
  return { targetCueIds: [...new Set(ids)], targetCueId: undefined }
}

/** A cue with its patch applied and every field the patch names as undefined taken off. */
export function withPatch<T extends object>(cue: T, patch: Partial<T>): T {
  const next = { ...cue, ...patch } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key]
  return next as T
}

/**
 * The cues a cue acts on, whatever its type: a fade's, a stop's (none for "all"), a control
 * cue's, a devamp's. Every other type names none. This is the list the clipboard re-points
 * and the cue list draws its "acts on" from.
 */
export function actedOnIds(cue: Cue): string[] {
  switch (cue.type) {
    case 'fade': return fadeTargetIds(cue)
    case 'stop': {
      const ids = stopTargetIds(cue)
      return ids === STOP_ALL ? [] : ids
    }
    case 'control': return [...(cue as ControlCue).targetCueIds]
    case 'devamp': return cue.targetCueId === '' ? [] : [cue.targetCueId]
    default: return []
  }
}

/**
 * The same cue re-pointed: every target the map names is replaced by what it maps to, in the
 * spelling the cue already used — a legacy single target stays a single target. A paste of a
 * block that holds both a fade and its target is the one caller.
 */
export function retargeted<T extends Cue>(cue: T, map: ReadonlyMap<string, string>): T {
  const swap = (id: string): string => map.get(id) ?? id
  switch (cue.type) {
    case 'fade':
    case 'stop': {
      const next = { ...cue } as FadeCue | StopCue
      if (Array.isArray(next.targetCueIds)) next.targetCueIds = next.targetCueIds.map(swap)
      if (typeof next.targetCueId === 'string' && next.targetCueId !== STOP_ALL) next.targetCueId = swap(next.targetCueId)
      return next as T
    }
    case 'control':
      return { ...cue, targetCueIds: (cue as ControlCue).targetCueIds.map(swap) }
    case 'devamp':
      return { ...cue, targetCueId: swap(cue.targetCueId) }
    default:
      return cue
  }
}

/**
 * The targets expanded to what they hold: each named cue, and under a group every cue inside
 * it however deep, once each, in list order. A fade aimed at a group fades every sound in it;
 * a stop aimed at a group already takes its subtree, and reads its own walk.
 */
export function expandTargets(cues: readonly Cue[], ids: readonly string[]): Cue[] {
  const wanted = new Set(ids)
  const found: Cue[] = []
  const inside = new Set<string>()
  for (const cue of cues) {
    const under = cue.parentId !== null && inside.has(cue.parentId)
    if (wanted.has(cue.id) || under) {
      found.push(cue)
      if (cue.type === 'group') inside.add(cue.id)
    }
  }
  return found
}

/**
 * An OSC cue's messages, in the order it sends them: its list, or the one message a cue
 * written before lists existed carries in its own four fields.
 */
export function oscMessages(cue: OscCue): OscMessage[] {
  if (Array.isArray(cue.messages)) return cue.messages
  return [{
    patchId: '',
    host: cue.host ?? '',
    port: cue.port ?? 0,
    address: cue.address ?? '',
    args: cue.args ?? []
  }]
}

/** The patch that gives an OSC cue these messages, taking the single message's fields away. */
export function oscMessagesPatch(messages: readonly OscMessage[]): Partial<OscCue> {
  return {
    messages: messages.map(message => ({ ...message, args: message.args.map(arg => ({ ...arg })) })),
    host: undefined,
    port: undefined,
    address: undefined,
    args: undefined
  }
}

/**
 * Where one message goes: its patch's host and port when it names a patch the show has, its
 * own otherwise. A patch that was deleted is a sentence, not a guess — the message is not sent
 * to wherever its own fields last pointed.
 */
export function oscDestination(
  message: OscMessage,
  patches: readonly OscPatch[]
): { host: string; port: number; via: string | null } | { error: string } {
  if (message.patchId === '') return { host: message.host, port: message.port, via: null }
  const patch = patches.find(candidate => candidate.id === message.patchId)
  if (patch === undefined) return { error: 'its OSC patch is not in this show' }
  return { host: patch.host, port: patch.port, via: patch.name }
}
