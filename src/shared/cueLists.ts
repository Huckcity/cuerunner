// A show's cue lists: more than one running order in one show, each its own tab, its own
// playhead and its own GO — the main sequence, a cart of sound effects, a pre-show loop.
//
// The representation is the smallest one that keeps the cue list's own invariant (AD-12,
// AD-28): the show still has one `cues` array, array order is still the running order, a
// group's children still sit behind it by `parentId`. What is new is a show-level list of
// the lists — id, name, colour and the few things a list decides for its cues — and a
// `listId` on a cue at the top level naming which of them it runs in. A child never carries
// one: it is in its group's list, which is what keeps a group whole whichever list it moves
// to. A cue with no `listId` is in the main list, whose id is fixed, so a show saved before
// lists existed is one list — the main one — and saves byte-identical: the section is
// written only when it says something the default does not.
//
// A list's running order is the array filtered to it (`cuesOfList`): its cues need not be
// contiguous in the array, and nothing reads them as if they were. Every walk that used to
// take "the next cue in the array" takes the next cue in the cue's own list instead.

import type { Cue, CueColor } from './cue'
import { TIMECODE_OFFSET_MAX_FRAMES } from './timecode'

/**
 * The main list's id: positional rather than minted, like a default DCA's, so two copies
 * of one show stay byte-identical and a cue with no `listId` always has a list to be in.
 */
export const MAIN_CUE_LIST_ID = 'main'

/** What the main list is called until somebody calls it something else. */
export const MAIN_CUE_LIST_NAME = 'Main Cue List'

/** How long a list's name may be: past this it is a sentence, not a tab. */
export const CUE_LIST_NAME_MAX = 60

/** One tile of a cart that answers a key of its own, wherever the show is standing. */
export interface CueListTileKey {
  cueId: string
  /** The key as `KeyboardEvent.key` names it, lower-cased: `q`, `f9`, `;`. */
  key: string
}

/** How one list follows the incoming clock, where it does not simply follow the show. */
export interface CueListTimecode {
  /** Whether this list's timecode triggers fire and chase at all. */
  enabled: boolean
  /** Frames added to every timecode trigger in this list: a list that starts a reel later. */
  offsetFrames: number
}

/**
 * One list of the show. Every field past the name is optional and written only when it
 * says something: a list that is a plain, armed, uncoloured running order following the
 * show's clock is an id and a name on disk.
 */
export interface CueListInfo {
  id: string
  name: string
  /** The tab's colour; absent is none. */
  color?: CueColor
  /** Shown as a wall of tiles rather than rows: a cart of sound effects. */
  cart?: boolean
  /** Taken out of the show whole: GO, triggers and the clock fire none of its cues. */
  disarmed?: boolean
  /** Its own enable and offset against the incoming clock; absent follows the show's. */
  timecode?: CueListTimecode
  /** The cart's own keys, tile by tile. */
  tileKeys?: CueListTileKey[]
}

/** The lists a show has when it says nothing about them: one, the main one. */
export function defaultCueLists(): CueListInfo[] {
  return [{ id: MAIN_CUE_LIST_ID, name: MAIN_CUE_LIST_NAME }]
}

/**
 * One list in the form the file writes it: the fields in one order, and an optional field
 * only where it says something. Every writer of a list goes through here, so two lists that
 * say the same thing are the same bytes.
 */
export function canonicalCueList(list: CueListInfo): CueListInfo {
  const out: CueListInfo = { id: list.id, name: list.name }
  if (list.color !== undefined && list.color !== 'none') out.color = list.color
  if (list.cart === true) out.cart = true
  if (list.disarmed === true) out.disarmed = true
  const tc = list.timecode
  if (tc !== undefined && (tc.enabled !== true || tc.offsetFrames !== 0)) {
    out.timecode = { enabled: tc.enabled, offsetFrames: tc.offsetFrames }
  }
  if (list.tileKeys !== undefined && list.tileKeys.length > 0) {
    out.tileKeys = list.tileKeys.map(entry => ({ cueId: entry.cueId, key: entry.key }))
  }
  return out
}

/** Whether a show's lists are the one a show has by default: then the file carries no section. */
export function isDefaultCueLists(lists: readonly CueListInfo[]): boolean {
  if (lists.length !== 1) return false
  const only = canonicalCueList(lists[0])
  return Object.keys(only).length === 2 && only.id === MAIN_CUE_LIST_ID && only.name === MAIN_CUE_LIST_NAME
}

