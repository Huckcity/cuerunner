// Two people, one show: what a merge between two files that started from the same one
// means.
//
// The case this exists for is the designer/associate split — one person on act one, one
// on act two, neither willing to wait for the other's file — so the common case is two
// sides changing different things, and that case must merge without asking anybody. The
// cases that cannot be decided silently are the two sides changing *the same* thing, and
// each of those is named in the report rather than papered over: a merge that quietly
// picks a winner is how work gets lost in a way nobody notices until the dress rehearsal.
//
// It is a three-way merge, which means it needs the version both sides started from: two
// files alone cannot tell "I changed this" from "you changed it", and a merge that cannot
// tell those apart is a merge that overwrites one side's work with the other's. That is
// why the app asks for the ancestor, and why the ancestor is a file rather than a
// remembered state — the whole point is that the two people were not in the same room.
//
// What a merge does not carry is written down rather than guessed at:
//
// - The **file a cue plays** is not merged. Media is stored as both a route and a path
//   this machine resolved, so it means different things in two copies of a show; the
//   show being merged into keeps its own, and the report says when the other side
//   pointed a cue somewhere else.
// - The **order** is this show's, with the other side's additions placed among the
//   neighbours they were added after. When both sides moved the same cue to different
//   places the report names it.
// - The **show's name** is this file's. It is the name of the document, not a field of
//   the show.

import type { Cue } from '../renderer/src/types/cue'
import type { Workspace } from '../renderer/src/types/workspace'
import {
  cueLabel,
  cuePlaces,
  describeValue,
  diffWorkspaces,
  sameValue,
  type CueChange,
  type CuePlace
} from './showfile'

/** Which side of the merge wins a field or a section the two sides changed differently. */
export type ConflictPolicy = 'ours' | 'theirs'

export interface MergeOptions {
  onConflict: ConflictPolicy
}

/** One thing the merge did that a person should read before trusting the result. */
export interface MergeNote {
  /** The cue or setting it is about, as the app names it. */
  subject: string
  /** What happened, in the app's own words. */
  detail: string
  /** Whether the two sides disagreed about it. */
  conflict: boolean
}

/** How the merged show divides up, for the one-line summary a report opens with. */
export interface MergeTally {
  /** Cues only this show changed, and cues only it added or deleted. */
  oursOnly: number
  /** The same, for the other show. */
  theirsOnly: number
  /** Cues both sides changed, in different fields: the merge puts those together. */
  blended: number
  /** Cues neither side touched, or that both sides changed in the same way. */
  same: number
  /** Cues both sides changed differently — the ones the report names. */
  conflicts: number
}

export interface MergeResult {
  workspace: Workspace
  notes: MergeNote[]
  tally: MergeTally
}

/** A cue's change on one side of the merge, by cue id. */
function changeIndex(diff: ReturnType<typeof diffWorkspaces>): Map<string, CueChange> {
  return new Map(diff.changed.map(change => [change.id, change]))
}

function byId(cues: Cue[]): Map<string, Cue> {
  return new Map(cues.map(cue => [cue.id, cue]))
}

/**
 * The fields of one cue as the merge applies them: the union of what both sides changed,
 * with the fields they agree on taken once and the fields they disagree on decided by the
 * policy — and named in the report, because that decision is the one nobody can see.
 */
