// What changed between two showfiles.
//
// This is the vocabulary the showfile's history is written in: the compare view reads
// it, a save writes its summary into the file's own history, and a merge applies the
// field-level changes it describes. So it is a pure function of two workspaces and knows
// nothing about clocks, files or the app — both processes read it, and main is where the
// files are.
//
// What counts as a change is the whole question, and the answer is: what a person typed.
// A cue's identity, where it sits, the route to its media file on this machine, and the
// audible region a scan measured are written by the app rather than by an operator, so
// none of them is an edit — a file copied to another folder, or an old file whose silence
// was measured between two saves, must not diff against itself. A cue that changes group
// is reported as a move rather than as an edit to the field that says where it sits. And
// some fields answer it per cue type rather than once and for all: `duration` is a
// measurement the app wrote on an audio cue and an operator's own timing on a wait or a
// fade. `isEdit` below is that rule.

import type { Cue, CueType } from './cue'
import type { Workspace } from './workspace'
import { WORKSPACE_SECTIONS } from './workspaceSections'

/** A cue named the way the cue list names it: "12 Walk-in". */
export function cueLabel(cue: { number?: string; name?: string }): string {
  const label = `${cue.number ?? ''} ${cue.name ?? ''}`.trim()
  return label === '' ? 'untitled cue' : label
}

/** A cue as a change refers to it: enough to draw a line about it without the file. */
export interface CueRef {
  id: string
  label: string
}

/** Where a cue sits in the list. */
export interface CuePlace {
  /** The group it is a child of, or null at the top level. */
  parent: CueRef | null
  /** The cue immediately before it among the cues it sits with, or null when it is first. */
  after: CueRef | null
}

/** One authored field of a cue, before and after. */
export interface FieldChange {
  field: string
  from: unknown
  to: unknown
}

export interface CueChange {
  id: string
  label: string
  type: Cue['type']
  /** The authored fields that differ, in field-name order. Absent when nothing was edited. */
  fields?: FieldChange[]
  /** Present when the cue sits somewhere else than it did. */
  moved?: { from: CuePlace; to: CuePlace }
}

/** A cue one file has and the other does not. */
export interface CueArrival {
  id: string
  label: string
  type: Cue['type']
  /** Where it sits in the file that has it. */
  place: CuePlace
}

/** A workspace-level setting, named by its route through the file: 'name', 'audio.sampleRate'. */
export interface SettingChange {
  path: string
  from: unknown
  to: unknown
}

/** A file's own identity, for the header of whatever draws a diff. */
export interface ShowTitle {
  id: string
  name: string
  createdAt: string
  cues: number
}

export interface WorkspaceDiff {
  from: ShowTitle
  to: ShowTitle
  /** Whether the two files are one show written twice, or two different shows. */
  sameShow: boolean
  /** In the order of the file that gained them. */
  added: CueArrival[]
  /** In the order of the file that lost them. */
  removed: CueArrival[]
  /** In the order of the second file. */
  changed: CueChange[]
  settings: SettingChange[]
  /** How many cues the two files have in common, in the same place, with nothing edited. */
  unchanged: number
  /** Nothing differs at all. */
  empty: boolean
}

/**
 * How deep a setting change is named before the whole value is what changed. Two levels
 * reach 'audio.sampleRate' and 'show.rf.plot'; past that a value is reported as a unit,
 * because 'show.cast.channels.3.gain' is a path nobody wants to read and an array is one
 * edit however many entries it moved.
 */
const MAX_SETTING_DEPTH = 2

/**
 * Whether a field of a cue of this type is an edit — something a person typed — or
 * something the app wrote down for itself. Authorship is a property of the pair, not of
 * the name: `duration` is the length a scan measured on an audio cue, and the time an
 * operator typed on a wait or a fade, so reading the field alone cannot answer it.
 *
 * A field nobody has classified is an edit. The walk is the union of both cues' keys, so
 * a field this build has never heard of still arrives here, and staying an edit is what
 * keeps a later version's field from going silently unrecorded.
 */
function isEdit(type: CueType, field: string): boolean {
  switch (field) {
    // A cue's identity, where it sits, and the route to its file on this machine are the
    // app's own bookkeeping, at every type. `media` — the saved route to the file — is
    // deliberately not here: it is compared, and what it is compared as is the file's own
    // name (`fieldValue`'s fold), so a cue pointed at a differently named file is an edit
    // even though the app writes the block.
    case 'id':
    case 'filePath':
    case 'parentId':
    case 'soundRegion':
      return false
    // An audio cue's length is what the measurement pass wrote onto it, and nothing types
    // one today: choosing a file in the inspector writes the number the engine reported,
    // through the same store writer. Every other type's duration is the operator's own —
    // a wait holds for it, a fade runs for it — and the app has no writer for it.
    case 'duration':
      // A video's length is measured the same way, from its file; an image's or a text's is
      // how long the operator shows it.
      return type !== 'audio' && type !== 'video'
    default:
      return true
  }
}