/** A show's lists as the window holds them: a file that carries none is the main list alone. */
export function heldCueLists(saved: readonly CueListInfo[] | null | undefined): CueListInfo[] {
  return saved == null || saved.length === 0 ? defaultCueLists() : saved.map(canonicalCueList)
}

/**
 * What a file's lists say that this build cannot hold, once their fields have been held to
 * their kinds: an id twice, a list with no id, no main list for an unlabelled cue to be in, or
 * a tile key that is not one key. Null when there is none.
 */
export function cueListsRefusal(lists: readonly CueListInfo[]): string | null {
  if (lists.length === 0) return 'an empty list of cue lists'
  const seen = new Set<string>()
  for (const list of lists) {
    if (list.id.trim() === '') return 'a cue list with no id'
    if (seen.has(list.id)) return `two cue lists with the id “${list.id}”`
    seen.add(list.id)
    if (list.timecode !== undefined && !Number.isInteger(list.timecode.offsetFrames)) {
      return `a timecode offset on the cue list “${list.name}” that is not a whole number`
    }
  }
  if (!seen.has(MAIN_CUE_LIST_ID)) return 'no main cue list'
  return null
}

/** The bounds the list's own clock offset is held to: the show's own. */
export const CUE_LIST_OFFSET_MAX_FRAMES = TIMECODE_OFFSET_MAX_FRAMES

/** The list a cue at the top level names, read the way the file means it: none is the main list. */
export function ownListId(cue: Cue): string {
  return cue.listId ?? MAIN_CUE_LIST_ID
}

/**
 * Which list each cue runs in, by cue id: a cue at the top level is in the list it names, and
 * a child is in its parent's, however deep. One pass, because children follow their parents in
 * the array (AD-12); a child whose parent the pass has not seen — a file the funnel has not
 * repaired yet — is in its parent chain's list where the chain can be read, and in the main
 * list where it cannot.
 */
export function listMembership(cues: readonly Cue[]): Map<string, string> {
  const of = new Map<string, string>()
  let byId: Map<string, Cue> | null = null
  for (const cue of cues) {
    if (cue.parentId === null) {
      of.set(cue.id, ownListId(cue))
      continue
    }
    const parentList = of.get(cue.parentId)
    if (parentList !== undefined) {
      of.set(cue.id, parentList)
      continue
    }
    byId ??= new Map(cues.map(entry => [entry.id, entry]))
    of.set(cue.id, rootListId(byId, cue))
  }
  return of
}

/** The list a cue runs in, read up its parent chain; a chain that loops is the main list's. */
function rootListId(byId: ReadonlyMap<string, Cue>, cue: Cue): string {
  const seen = new Set<string>()
  let at: Cue | undefined = cue
  while (at !== undefined && at.parentId !== null) {
    if (seen.has(at.id)) return MAIN_CUE_LIST_ID
    seen.add(at.id)
    at = byId.get(at.parentId)
  }
  return at === undefined ? MAIN_CUE_LIST_ID : ownListId(at)
}

/** The list one cue runs in, or null when the show has no such cue. */
export function listOfCue(cues: readonly Cue[], cueId: string | null): string | null {
  if (cueId === null) return null
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  const cue = byId.get(cueId)
  return cue === undefined ? null : rootListId(byId, cue)
}

/**
 * One list's running order: the cues it holds, children with their groups, in array order.
 * This is what GO, an advance and the list on screen walk — the cue after a cue is the next
 * one in its own list, never the next one in another list that happens to sit behind it.
 */
export function cuesOfList(cues: readonly Cue[], listId: string): Cue[] {
  const membership = listMembership(cues)
  return cues.filter(cue => membership.get(cue.id) === listId)
}

/** The first cue at the top level of a list, where a list nobody has stood in starts. */
export function firstCueOfList(cues: readonly Cue[], listId: string): string | null {
  return cues.find(cue => cue.parentId === null && ownListId(cue) === listId)?.id ?? null
}

/** The `listId` a cue at the top level of a list writes: none for the main list. */
function listIdField(listId: string): string | undefined {
  return listId === MAIN_CUE_LIST_ID ? undefined : listId
}

/** A cue with its `listId` set to say `listId`, or the same cue when it already does. */
function inList(cue: Cue, listId: string | undefined): Cue {
  if (cue.listId === listId) return cue
  const next = { ...cue }
  if (listId === undefined) delete next.listId
  else next.listId = listId
  return next
}