function mergeCue(
  mine: Cue,
  yours: Cue,
  ourChange: CueChange | undefined,
  theirChange: CueChange | undefined,
  options: MergeOptions,
  notes: MergeNote[],
  tally: MergeTally
): Cue {
  const label = cueLabel(mine)
  const mineFields = new Map((ourChange?.fields ?? []).map(field => [field.field, field]))
  const theirFields = new Map((theirChange?.fields ?? []).map(field => [field.field, field]))
  const merged = { ...mine } as unknown as Record<string, unknown>
  let tookOurs = false
  let tookTheirs = false
  let conflicted = false

  for (const field of [...new Set([...mineFields.keys(), ...theirFields.keys()])].sort()) {
    if (field === 'media') continue
    const myField = mineFields.get(field)
    const theirField = theirFields.get(field)
    if (myField && theirField) {
      if (sameValue(myField.to, theirField.to)) {
        merged[field] = myField.to
        continue
      }
      const takeTheirs = options.onConflict === 'theirs'
      merged[field] = takeTheirs ? theirField.to : myField.to
      conflicted = true
      notes.push({
        subject: label,
        detail: `${field} was changed on both sides: kept `
          + `${takeTheirs ? 'the other show' : 'this show'} (${describeValue(myField.to)} against `
          + `${describeValue(theirField.to)})`,
        conflict: true
      })
      continue
    }
    const only = myField ?? theirField
    merged[field] = only === undefined ? null : only.to
    if (myField) tookOurs = true
    else tookTheirs = true
  }

  // The file a cue plays is not merged — the two copies resolved it on two machines — so
  // a disagreement about it is reported rather than decided quietly.
  const myMedia = mineFields.get('media')
  const theirMedia = theirFields.get('media')
  if (myMedia && theirMedia && !sameValue(myMedia.to, theirMedia.to)) {
    conflicted = true
    notes.push({
      subject: label,
      detail: `the file it plays was changed on both sides: this show keeps ${describeValue(myMedia.to)}`,
      conflict: true
    })
  } else if (theirMedia && !myMedia) {
    // One side pointed the cue at another file. The merge does not carry that — the two
    // copies resolved their media on two machines — so the report says what this show
    // keeps, which is the file both sides started from, named by the change's own `from`.
    notes.push({
      subject: label,
      detail: `the other show plays ${describeValue(theirMedia.to)} here; this show keeps `
        + `${describeValue(theirMedia.from)}`,
      conflict: false
    })
  }

  // A move is the other half of an edit: a cue the other side moved into a group stays
  // where this show put it unless only the other side moved it.
  const theirParent = theirChange?.moved?.to.parent?.id ?? yours.parentId
  if (theirChange?.moved && !ourChange?.moved && theirParent !== mine.parentId) {
    merged.parentId = theirParent
    tookTheirs = true
  } else if (ourChange?.moved && !theirChange?.moved) {
    tookOurs = true
  }

  if (conflicted) tally.conflicts += 1
  else if (tookOurs && tookTheirs) tally.blended += 1
  else if (tookTheirs) tally.theirsOnly += 1
  else if (tookOurs) tally.oursOnly += 1
  else tally.same += 1
  return merged as unknown as Cue
}

/**
 * The order of the merged list: this show's, with the other side's cues inserted after
 * their own neighbours. Groups are put back together afterwards, because a cue list whose
 * children are not sitting under their group is a cue list the rest of the app cannot
 * read.
 */
function mergeOrder(
  mine: Cue[],
  yours: Cue[],
  merged: Map<string, Cue>,
  surviving: Set<string>
): string[] {
  const order = mine.filter(cue => surviving.has(cue.id)).map(cue => cue.id)
  const position = new Map(order.map((id, index) => [id, index]))
  const theirPosition = new Map(yours.map((cue, index) => [cue.id, index]))

  for (const cue of yours) {
    if (!surviving.has(cue.id) || position.has(cue.id)) continue
    // Straight after the nearest cue before it in the other file that made it into the
    // merge; if there is none, just before the nearest one after it; if neither, at the
    // end, which is where an operator appends a cue anyway.
    let after = -1
    for (let scan = (theirPosition.get(cue.id) as number) - 1; scan >= 0; scan--) {
      const at = position.get(yours[scan].id)
      if (at !== undefined) {
        after = at
        break
      }
    }
    let at = order.length
    if (after === -1) {
      for (let scan = (theirPosition.get(cue.id) as number) + 1; scan < yours.length; scan++) {
        const before = position.get(yours[scan].id)
        if (before !== undefined) {
          at = before
          break
        }
      }
    } else {
      at = after + 1
    }
    order.splice(at, 0, cue.id)
    for (let index = at; index < order.length; index++) position.set(order[index], index)
  }

  // Groups first, their children immediately after them, in the order they ended up in:
  // a cue list whose children are not under their group is one the rest of the app cannot
  // read, whatever order the two sides wanted.
  const placed = new Set<string>()
  const enclosed: string[] = []
  const place = (id: string): void => {
    if (placed.has(id)) return
    placed.add(id)
    enclosed.push(id)
    for (const candidate of order) {
      if (merged.get(candidate)?.parentId === id) place(candidate)
    }
  }
  for (const id of order) {
    if (merged.get(id)?.parentId === null) place(id)
  }
  for (const id of order) place(id)
  return enclosed
}

