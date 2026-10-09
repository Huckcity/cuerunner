// The store's half of a show's cue lists: the rule every write is held to, applied once for
// every writer rather than taught to each of them.
//
// The store's cue edits were written for one list and are not rewritten for several: a cue
// they add names no list, a cue they move in or out of a group does not know a list is a thing
// it could be in. `withCueLists` sits around the store's own `set` and settles each write as it
// lands — a new cue joins the list on screen, a cue the show already had stays in the list it
// was in, a child names no list — and keeps the window's place consistent with it: the list on
// screen is the one the operator's hand is in, so a selection that lands in another list (a
// remote's `/select`, an undo, a takeover from the other machine) brings that list to the front,
// and the list it leaves keeps its own place for when it comes back. A write that names the
// lists itself — an open, an undo, a list's own edit — is a write about lists and is taken as it
// is.

import type { StateCreator } from 'zustand'
import type { Cue } from '../../../shared/cue'
import {
  firstCueOfList,
  listMembership,
  listOfCue,
  settleListIds,
  type CueListInfo
} from '../../../shared/cueLists'

/** Where the operator's hand is in one list: the cue GO fires next there, and the set around it. */
export interface ListCursor {
  selectedId: string | null
  selectedIds: string[]
  selectionAnchorId: string | null
}

/** The part of the store this module reads and writes. */
export interface CueListSlice extends ListCursor {
  cues: Cue[]
  cueLists: CueListInfo[]
  /** The list on screen: the one GO, the transport and the toolbar act on. Session state. */
  activeListId: string
  /** Every other list's place, by list id, for when it comes back to the front. Session state. */
  listCursors: Record<string, ListCursor>
}

/** The place the window is standing in, as one value. */
export function cursorOf(state: ListCursor): ListCursor {
  return {
    selectedId: state.selectedId,
    selectedIds: state.selectedIds,
    selectionAnchorId: state.selectionAnchorId
  }
}

/**
 * Where a list's hand comes back to: the place it was left, minus whatever is no longer in the
 * list; the list's first cue when it was never stood in. A list that was run off its end comes
 * back at its end — nothing selected — as GO left it, so the press after a list's last cue does
 * not start it again.
 */
export function cursorFor(cues: readonly Cue[], listId: string, saved: ListCursor | undefined): ListCursor {
  if (saved === undefined) {
    const first = firstCueOfList(cues, listId)
    return first === null
      ? { selectedId: null, selectedIds: [], selectionAnchorId: null }
      : { selectedId: first, selectedIds: [first], selectionAnchorId: first }
  }
  const membership = listMembership(cues)
  const here = (id: string | null): id is string => id !== null && membership.get(id) === listId
  const selectedIds = saved.selectedIds.filter(here)
  return {
    selectedIds,
    selectedId: here(saved.selectedId) ? saved.selectedId : selectedIds[selectedIds.length - 1] ?? null,
    selectionAnchorId: here(saved.selectionAnchorId) ? saved.selectionAnchorId : null
  }
}

/**
 * One write, settled: its cues' lists, and the list on screen. Pure, so a test can hand it a
 * state and a write and read what lands.
 */
export function settleCueListWrite<S extends CueListSlice>(previous: S, write: Partial<S>): Partial<S> {
  let out = write
  const namesLists = Object.hasOwn(write, 'cueLists')
  if (write.cues !== undefined && write.cues !== previous.cues && !namesLists) {
    const cues = settleListIds(previous.cues, write.cues, previous.activeListId)
    if (cues !== write.cues) out = { ...out, cues }
  }

  const lists = out.cueLists ?? previous.cueLists
  const cues = out.cues ?? previous.cues
  let active = out.activeListId ?? previous.activeListId
  // A list that has gone — deleted, or undone back out of the show — cannot be on screen.
  if (!lists.some(list => list.id === active)) {
    active = lists[0]?.id ?? active
    out = { ...out, activeListId: active, ...cursorFor(cues, active, (out.listCursors ?? previous.listCursors)[active]) }
  }

  // The hand moved, or the cues under it did: the list on screen is the one it is in.
  const handMoved = Object.hasOwn(out, 'selectedId') || out.cues !== undefined
  if (!handMoved) return out
  const selectedId = Object.hasOwn(out, 'selectedId') ? out.selectedId ?? null : previous.selectedId
  if (selectedId === null) return out
  const holding = listOfCue(cues, selectedId)
  if (holding === null || holding === active) return out
  return {
    ...out,
    activeListId: holding,
    // The list being left keeps where it was, as it was before this write moved the hand.
    listCursors: { ...(out.listCursors ?? previous.listCursors), [active]: cursorOf(previous) }
  }
}

/**
 * The store, with every write settled on its way in. Wraps the creator rather than each
 * action, so an action added later — by anyone — is held to the same rule without knowing it.
 */
export function withCueLists<S extends CueListSlice>(creator: StateCreator<S>): StateCreator<S> {
  return (set, get, api) => {
    const settled: typeof set = ((partial: unknown, replace?: boolean) => {
      set((state: S) => {
        const write = (typeof partial === 'function' ? (partial as (s: S) => Partial<S>)(state) : partial) as Partial<S>
        // A write that changes nothing is handed back as it came, so the store can see it is one.
        if ((write as unknown) === state) return state
        return settleCueListWrite(state, write)
      }, replace as false | undefined)
    }) as typeof set
    return creator(settled, get, api)
  }
}