/**
 * The one field that is compared whether or not either side carries it. A file this
 * build saved names a cue's file under `media`; a file old enough to predate that names
 * it under `filePath`, which is otherwise not compared at all because it is this
 * machine's route to the file. Reading both through one name is what keeps a cue pointed
 * at a different file from reading as unchanged in a file that has not been saved since.
 */
const MEDIA_FIELD = 'media'

/**
 * A value as an equality test sees it: object keys in a fixed order, undefined folded
 * into null. Two files that say the same thing in a different key order are the same
 * file here, which is what makes a migration that reorganises a section — or a file
 * written by another version — not read as an edit.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null'
}

/** Whether two values are the same thing, for the purposes of a diff. */
export function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b)
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeys(source[key])
    return sorted
  }
  return value
}

/** The file name at the end of a path, on either separator — the shared code has no `path`. */
function fileName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Every field of A and B that differs, in field-name order. The union of both sides'
 * keys is what is walked, so a field this version has never heard of still diffs: a
 * change is what is in the file, not what the code that reads it knows about.
 */
function fieldChanges(before: Cue, after: Cue): FieldChange[] {
  const a = before as unknown as Record<string, unknown>
  const b = after as unknown as Record<string, unknown>
  const changes: FieldChange[] = []
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b), MEDIA_FIELD])].sort()
  for (const field of fields) {
    if (!isEdit(after.type, field)) continue
    const from = fieldValue(a, field)
    const to = fieldValue(b, field)
    if (sameValue(from, to)) continue
    changes.push({ field, from, to })
  }
  return changes
}

/**
 * A field as the diff sees it. `media` is the app's own record of where a cue's file is
 * — written at save time, twice, as the route it was found by and the absolute path it
 * had — so what is compared is the file's own name: a show copied into another folder,
 * or onto another machine, must not report every cue as edited because the route
 * changed. A file old enough to carry only `filePath` names the same file, and says
 * nothing about where it is either.
 */
function fieldValue(cue: Record<string, unknown>, field: string): unknown {
  if (field === 'media') {
    const stored = (cue.media as { path?: unknown } | undefined | null)?.path
    const route = typeof stored === 'string' ? stored : cue.filePath
    return typeof route === 'string' && route !== '' ? fileName(route) : null
  }
  // Absent and null are the same thing once a file has been through JSON.
  return cue[field] ?? null
}

/**
 * Where each cue sits: its parent, and the cue before it among its own. Exported because
 * a three-way merge has to ask the same question of three files — whether two sides agree
 * about where a cue goes cannot be read off a diff, whose idea of "moved" is the smallest
 * set of cues that explains a reordering rather than the edit somebody made.
 */
export function cuePlaces(cues: Cue[]): Map<string, CuePlace> {
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  const lastSibling = new Map<string | null, string>()
  const found = new Map<string, CuePlace>()
  for (const cue of cues) {
    const parent = cue.parentId === null ? null : byId.get(cue.parentId)
    const previousId = lastSibling.get(cue.parentId)
    const previous = previousId === undefined ? undefined : byId.get(previousId)
    found.set(cue.id, {
      parent: parent ? { id: parent.id, label: cueLabel(parent) } : null,
      after: previous ? { id: previous.id, label: cueLabel(previous) } : null
    })
    lastSibling.set(cue.parentId, cue.id)
  }
  return found
}

/**
 * Which of the cues both files have changed place. A cue is moved when it is not part of
 * the longest run whose relative order is the same in both files — the smallest set of
 * cues that explains the reordering. Moving one cue to the top of a hundred reports that
 * one cue rather than the ninety-nine it passed; a pair that swapped reports one of the
 * two, because nothing in either file says which of them was the one that moved.
 */
function movedCues(before: Cue[], after: Cue[]): Set<string> {
  const inAfter = new Set(after.map(cue => cue.id))
  const ordered = before.filter(cue => inAfter.has(cue.id))
  const rank = new Map(after.map((cue, index) => [cue.id, index]))
  const kept = longestIncreasing(ordered.map(cue => rank.get(cue.id) as number))
  const moved = new Set<string>()
  ordered.forEach((cue, index) => {
    if (!kept.has(index)) moved.add(cue.id)
  })
  return moved
}

/**
 * The indices of one longest strictly increasing subsequence, by patience sorting. The
 * sequence here is a list of positions in the other file, so this is exactly "the run of
 * cues that stayed in order".
 */