const SECTIONS: Array<{ path: string; read: (workspace: Workspace) => unknown; write: (workspace: Workspace, value: unknown) => Workspace }> = [
  { path: 'audio', read: w => w.audioSettings, write: (w, value) => ({ ...w, audioSettings: value as Workspace['audioSettings'] }) },
  { path: 'midi', read: w => w.midiSettings, write: (w, value) => ({ ...w, midiSettings: value as Workspace['midiSettings'] }) },
  { path: 'guard', read: w => w.triggerGuard ?? null, write: (w, value) => ({ ...w, triggerGuard: value as Workspace['triggerGuard'] }) }
]

/**
 * The settings, section by section: a section one side changed is taken, a section both
 * changed the same way is taken once, and a section both changed differently is a
 * conflict the policy decides. Sections rather than fields, deliberately: two people
 * editing the same section of the show's setup are working on the same thing.
 */
function mergeSettings(
  ancestor: Workspace,
  mine: Workspace,
  yours: Workspace,
  options: MergeOptions,
  notes: MergeNote[],
  tally: MergeTally
): Workspace {
  let merged = mine

  const decide = (path: string, base: unknown, myValue: unknown, theirValue: unknown): unknown => {
    if (sameValue(myValue, theirValue)) return myValue
    if (sameValue(base, myValue)) return theirValue        // only the other show changed it
    if (sameValue(base, theirValue)) return myValue        // only this show did
    const takeTheirs = options.onConflict === 'theirs'
    tally.conflicts += 1
    notes.push({
      subject: path,
      detail: `changed on both sides: kept ${takeTheirs ? 'the other show' : 'this show'}`,
      conflict: true
    })
    return takeTheirs ? theirValue : myValue
  }

  for (const section of SECTIONS) {
    const base = section.read(ancestor)
    const myValue = section.read(mine)
    const theirValue = section.read(yours)
    if (sameValue(base, theirValue) && sameValue(base, myValue)) continue
    merged = section.write(merged, decide(section.path, base, myValue, theirValue))
  }

  // The show's own settings, one key at a time: the services, the plot, the cast, the
  // scenes. A section this show never had and the other one did is a section this show
  // gains, which is what a merge is for.
  const baseShow = (ancestor.showSettings ?? {}) as Record<string, unknown>
  const myShow = (mine.showSettings ?? {}) as Record<string, unknown>
  const theirShow = (yours.showSettings ?? {}) as Record<string, unknown>
  const show: Record<string, unknown> = { ...myShow }
  for (const key of [...new Set([...Object.keys(baseShow), ...Object.keys(myShow), ...Object.keys(theirShow)])].sort()) {
    const decided = decide(`show.${key}`, baseShow[key] ?? null, myShow[key] ?? null, theirShow[key] ?? null)
    // A section the other show dropped is dropped here too, rather than becoming a null.
    if (decided === null || decided === undefined) delete show[key]
    else show[key] = decided
  }
  return { ...merged, showSettings: show as unknown as Workspace['showSettings'] }
}

/**
 * Two files that started from a third, merged into one. `ours` is the show being merged
 * into: its identity, its name and its history are the result's.
 */