/**
 * The cues of an edit, with every cue's `listId` saying the list it is in. An edit made in
 * one list's view does not know there are others: a cue it adds names no list, a cue it
 * takes out of a group was in its group's list, a cue it puts into a group carries a list a
 * child does not. So the rule is applied here, once, for every writer:
 *
 * - a cue the show already had stays in the list it was in, wherever in the tree it moved;
 * - a cue the edit made is in `activeListId` — the list the operator is looking at, which is
 *   where a paste, a drop or a toolbar press lands, whatever list the cue was copied from;
 * - a child carries no `listId`, and a cue at the top level of the main list carries none.
 *
 * Returns `next` itself when every cue already says the right thing, so an edit that
 * touches no list costs one pass and no copy.
 */
export function settleListIds(previous: readonly Cue[], next: Cue[], activeListId: string): Cue[] {
  const was = listMembership(previous)
  let out: Cue[] | null = null
  for (let at = 0; at < next.length; at++) {
    const cue = next[at]
    const want = cue.parentId !== null ? undefined : listIdField(was.get(cue.id) ?? activeListId)
    const settled = inList(cue, want)
    if (settled === cue) continue
    out ??= next.slice()
    out[at] = settled
  }
  return out ?? next
}

/**
 * The cues with some of them moved to the end of another list. A group goes with everything
 * under it; a child moved on its own leaves its group for the top level of the list it moves
 * to, as dragging it out would have; a cue whose group is moving too travels inside the
 * group. The blocks keep the order they had, and land after every cue the list already
 * holds — the array order is the running order, and the end is where a cue joins a list.
 * Cues already in that list are left where they are.
 */
export function moveToList(cues: readonly Cue[], ids: readonly string[], listId: string): Cue[] {
  const membership = listMembership(cues)
  const wanted = new Set(ids)
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  const ancestorWanted = (cue: Cue): boolean => {
    const seen = new Set<string>()
    for (let parent = cue.parentId; parent !== null && !seen.has(parent); parent = byId.get(parent)?.parentId ?? null) {
      if (wanted.has(parent)) return true
      seen.add(parent)
    }
    return false
  }
  const roots = new Set(
    cues
      .filter(cue => wanted.has(cue.id) && !ancestorWanted(cue) && membership.get(cue.id) !== listId)
      .map(cue => cue.id)
  )
  if (roots.size === 0) return cues as Cue[]

  const kept: Cue[] = []
  const moved: Cue[] = []
  // The subtree a root takes with it is the run of its descendants behind it (AD-12).
  const travelling = new Set<string>()
  for (const cue of cues) {
    if (roots.has(cue.id)) {
      travelling.add(cue.id)
      moved.push(inList({ ...cue, parentId: null }, listIdField(listId)))
      continue
    }
    if (cue.parentId !== null && travelling.has(cue.parentId)) {
      travelling.add(cue.id)
      moved.push(cue)
      continue
    }
    kept.push(cue)
  }
  return [...kept, ...moved]
}

/** The cues without the ones a list holds: what deleting the list takes with it. */
export function withoutList(cues: readonly Cue[], listId: string): Cue[] {
  const membership = listMembership(cues)
  return cues.filter(cue => membership.get(cue.id) !== listId)
}

/** A name for a new list that no list of the show already has: "Cue List 2", "Cue List 3"… */
export function newListName(lists: readonly CueListInfo[], stem = 'Cue List'): string {
  const taken = new Set(lists.map(list => list.name.trim().toLowerCase()))
  for (let n = lists.length + 1; ; n++) {
    const name = `${stem} ${n}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

/**
 * The list a remote names: by its id, then by its name as written (letter case aside), then by
 * its place among the tabs counting from 1. Null when no list answers to it.
 */
export function findCueList(lists: readonly CueListInfo[], ref: string): CueListInfo | null {
  const text = ref.trim()
  if (text === '') return null
  const byId = lists.find(list => list.id === text)
  if (byId) return byId
  const lower = text.toLowerCase()
  const byName = lists.find(list => list.name.trim().toLowerCase() === lower)
  if (byName) return byName
  if (/^\d{1,3}$/.test(text)) return lists[Number(text) - 1] ?? null
  return null
}

/** Whether a list fires anything: a list that has been taken out of the show does not. */
export function listArmed(lists: readonly CueListInfo[], listId: string): boolean {
  return lists.find(list => list.id === listId)?.disarmed !== true
}