function longestIncreasing(values: number[]): Set<number> {
  const tails: number[] = []
  const previous: number[] = []
  for (let index = 0; index < values.length; index++) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (values[tails[middle]] < values[index]) low = middle + 1
      else high = middle
    }
    previous[index] = low > 0 ? tails[low - 1] : -1
    tails[low] = index
  }
  const kept = new Set<number>()
  let index = tails.length > 0 ? tails[tails.length - 1] : -1
  while (index >= 0) {
    kept.add(index)
    index = previous[index]
  }
  return kept
}

/** The routes through a file where two values differ. */
function changedPaths(from: unknown, to: unknown, path: string[], depth: number): string[] {
  if (sameValue(from, to)) return []
  if (depth <= 0 || !isRecord(from) || !isRecord(to)) return [path.join('.')]
  return [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .sort()
    .flatMap(key => changedPaths(from[key], to[key], [...path, key], depth - 1))
}

/** The value a route names, or null when that side of the file does not have it. */
function valueAt(root: unknown, path: string[]): unknown {
  let value: unknown = root
  for (const segment of path) {
    if (!isRecord(value)) return null
    value = value[segment]
  }
  return value ?? null
}

/**
 * Workspace-level settings, compared section by section. The sections, and the routes
 * they are reported under, are the saved form's own declaration — the show's audio, its
 * MIDI port, its trigger guard, the show services' own settings under 'show.' — and the
 * routes reported inside one are as deep as `MAX_SETTING_DEPTH`. A section an older file
 * never carried is compared as a null rather than as its absent self.
 */
function settingChanges(from: Workspace, to: Workspace): SettingChange[] {
  const changes: SettingChange[] = []
  for (const section of WORKSPACE_SECTIONS) {
    if (section.route === null) continue
    const before = from[section.key] ?? null
    const after = to[section.key] ?? null
    for (const route of changedPaths(before, after, [section.route], MAX_SETTING_DEPTH)) {
      const segments = route.split('.')
      changes.push({
        path: route,
        from: valueAt(before, segments.slice(1)),
        to: valueAt(after, segments.slice(1))
      })
    }
  }
  return changes
}

function title(workspace: Workspace): ShowTitle {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
    cues: workspace.cues.length
  }
}

export function diffWorkspaces(from: Workspace, to: Workspace): WorkspaceDiff {
  const before = new Map(from.cues.map(cue => [cue.id, cue]))
  const after = new Map(to.cues.map(cue => [cue.id, cue]))
  const placeBefore = cuePlaces(from.cues)
  const placeAfter = cuePlaces(to.cues)
  const moved = movedCues(from.cues, to.cues)

  const added: CueArrival[] = []
  for (const cue of to.cues) {
    if (before.has(cue.id)) continue
    added.push({
      id: cue.id,
      label: cueLabel(cue),
      type: cue.type,
      place: placeAfter.get(cue.id) ?? { parent: null, after: null }
    })
  }

  const removed: CueArrival[] = []
  for (const cue of from.cues) {
    if (after.has(cue.id)) continue
    removed.push({
      id: cue.id,
      label: cueLabel(cue),
      type: cue.type,
      place: placeBefore.get(cue.id) ?? { parent: null, after: null }
    })
  }

  const changed: CueChange[] = []
  let unchanged = 0
  for (const cue of to.cues) {
    const was = before.get(cue.id)
    if (!was) continue
    const fields = fieldChanges(was, cue)
    const reparented = was.parentId !== cue.parentId
    const repositioned = moved.has(cue.id)
    if (fields.length === 0 && !reparented && !repositioned) {
      unchanged += 1
      continue
    }
    changed.push({
      id: cue.id,
      label: cueLabel(cue),
      type: cue.type,
      ...(fields.length > 0 ? { fields } : {}),
      ...(reparented || repositioned
        ? {
            moved: {
              from: placeBefore.get(cue.id) ?? { parent: null, after: null },
              to: placeAfter.get(cue.id) ?? { parent: null, after: null }
            }
          }
        : {})
    })
  }

  const settings = settingChanges(from, to)
  return {
    from: title(from),
    to: title(to),
    sameShow: from.id === to.id,
    added,
    removed,
    changed,
    settings,
    unchanged,
    empty: added.length === 0 && removed.length === 0 && changed.length === 0 && settings.length === 0
  }
}

// ─── The file's own history ───────────────────────────────────────────────────

/**
 * How many saves a showfile remembers. Each entry is a few lines of JSON, and a show is
 * saved far more often than it is changed, so this holds years of a show's life — it is
 * a bound on a file that would otherwise grow without one, not a window anyone will
 * reach.
 */
export const MAX_HISTORY_ENTRIES = 200

/** How many cues one entry names before it says how many more there were. */
export const MAX_LOGGED_CUES = 100

/** How many changed settings one entry names before it says how many more there were. */
export const MAX_LOGGED_SETTINGS = 20