export function mergeWorkspaces(
  ancestor: Workspace,
  ours: Workspace,
  theirs: Workspace,
  options: MergeOptions = { onConflict: 'ours' }
): MergeResult {
  const ourDiff = diffWorkspaces(ancestor, ours)
  const theirDiff = diffWorkspaces(ancestor, theirs)
  const ourChanges = changeIndex(ourDiff)
  const theirChanges = changeIndex(theirDiff)
  const ourRemoved = new Set(ourDiff.removed.map(arrival => arrival.id))
  const theirRemoved = new Set(theirDiff.removed.map(arrival => arrival.id))
  const mine = byId(ours.cues)
  const yours = byId(theirs.cues)
  const notes: MergeNote[] = []
  const tally: MergeTally = { oursOnly: 0, theirsOnly: 0, blended: 0, same: 0, conflicts: 0 }
  const merged = new Map<string, Cue>()

  for (const id of new Set([...mine.keys(), ...yours.keys(), ...byId(ancestor.cues).keys()])) {
    const myCue = mine.get(id)
    const theirCue = yours.get(id)
    const ourChange = ourChanges.get(id)
    const theirChange = theirChanges.get(id)
    const iRemoved = ourRemoved.has(id)
    const theyRemoved = theirRemoved.has(id)
    const label = cueLabel(myCue ?? theirCue ?? { number: '', name: id })

    if (iRemoved && theyRemoved) continue
    if (iRemoved || theyRemoved) {
      const remover = iRemoved ? 'this show' : 'the other show'
      const changed = (iRemoved ? theirCue : myCue) as Cue | undefined
      const didChange = iRemoved ? theirChange : ourChange
      if (!changed) continue
      if (!didChange) {
        // Deleted by one side, never touched by the other: the deletion is the change.
        if (iRemoved) tally.oursOnly += 1
        else tally.theirsOnly += 1
        continue
      }
      // A deletion against an edit. The policy decides which *side* wins, and each side's
      // answer to this cue is its own: this show deleting a cue the other side edited is
      // a deletion, and the other side deleting a cue this show edited is that edit.
      const deletionWins = iRemoved === (options.onConflict === 'ours')
      tally.conflicts += 1
      notes.push({
        subject: label,
        detail: `${remover} deleted it and the other side changed it: kept `
          + `${deletionWins ? 'the deletion' : `${iRemoved ? 'the other show’s' : 'this show’s'} version`}`,
        conflict: true
      })
      // Counted as a conflict above; which version was kept is in the note.
      if (!deletionWins) merged.set(id, changed)
      continue
    }

    if (!myCue || !theirCue) {
      const only = (myCue ?? theirCue) as Cue
      merged.set(id, only)
      if (myCue) tally.oursOnly += 1
      else tally.theirsOnly += 1
      continue
    }

    if (!ourChange && !theirChange) {
      merged.set(id, myCue)
      tally.same += 1
      continue
    }
    // One side's change, or both sides' changes blended field by field.
    const blended = mergeCue(
      myCue,
      theirCue,
      ourChange,
      theirChange,
      options,
      notes,
      tally
    )
    merged.set(id, blended)
  }

  reportOrderConflicts(ancestor, ours, theirs, merged, notes, tally)
  repairParents(merged, notes)
  const survivors = new Set(merged.keys())
  const order = mergeOrder(ours.cues, theirs.cues, merged, survivors)
  const cues = order.map(id => merged.get(id)).filter((cue): cue is Cue => cue !== undefined)
  const settings = mergeSettings(ancestor, ours, theirs, options, notes, tally)
  return {
    workspace: { ...settings, cues },
    notes,
    tally
  }
}

/**
 * The cues both sides moved, to different places. A diff's idea of "moved" is the
 * smallest set of cues that explains a reordering, so two sides can each report a
 * different cue as the one that moved while meaning the same rearrangement — which is why
 * this asks the files where each cue sits instead: its group, and the cue before it.
 *
 * Only a cue both sides disagree with the original about is named. Where one side moved a
 * cue and the other left it alone, the move is theirs, and the merged order carries it.
 */
function reportOrderConflicts(
  ancestor: Workspace,
  ours: Workspace,
  theirs: Workspace,
  merged: Map<string, Cue>,
  notes: MergeNote[],
  tally: MergeTally
): void {
  const base = cuePlaces(ancestor.cues)
  const mine = cuePlaces(ours.cues)
  const yours = cuePlaces(theirs.cues)
  const key = (place: CuePlace | undefined): string =>
    place === undefined ? '' : `${place.parent?.id ?? ''}>${place.after?.id ?? ''}`

  for (const id of merged.keys()) {
    const original = base.get(id)
    const myPlace = mine.get(id)
    const theirPlace = yours.get(id)
    if (!original || !myPlace || !theirPlace) continue      // a cue only one side has: no disagreement
    if (key(myPlace) === key(theirPlace)) continue
    if (key(myPlace) === key(original) || key(theirPlace) === key(original)) continue
    tally.conflicts += 1
    notes.push({
      subject: cueLabel(merged.get(id) as Cue),
      detail: 'moved on both sides: this show’s place is kept',
      conflict: true
    })
  }
}

/**
 * A cue whose group is not in the merged show — its group was deleted on one side while
 * the cue itself was changed on the other — comes back at the top level rather than
 * pointing at a group that is not there.
 */
function repairParents(merged: Map<string, Cue>, notes: MergeNote[]): void {
  for (const [id, cue] of merged) {
    if (cue.parentId === null || merged.has(cue.parentId)) continue
    merged.set(id, { ...cue, parentId: null })
    notes.push({
      subject: cueLabel(cue),
      detail: 'its group is not in the merged show: placed at the top level',
      conflict: false
    })
  }
}
