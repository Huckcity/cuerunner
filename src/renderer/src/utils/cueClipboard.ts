import type { Cue } from '../../../shared/cue'
import { nextCueNumber } from './cueDefaults'
import { retargeted } from '../../../shared/cueTargets'

/**
 * Copy and paste of cues: what is held between the two, and where a paste puts it.
 *
 * What is held is a snapshot — the cues as they were when copied, a group's whole subtree with
 * it — so an edit made after the copy does not change what a paste brings, and the show they
 * came from can be closed and another opened before pasting into it. That is the move a
 * designer makes between shows: the walk-in sequence from last season, into this one.
 */

/** The media type a copy puts on the system clipboard beside its plain-text description. */
export const CUE_CLIPBOARD_TYPE = 'application/x-cuerunner-cues'

/**
 * The copied block: the cues asked for and their subtrees, in list order, each root's parent
 * cleared — a block is cues on their own, to be given a place by whoever pastes them.
 */
export function copyBlock(cues: readonly Cue[], ids: readonly string[]): Cue[] {
  const wanted = new Set(ids)
  const taken = new Set<string>()
  const block: Cue[] = []
  for (const cue of cues) {
    const underTaken = cue.parentId !== null && taken.has(cue.parentId)
    if (!wanted.has(cue.id) && !underTaken) continue
    taken.add(cue.id)
    block.push(underTaken ? { ...cue } : { ...cue, parentId: null })
  }
  return block
}

/** The block as a person would paste it into a note: one cue per line, number and name. */
export function describeBlock(block: readonly Cue[]): string {
  return block.map(cue => `${cue.parentId === null ? '' : '  '}${cue.number}\t${cue.name}`).join('\n')
}

/** A block read back off the clipboard, or null for text that is not one this build wrote. */
export function parseBlock(text: string): Cue[] | null {
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value) || value.length === 0) return null
    const cues = value.filter((entry): entry is Cue =>
      typeof entry === 'object' && entry !== null &&
      typeof (entry as Cue).id === 'string' && typeof (entry as Cue).type === 'string')
    return cues.length === value.length ? cues : null
  } catch {
    return null
  }
}

/**
 * The block made ready to go into `cues`: fresh ids, so the copies are cues of their own; the
 * next free numbers, as a duplicate takes; the subtree's parents pointing at their own copies;
 * a fade, stop or devamp aimed at a cue inside the block aimed at that cue's copy, so a copied
 * "music and its fade" fades the new music and not the old; and the roots placed in
 * `parentId`'s group (null for the top level).
 */
export function pastedBlock(block: readonly Cue[], cues: readonly Cue[], parentId: string | null): Cue[] {
  const copyOf = new Map(block.map(cue => [cue.id, crypto.randomUUID()]))
  let number = Number(nextCueNumber(cues))
  return block.map(cue => {
    const pasted: Cue = {
      ...cue,
      id: copyOf.get(cue.id)!,
      number: String(number++),
      parentId: cue.parentId === null ? parentId : copyOf.get(cue.parentId) ?? parentId
    }
    // A cue that acts on cues pasted with it acts on their copies — every target it names, in
    // the spelling it already used; a target outside the block is still the original.
    return retargeted(pasted, copyOf)
  })
}

/**
 * Where a paste goes: after the cue the operator stands on, past its subtree, in the same
 * group it is in — or at the end of the show when nothing is selected.
 */
export function pastePlace(cues: readonly Cue[], selectedId: string | null): { beforeIndex: number; parentId: string | null } {
  const at = selectedId === null ? -1 : cues.findIndex(cue => cue.id === selectedId)
  if (at < 0) return { beforeIndex: cues.length, parentId: null }
  const inside = new Set([cues[at].id])
  let end = at
  while (end + 1 < cues.length && cues[end + 1].parentId !== null && inside.has(cues[end + 1].parentId!)) {
    end++
    inside.add(cues[end].id)
  }
  return { beforeIndex: end + 1, parentId: cues[at].parentId }
}

/** What this window copied last: the snapshot a paste brings when the clipboard carries none. */
let held: Cue[] = []

export function holdBlock(block: Cue[]): void {
  held = block
}

export function heldBlock(): Cue[] {
  return held
}