/** One line of a file's history: one cue, and the one thing that happened to it. */
export interface LoggedCue {
  kind: 'added' | 'removed' | 'edited' | 'moved'
  id: string
  label: string
  /** For an edit: the names of the fields that changed. */
  fields?: string[]
}

/**
 * A save that changed something, as the file remembers it. The entry names what changed
 * rather than storing what it was: the file before this save is where the old values
 * are, and a history that carried a copy of every field would double the size of a show
 * to say things the show already says.
 */
export interface ShowHistoryEntry {
  /** When the file was written, ISO 8601 in UTC. */
  at: string
  /** The OS user the app ran as. A save is the unit of authorship: it is who wrote this. */
  by: string
  /** The machine's name, when the system would give it one. */
  machine?: string
  cues: LoggedCue[]
  /** The routes of the settings that changed, as `WorkspaceDiff.settings` names them. */
  settings: string[]
  /** What was left out to keep a very large change from becoming a very large entry. */
  omitted?: { cues?: number; settings?: number }
}

/**
 * One save's history entry, or null when the save changed nothing — a file that
 * describes a change it did not make is a file whose history cannot be trusted.
 */
export function historyEntry(
  diff: WorkspaceDiff,
  at: string,
  by: string,
  machine?: string
): ShowHistoryEntry | null {
  if (diff.empty) return null
  const cues: LoggedCue[] = []
  for (const arrival of diff.added) {
    cues.push({ kind: 'added', id: arrival.id, label: arrival.label })
  }
  for (const arrival of diff.removed) {
    cues.push({ kind: 'removed', id: arrival.id, label: arrival.label })
  }
  for (const change of diff.changed) {
    if (change.fields) {
      cues.push({
        kind: 'edited',
        id: change.id,
        label: change.label,
        fields: change.fields.map(field => field.field)
      })
    }
    if (change.moved) cues.push({ kind: 'moved', id: change.id, label: change.label })
  }
  const settings = diff.settings.map(setting => setting.path)
  const entry: ShowHistoryEntry = {
    at,
    by,
    cues: cues.slice(0, MAX_LOGGED_CUES),
    settings: settings.slice(0, MAX_LOGGED_SETTINGS)
  }
  if (machine !== undefined && machine !== '') entry.machine = machine
  const omitted = {
    ...(cues.length > MAX_LOGGED_CUES ? { cues: cues.length - MAX_LOGGED_CUES } : {}),
    ...(settings.length > MAX_LOGGED_SETTINGS
      ? { settings: settings.length - MAX_LOGGED_SETTINGS }
      : {})
  }
  if (Object.keys(omitted).length > 0) entry.omitted = omitted
  return entry
}

/** The history with one entry appended, oldest entries falling off the top. */
export function appendHistory(
  history: ShowHistoryEntry[] | undefined,
  entry: ShowHistoryEntry
): ShowHistoryEntry[] {
  const next = [...(history ?? []), entry]
  return next.length > MAX_HISTORY_ENTRIES ? next.slice(next.length - MAX_HISTORY_ENTRIES) : next
}

// ─── Reading a change out loud ────────────────────────────────────────────────

const VALUE_CHARS = 60

/** A value as a person reads it in a list of changes. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') {
    const text = value.length > VALUE_CHARS ? `${value.slice(0, VALUE_CHARS - 1)}…` : value
    return `“${text}”`
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'entry' : 'entries'}`
  let json = ''
  try {
    json = JSON.stringify(value)
  } catch {
    return 'a value this file cannot show'
  }
  if (json === undefined) return '—'
  return json.length > VALUE_CHARS ? `${json.slice(0, VALUE_CHARS - 1)}…` : json
}

/** One changed field, as a line: "volume 0.6 → 0.75". */
export function describeField(change: FieldChange): string {
  return `${change.field} ${describeValue(change.from)} → ${describeValue(change.to)}`
}

/** One history entry's headline: what happened, and to how much of the show. */
export function describeEntry(entry: ShowHistoryEntry): string {
  const counts = new Map<LoggedCue['kind'], number>()
  for (const cue of entry.cues) counts.set(cue.kind, (counts.get(cue.kind) ?? 0) + 1)
  const parts: string[] = []
  for (const kind of ['added', 'removed', 'edited', 'moved'] as const) {
    const count = counts.get(kind) ?? 0
    if (count > 0) parts.push(`${count} ${kind}`)
  }
  if (entry.omitted?.cues) parts.push(`${entry.omitted.cues} more`)
  if (entry.settings.length > 0) {
    const named = entry.settings.slice(0, 3).join(', ')
    const rest = entry.settings.length - 3 + (entry.omitted?.settings ?? 0)
    parts.push(rest > 0 ? `${named} +${rest} settings` : named)
  }
  return parts.length === 0 ? 'saved' : parts.join(' · ')
}
