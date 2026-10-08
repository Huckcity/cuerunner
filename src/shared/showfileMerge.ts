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

import type { Cue } from './cue'
import { heldShowSettings } from './show'
import type { Workspace } from './workspace'
import { WORKSPACE_SECTIONS } from './workspaceSections'
import { heldCueLists, listMembership, MAIN_CUE_LIST_ID, type CueListInfo } from './cueLists'
import { fadeTargetsPatch, oscMessagesPatch, STOP_ALL, stopTargetsPatch } from './cueTargets'
import type { CueType, OscMessage } from './cue'
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

/**
 * Writes the merge's logical fields back in the fields a cue is read from: a fade's or a stop's
 * `targets` as its list (or `'all'`), an OSC cue's `messages` as the list with the single message
 * the cue may have carried taken away — the spelling an edit gives it.
 */
function writeLogical(merged: Record<string, unknown>, type: CueType): void {
  if ((type === 'fade' || type === 'stop') && Object.hasOwn(merged, 'targets')) {
    const value = merged.targets
    delete merged.targets
    const patch: Record<string, unknown> = type === 'stop' && value === STOP_ALL
      ? stopTargetsPatch(STOP_ALL)
      : type === 'stop'
        ? stopTargetsPatch(Array.isArray(value) ? value.map(String) : [])
        : fadeTargetsPatch(Array.isArray(value) ? value.map(String) : [])
    for (const [key, entry] of Object.entries(patch)) {
      if (entry === undefined) delete merged[key]
      else merged[key] = entry
    }
  }
  if (type === 'osc' && Array.isArray(merged.messages)) {
    const patch: Record<string, unknown> = oscMessagesPatch(merged.messages as OscMessage[])
    for (const [key, entry] of Object.entries(patch)) {
      if (entry === undefined) delete merged[key]
      else merged[key] = entry
    }
  }
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
  // The logical fields are written back in the cue's own spelling: the merge decided the
  // targets or the messages, and the cue carries them in the fields it is read from.
  writeLogical(merged, mine.type)

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
 * The order of the merged list, group by group: the arrangement of whichever side moved
 * the group's cues, with the other side's additions placed among the neighbours they were
 * added after.
 *
 * One side moving a run of cues and the other not touching it is the ordinary case — the
 * associate rearranges act two, the designer is in act one — and their arrangement is
 * theirs to keep. When both sides rearranged the same list, this show's order is kept and
 * `reportOrderConflicts` has already named the cues they disagree about.
 *
 * Groups come out with their children immediately after them, because a cue list whose
 * children are not under their group is one the rest of the app cannot read, whatever
 * order the two sides wanted.
 */
function mergeOrder(
  ancestor: Workspace,
  mine: Workspace,
  yours: Workspace,
  merged: Map<string, Cue>,
  surviving: Set<string>
): string[] {
  // Which group a cue belongs to is the merge's answer, not either file's: a cue whose
  // group was deleted on one side has been moved to the top level by now, and asking the
  // files would leave it belonging to a group that is not in the result. Only the order
  // within a group comes from the side that arranged it.
  const childrenOf = (cues: Cue[], parentId: string | null): string[] =>
    cues
      .filter(cue => surviving.has(cue.id))
      .filter(cue => (merged.get(cue.id) as Cue).parentId === parentId)
      .map(cue => cue.id)

  const sequenceFor = (parentId: string | null): string[] => {
    const baseSeq = childrenOf(ancestor.cues, parentId)
    const mySeq = childrenOf(mine.cues, parentId)
    const theirSeq = childrenOf(yours.cues, parentId)

    // The order of the cues all three still have. An addition is not a rearrangement:
    // adding a cue to the end of a list that was not otherwise touched must not read as
    // this side having arranged the list.
    const shared = (from: string[], others: string[][]): string[] =>
      from.filter(id => others.every(other => other.includes(id)))
    const baseOrder = shared(baseSeq, [mySeq, theirSeq])
    const myOrder = shared(mySeq, [baseSeq, theirSeq])
    const theirOrder = shared(theirSeq, [baseSeq, mySeq])
    const same = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((id, index) => id === b[index])

    const theirsWins = same(myOrder, baseOrder) && !same(theirOrder, baseOrder)
    return theirsWins ? withExtras(theirSeq, mySeq) : withExtras(mySeq, theirSeq)
  }

  /** One side's order, with the other side's additions after their own neighbours. */
  const withExtras = (order: string[], extra: string[]): string[] => {
    const placed = [...order]
    const position = new Map(placed.map((id, index) => [id, index]))
    const extraPosition = new Map(extra.map((id, index) => [id, index]))
    for (const id of extra) {
      if (position.has(id)) continue
      // Straight after the nearest cue before it in the other file that made it into the
      // merge; if there is none, just before the nearest one after it; if neither, at the
      // end, which is where an operator appends a cue anyway.
      let at = placed.length
      for (let scan = (extraPosition.get(id) as number) - 1; scan >= 0; scan--) {
        const before = position.get(extra[scan])
        if (before !== undefined) {
          at = before + 1
          break
        }
      }
      if (at === placed.length) {
        for (let scan = (extraPosition.get(id) as number) + 1; scan < extra.length; scan++) {
          const after = position.get(extra[scan])
          if (after !== undefined) {
            at = after
            break
          }
        }
      }
      placed.splice(at, 0, id)
      for (let index = at; index < placed.length; index++) position.set(placed[index], index)
    }
    return placed
  }

  const order: string[] = []
  const place = (parentId: string | null): void => {
    for (const id of sequenceFor(parentId)) {
      order.push(id)
      place(id)
    }
  }
  place(null)
  return order
}

/**
 * The settings, section by section — the sections, and how each one blends, are the saved
 * form's own declaration. A section one side changed is taken, a section both changed the
 * same way is taken once, and a section both changed differently is a conflict the policy
 * decides; a section that blends key by key reports and decides a key at a time instead.
 * Sections rather than fields, deliberately: two people editing the same section of the
 * show's setup are working on the same thing.
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

  for (const section of WORKSPACE_SECTIONS) {
    if (section.merge === 'section') {
      const base = ancestor[section.key] ?? null
      const myValue = mine[section.key] ?? null
      const theirValue = yours[section.key] ?? null
      if (sameValue(base, theirValue) && sameValue(base, myValue)) continue
      const decided = decide(section.route, base, myValue, theirValue)
      // A side that carries no section is read as `null` so the three can be compared, and
      // the blend can answer `null` back — the side that dropped the section won. On disk that
      // is a section the show does not carry, not a section that is `null`: the funnel refuses
      // `null` where a section's type has none, so the merged show would not open. Absent, it
      // is the show a file without the section always was, whichever optional section it is.
      if (decided === null || decided === undefined) {
        const without = { ...merged } as Record<string, unknown>
        delete without[section.key]
        merged = without as unknown as Workspace
      } else {
        merged = { ...merged, [section.key]: decided } as Workspace
      }
    } else if (section.merge === 'keys') {
      // The show's own settings, one key at a time: the services, the plot, the cast, the
      // scenes. A section this show never had and the other one did is a section this show
      // gains, which is what a merge is for.
      //
      // Every side is read as the window holds it — the sections it carries, over this
      // build's defaults for the ones it leaves out. A file that has never written the
      // settings section at all is a document the window reads as the defaults, and without
      // that reading the merge would build a settings object with no sections in it, which
      // this build refuses to open.
      const asRecord = (workspace: Workspace): Record<string, unknown> =>
        heldShowSettings(workspace.showSettings) as unknown as Record<string, unknown>
      const base = asRecord(ancestor)
      const myValue = asRecord(mine)
      const theirValue = asRecord(yours)
      const show: Record<string, unknown> = { ...myValue }
      const fields = [...new Set([...Object.keys(base), ...Object.keys(myValue), ...Object.keys(theirValue)])].sort()
      for (const field of fields) {
        const decided = decide(
          `${section.route}.${field}`,
          base[field] ?? null,
          myValue[field] ?? null,
          theirValue[field] ?? null
        )
        // A key the other show dropped is dropped here too, rather than becoming a null.
        if (decided === null || decided === undefined) delete show[field]
        else show[field] = decided
      }
      // The value is a record while it is being edited; it is the section's shape again
      // once every key has been decided.
      merged = { ...merged, [section.key]: show } as unknown as Workspace
    }
  }
  return merged
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
  const order = mergeOrder(ancestor, ours, theirs, merged, survivors)
  const cues = order.map(id => merged.get(id)).filter((cue): cue is Cue => cue !== undefined)
  const settings = mergeSettings(ancestor, ours, theirs, options, notes, tally)
  return {
    workspace: { ...settings, cues: repairLists(cues, settings.cueLists, ours, theirs, notes) },
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
 * A cue whose group cannot hold it comes back at the top level: the group was deleted on
 * one side while the cue itself was changed on the other, or — two moves that each put
 * one group inside the other — the group above it leads back to the cue. A cycle is
 * unreachable from the top level, and the walk that orders the show starts there, so
 * every cue in one would be left out of the merged file without a word.
 */
function repairParents(merged: Map<string, Cue>, notes: MergeNote[]): void {
  for (const [id, cue] of merged) {
    if (cue.parentId === null) continue
    const missing = !merged.has(cue.parentId)
    if (!missing && !leadsBackTo(id, merged)) continue
    merged.set(id, { ...cue, parentId: null })
    notes.push({
      subject: cueLabel(cue),
      detail: missing
        ? 'its group is not in the merged show: placed at the top level'
        : 'its group ends up inside it in the merged show: placed at the top level',
      conflict: false
    })
  }
}

/**
 * Every merged cue in a list the merged show has. The lists are a section and blend as one, so
 * one side may have moved a cue into a list the section the merge kept does not carry: that cue
 * comes back to the main list, and says so. A cue `repairParents` lifted out of a group that is
 * gone is put in the list its group ran in, where the merged show still has it, rather than
 * landing in the main list for want of a name. A child carries no list name.
 */
function repairLists(
  cues: Cue[],
  lists: CueListInfo[] | undefined,
  ours: Workspace,
  theirs: Workspace,
  notes: MergeNote[]
): Cue[] {
  const known = new Set(heldCueLists(lists).map(list => list.id))
  const wasIn = [listMembership(ours.cues), listMembership(theirs.cues)]
  // Lifted by the repair: a child on every side that has it, at the top level only here.
  const topLevelSomewhere = new Set([...ours.cues, ...theirs.cues].filter(cue => cue.parentId === null).map(cue => cue.id))
  const wasChild = new Set(
    [...ours.cues, ...theirs.cues].filter(cue => !topLevelSomewhere.has(cue.id)).map(cue => cue.id)
  )
  return cues.map(cue => {
    if (cue.parentId !== null) {
      if (cue.listId === undefined) return cue
      const bare = { ...cue }
      delete bare.listId
      return bare
    }
    if (cue.listId === undefined) {
      if (!wasChild.has(cue.id)) return cue
      const former = wasIn.map(membership => membership.get(cue.id)).find(id => id !== undefined && known.has(id))
      return former === undefined || former === MAIN_CUE_LIST_ID ? cue : { ...cue, listId: former }
    }
    if (known.has(cue.listId) && cue.listId !== MAIN_CUE_LIST_ID) return cue
    if (cue.listId !== MAIN_CUE_LIST_ID) {
      notes.push({
        subject: cueLabel(cue),
        detail: 'its cue list is not in the merged show: placed in the main list',
        conflict: false
      })
    }
    const bare = { ...cue }
    delete bare.listId
    return bare
  })
}

/** Whether the chain of groups above this cue comes back to it — or to itself. */
function leadsBackTo(id: string, merged: Map<string, Cue>): boolean {
  const seen = new Set<string>([id])
  let at = merged.get(id)?.parentId ?? null
  while (at !== null) {
    if (seen.has(at)) return true
    seen.add(at)
    at = merged.get(at)?.parentId ?? null
  }
  return false
}
