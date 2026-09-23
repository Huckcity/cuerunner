import { app, dialog, BrowserWindow } from 'electron'
import { createHash } from 'crypto'
import { readFile, mkdir, stat, writeFile } from 'fs/promises'
import { statSync } from 'fs'
import { asRefusal, Refusal } from '../ipc/refusal'
import { hostname, userInfo } from 'os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import {
  mergeWorkspaces,
  type ConflictPolicy,
  type MergeNote,
  type MergeTally
} from '../../shared/showfileMerge'
import { readRecovery, recoveryFilePath, writeFileAtomically } from './recovery'
import type { MediaReference, MissingMedia } from '../../shared/media'
import {
  appendHistory,
  cueLabel,
  diffWorkspaces,
  historyEntry,
  type ShowHistoryEntry,
  type WorkspaceDiff
} from '../../shared/showfile'
import type { LoadNote, Workspace } from '../../shared/workspace'
import type { AudioCue, Cue } from '../../shared/cue'
import { CUE_TYPES } from '../../shared/cue'
import { heldShowSettings } from '../../shared/show'
import { hasCueList, normalizeTriggerGuard } from '../../shared/workspace'
import {
  savedShape,
  CUE_SHAPE,
  SHOW_SETTINGS_SHAPE,
  SHOW_SETTINGS_SECTIONS,
  WORKSPACE_SECTIONS,
  type DeclaredFields
} from '../../shared/workspaceSections'

/**
 * The largest workspace file this app opens: 64 MiB of JSON is already far past a
 * readable show.
 */
const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024

// A cue on disk carries fields the runtime cue type does not declare — `media` is the
// one left — so they are read through the cast, through here.
function legacyFields(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>
}

// ─── Cue grouping ─────────────────────────────────────────────────────────────
//
// Array order is the running order: a group's children sit contiguously behind it, and
// the walk that orders the show follows parentIds down from the top level. A hand-edited
// or damaged file can disagree with both — children scattered through the list, a cue
// naming a group that is not there, groups that lead back into each other — and then a
// walk either mis-fires on a child where it does not sit or never reaches a cue at all.
// The damage is repaired as the file is read, by one normaliser in the load funnel, rather
// than worked around in every walk. What it moved is reported through the
// optional out-array, the way media resolution reports the files it could not find.

/** The one-line wording of each repair on the load, read by the bar's dialog. */
const LOAD_REPAIR_DETAIL: Record<LoadNote['kind'], string> = {
  // True wherever the orphan sat: at the top level it keeps its place among the
  // top-level cues, which is not necessarily where it sat inside the block it was in.
  'missing-group': 'it has no group in this file: still fires with the show, at the top level',
  cycle: 'in a loop of groups: returned to the top level',
  reordered: 'its children were gathered into one block behind it'
}

/**
 * Repairs a cue list's grouping and returns the running order the walks expect, in three
 * passes: dissolve parents that name nothing (or a cue that is not a group), dissolve
 * parent loops, then gather every group's subtree into one block behind it. A cue whose
 * `parentId` is absent names no parent at all: the key is set and nothing is reported,
 * because a repair nobody's file needed is not a repair. Sibling and top-level relative
 * order is preserved, and the rebuild of an already well-formed array is that array — the
 * repair is a fixed point. The gather works on cue objects and carries an emitted guard, so
 * a file with a repeated id neither drops nor duplicates a cue. Nothing but `parentId` and
 * the order is touched; inside a timeline group the offsets stay authoritative and are left
 * exactly as they were.
 */
function normalizeGrouping(cues: Cue[], notes?: LoadNote[]): Cue[] {
  const note = (cueId: string, kind: LoadNote['kind']): void => {
    notes?.push({ cueId, kind, detail: LOAD_REPAIR_DETAIL[kind] })
  }

  // The cue an id names. A repeated id names the first occurrence, as every other id
  // lookup does; everything below works on cue objects, so the duplicate is neither
  // dropped nor re-emitted on somebody else's behalf.
  const byId = new Map<string, Cue>()
  for (const cue of cues) {
    if (!byId.has(cue.id)) byId.set(cue.id, cue)
  }
  const parentOf = (cue: Cue): Cue | null =>
    cue.parentId === null ? null : byId.get(cue.parentId) ?? null

  // Pass 1: a parent that is not in the file, or is not a group, cannot hold a cue. It
  // returns to the top level, keeping its place among the top-level cues, and fires with
  // the show.
  for (const cue of cues) {
    // A cue with no `parentId` key at all names nothing, so there is no repair to report:
    // it is a top-level cue already, and only the key is set. This build always writes one
    // — a hand-made file that leaves it out is not damage, and a load must not claim it
    // repaired something nobody wrote wrong.
    if (cue.parentId === undefined) {
      cue.parentId = null
      continue
    }
    if (cue.parentId === null) continue
    const parent = byId.get(cue.parentId)
    if (parent !== undefined && parent.type === 'group') continue
    cue.parentId = null
    note(cue.id, 'missing-group')
  }

  // Pass 2: a loop of parents has no top-level way in, so the walk that orders the show
  // never reaches its members. Every cue in the loop returns to the top level; a cue
  // hanging under a loop member was never in the loop and keeps its parent.
  const loop = new Set<Cue>()
  const settled = new Set<Cue>()
  for (const cue of cues) {
    if (cue.parentId === null || loop.has(cue) || settled.has(cue)) continue
    const path: Cue[] = []
    const onPath = new Set<Cue>()
    let at: Cue | null = cue
    while (at !== null && !onPath.has(at) && !loop.has(at) && !settled.has(at)) {
      path.push(at)
      onPath.add(at)
      at = parentOf(at)
    }
    if (at !== null && onPath.has(at)) {
      // The chain re-enters itself: the run from the first sighting onwards is the loop.
      for (const member of path.slice(path.indexOf(at))) loop.add(member)
    }
    for (const member of path) settled.add(member)
  }
  for (const cue of cues) {
    if (!loop.has(cue)) continue
    cue.parentId = null
    note(cue.id, 'cycle')
  }

  // Pass 3: the rebuild needs every cue's children and its subtree's extent in the
  // original array. Both are computed children-before-parent — each cue is reached once,
  // as a child of its parent — so the pass stays linear in the cue count.
  const childrenOf = new Map<Cue, Cue[]>()
  for (const cue of cues) {
    if (cue.parentId === null) continue
    const parent = byId.get(cue.parentId)
    if (parent === undefined) continue
    const children = childrenOf.get(parent)
    if (children === undefined) childrenOf.set(parent, [cue])
    else children.push(cue)
  }

  const indexOf = new Map<Cue, number>()
  cues.forEach((cue, index) => indexOf.set(cue, index))

  const size = new Map<Cue, number>()
  const least = new Map<Cue, number>()
  const most = new Map<Cue, number>()
  for (const root of cues) {
    if (root.parentId !== null) continue
    // An explicit stack, not recursion: a hand-edited file can nest groups past any sane
    // depth, and blowing the stack on one is not a repair.
    const stack: Array<{ cue: Cue; next: number }> = [{ cue: root, next: 0 }]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const children = childrenOf.get(frame.cue) ?? []
      if (frame.next < children.length) {
        stack.push({ cue: children[frame.next++], next: 0 })
        continue
      }
      stack.pop()
      let extent = 1
      let low = indexOf.get(frame.cue) ?? 0
      let high = low
      for (const child of children) {
        extent += size.get(child) ?? 1
        low = Math.min(low, least.get(child) ?? low)
        high = Math.max(high, most.get(child) ?? high)
      }
      size.set(frame.cue, extent)
      least.set(frame.cue, low)
      most.set(frame.cue, high)
    }
  }

  // A group is noted exactly when the rebuild moves something under it: its descendants
  // already fill the slots immediately behind it, or they do not. They hold exactly
  // `extent` cues, so lying inside the extent's slots is the same as filling them.
  for (const cue of cues) {
    if (cue.type !== 'group' || childrenOf.get(cue) === undefined) continue
    const own = indexOf.get(cue) ?? 0
    const extent = size.get(cue) ?? 1
    if ((least.get(cue) ?? own) === own && (most.get(cue) ?? own) === own + extent - 1) continue
    note(cue.id, 'reordered')
  }

  // The rebuild: top-level cues in array order, each followed by its subtree in a stable
  // depth-first walk. On a well-formed array it reproduces that array exactly.
  const ordered: Cue[] = []
  const emitted = new Set<Cue>()
  for (const root of cues) {
    if (root.parentId !== null) continue
    const stack: Cue[] = [root]
    while (stack.length > 0) {
      const cue = stack.pop() as Cue
      if (emitted.has(cue)) continue
      emitted.add(cue)
      ordered.push(cue)
      const children = childrenOf.get(cue)
      if (children === undefined) continue
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
    }
  }
  return ordered
}

/** Every section the saved form declares, as a file's own top level is read with it. */
const DECLARED_SECTIONS: Record<string, true> = Object.fromEntries(
  WORKSPACE_SECTIONS.map(section => [section.key, true])
)

/** Every section a show's settings carry, from the one declaration of them. */
const DECLARED_SHOW_SECTIONS: Record<string, true> = Object.fromEntries(
  SHOW_SETTINGS_SECTIONS.map(section => [section, true])
)

/** Every field a cue of each type has to carry, from the one declaration of them. */
const DECLARED_CUE_FIELDS: Record<string, readonly string[] | undefined> = Object.fromEntries(
  Object.entries(CUE_SHAPE)
)

/** The fields a show's settings carry, from the one declaration of them. */
const DECLARED_SETTINGS_FIELDS: DeclaredFields = SHOW_SETTINGS_SHAPE

/**
 * Where a value itself sits, for a sentence: `cast.channels.3` for a list's element, and the
 * list's own path for the list.
 */
function valuePath(path: string, at: number): string {
  return at < 0 ? path : `${path}.${at}`
}

/**
 * A field's path as a sentence names it: `desk.buttons`, `cast.channels.0.dcaId` — the path
 * of the object it is a field of, the element's index where that object is one, and the
 * field. Built only where a sentence needs one, so a document that is this build's own is
 * walked without joining a path at all.
 */
function fieldPath(path: string, at: number, field: string): string {
  const owner = valuePath(path, at)
  return owner === '' ? field : `${owner}.${field}`
}

/**
 * What a value is, for a sentence: bounded, because the value may be a list of a million
 * entries and the sentence is not the place to print it.
 */
function valueKind(value: unknown): string {
  if (value === null || value === undefined) return 'nothing'
  if (Array.isArray(value)) return 'a list'
  if (typeof value === 'object') return 'an object'
  return `a ${typeof value}`
}

/** Whether the declaration marks a field as one the types make optional on disk. */
function isAbsentOnDisk(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  return 'absent' in node && node.absent === true
}

/** A field's node with its `absent` wrapper — where the types put one — taken off. */
function shapeOf(node: unknown): unknown {
  if (typeof node !== 'object' || node === null) return node
  if (!('absent' in node) || node.absent !== true) return node
  return 'of' in node ? node.of : undefined
}

/** The fields a list's elements carry, or null when the declaration says the field is no list. */
function elementFields(node: unknown): DeclaredFields | null {
  const shape = shapeOf(node)
  if (typeof shape !== 'object' || shape === null || !('elements' in shape)) return null
  const elements = shape.elements
  // A node's `elements` is the fields of its elements' objects by construction, and the walk
  // only ever reads it as one.
  return typeof elements === 'object' && elements !== null ? (elements as DeclaredFields) : null
}

/**
 * Refuses a value whose fields are not the declared ones: a field the declaration does not
 * carry, a declared field the value has not got, or a declared field whose value is not the
 * kind of value the declaration says it is. `path` is where the value sits — a section's own
 * name, or the field a list hangs under — and `at` is its index where the value is a list's
 * element, or -1 where it is not.
 *
 * The walk descends through the declaration and not the document: four calls at the deepest
 * — the settings, a section, a list's elements and the lists inside them — whatever a file
 * nests, so no document can recurse it. A document's keys are iterated rather than listed,
 * and the declaration's are the declaration's own size, so a document with a million fields
 * costs the one that is wrong; and the walk refuses at the first thing it does not know
 * rather than collecting what it found.
 */
function refuseForeignFields(
  value: unknown,
  fields: DeclaredFields,
  path: string,
  at: number,
  source: string
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Refusal(
      `that show’s settings have ${valuePath(path, at)} as ${valueKind(value)},` +
      ` where this version of WinsLab writes an object` +
      ` — ${source} was probably saved by another build`
    )
  }
  const carried = value as Record<string, unknown>
  // The document's own keys, iterated rather than collected into an array: a file may carry a
  // million of them, and the walk refuses at the first it does not know.
  for (const field in carried) {
    if (Object.hasOwn(fields, field)) continue
    throw new Refusal(
      `that show’s settings have a field this version of WinsLab does not know` +
      ` (${fieldPath(path, at, field)})` +
      ` — ${source} was probably saved by a newer version`
    )
  }
  // The declaration's fields, in the declaration's order: a document that leaves one out is
  // refused here, which is the direction a file written before the field existed fails in.
  for (const field of Object.keys(fields)) {
    const node = fields[field]
    if (!Object.hasOwn(carried, field)) {
      if (isAbsentOnDisk(node)) continue
      throw new Refusal(
        `that show’s settings have no ${fieldPath(path, at, field)} field,` +
        ` which this version of WinsLab writes` +
        ` — ${source} was probably saved by an older build`
      )
    }
    const elements = elementFields(node)
    if (elements !== null) {
      refuseForeignList(carried[field], elements, fieldPath(path, at, field), source)
      continue
    }
    const shape = shapeOf(node)
    if (shape === 'leaf') continue
    refuseForeignFields(carried[field], shape as DeclaredFields, fieldPath(path, at, field), -1, source)
  }
}

/** Refuses a declared list's value that is not a list of objects with the declared fields. */
function refuseForeignList(value: unknown, fields: DeclaredFields, path: string, source: string): void {
  if (!Array.isArray(value)) {
    throw new Refusal(
      `that show’s settings have ${path} as ${valueKind(value)},` +
      ` where this version of WinsLab writes a list` +
      ` — ${source} was probably saved by another build`
    )
  }
  for (let at = 0; at < value.length; at++) refuseForeignFields(value[at], fields, path, at, source)
}

/**
 * Refuses a cue that has not got a field its own type has to carry — a field the deleted
 * migration pass used to fill in, which is what a file written before that field existed
 * carries. The check is the declared fields alone: a cue on disk carries fields the runtime
 * cue type does not declare — `media` is the one left — so a field this build does not
 * declare is kept rather than refused. A cue type the declaration does not know is left to
 * the arm below, which names it as the type it is.
 */
function refuseIncompleteCues(cues: readonly Cue[], source: string): void {
  for (const cue of cues) {
    if (typeof cue !== 'object' || cue === null || Array.isArray(cue)) {
      throw new Refusal(
        `that show has a cue that is not the shape this version of WinsLab writes` +
        ` — ${source} carries ${valueKind(cue)} instead`
      )
    }
    // `DECLARED_CUE_FIELDS` is a plain object, so a cue whose type is `constructor` or
    // `toString` would otherwise read a function off `Object.prototype` and be walked as a
    // list of fields — reach it through `hasOwn`, and let anything it does not own fall
    // through to the cue-type arm the funnel makes before this one.
    const declared = Object.hasOwn(DECLARED_CUE_FIELDS, cue.type)
      ? DECLARED_CUE_FIELDS[cue.type]
      : undefined
    if (declared === undefined) continue
    for (const field of declared) {
      if (Object.hasOwn(cue, field)) continue
      throw new Refusal(
        `that show’s cue ${cueLabel(cue)}` +
        ` (${String(cue.type)}) has no ${field} field, which this version of WinsLab writes` +
        ` — ${source} was probably saved by an older build`
      )
    }
  }
}

/**
 * Refuses a document whose shape this build does not write. Four levels are checked: the
 * file's own top level, where a section this build does not declare is the fact; a
 * `showSettings` the file does carry, which has to carry exactly the declared sections —
 * one this build does not declare, or one it leaves out, refuses rather than being filled
 * in; the fields inside those sections, read against the one declaration of them, in both
 * directions — a field this build does not write refuses, and so does a declared field the
 * document leaves out, because either way the window reads a value nobody wrote; and a
 * cue's declared-required fields, read in the one direction a cue has — a cue is content
 * rather than settings, so a field this build does not know there is kept, and only a field
 * a cue's own type requires and the document has not got refuses. A `showSettings` that is
 * there and is not a set of sections is refused the same way, so the operator gets a
 * sentence rather than the fault `Object.keys` throws at a null or the `in` operator at a
 * number.
 *
 * What is absent and legal is not checked. The keys such a document omits split in two: a
 * workspace with no history and no guard is this build's own write, and a workspace with no
 * settings section is one it reads — this build's saves always carry one, and a file that
 * does not is completed by the window's own defaults, not by anything here. Either way the
 * check is what the document carries, so a declared key it omits stays fine. Inside a
 * settings section it is the other way round: a section a file carries is read field by
 * field, because a field a later build added is a field the window dereferences. The one
 * field a document may leave out is the one the types mark `?:`, and none of a show's
 * settings does.
 *
 * The sentence names the source the bytes came from — a path, or the bundle entry a
 * showfile came out of, handed in by the caller — because the operator has to know which
 * file to look at, and the funnel is the only place that knows what the fact is. What a
 * file may be is bounded before any of this runs: `readWorkspaceFile` refuses anything past
 * `MAX_WORKSPACE_BYTES`, so a document this walk reads is at most 64 MiB of JSON, and the
 * walk itself is bounded by the declaration it descends.
 */
function refuseUnknownShape(workspace: Workspace, source: string): void {
  if (workspace.version !== 1) {
    // What is checked is the format's own literal — declared once, on the `Workspace` type,
    // and written by every writer — not a choice this build makes: a document that says
    // anything else speaks a format this build has no shape for. Named as JSON, so a number
    // is told from a string, and a key the file did not carry at all is said as nothing
    // rather than as `undefined`.
    const version = workspace.version === undefined ? 'nothing' : JSON.stringify(workspace.version)
    throw new Refusal(
      `that show says version ${version} and this build writes version 1` +
      ` — ${source} was probably saved by another build`
    )
  }
  for (const key of Object.keys(workspace)) {
    if (DECLARED_SECTIONS[key] === true) continue
    throw new Refusal(
      `that show has a section this version of WinsLab does not know (${key})` +
      ` — ${source} was probably saved by a newer version`
    )
  }
  const settings = workspace.showSettings as unknown
  if (settings !== undefined) {
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
      const carried = settings === null ? 'nothing' : JSON.stringify(settings)
      throw new Refusal(
        `that show’s settings are not the sections this version of WinsLab writes` +
        ` — ${source} carries ${carried} instead`
      )
    }
    const sections = settings as Record<string, unknown>
    for (const key of Object.keys(sections)) {
      if (DECLARED_SHOW_SECTIONS[key] === true) continue
      throw new Refusal(
        `that show’s settings have a section this version of WinsLab does not know (${key})` +
        ` — ${source} was probably saved by a newer version`
      )
    }
    for (const section of SHOW_SETTINGS_SECTIONS) {
      if (section in sections) continue
      throw new Refusal(
        `that show’s settings have no ${section} section, which this version of WinsLab writes` +
        ` — ${source} was probably saved by an older build`
      )
    }
    // The sections are this build's; the fields inside them are the level a file written
    // before one of them existed differs at.
    refuseForeignFields(sections, DECLARED_SETTINGS_FIELDS, '', -1, source)
  }
  refuseIncompleteCues(workspace.cues, source)
}

/** A document as the window holds it: its settings read with this build's defaults in. */
const asHeld = (workspace: Workspace): Workspace => ({
  ...workspace,
  showSettings: heldShowSettings(workspace.showSettings)
})

/**
 * The funnel every set of workspace bytes goes through: what this build wrote, it
 * reads; what it does not know, it refuses — naming the source it came from and the fact,
 * as a `Refusal` value, with the file on disk untouched. There is no migration here: an
 * older file refusing to load is the accepted outcome, not a regression, because the
 * alternative is silently reinterpreting a show nobody wrote.
 *
 * What a load does normalise is the grouping repair alone — a file this build wrote and
 * something damaged — reported through the notes out-array beside missing media. Nothing
 * wider is repaired, and loading never writes a file.
 */
export function migrateWorkspace(workspace: Workspace, source: string, notes?: LoadNote[]): Workspace {
  refuseUnknownShape(workspace, source)
  // A cue type this build has never heard of — a file from a newer build, or a hand
  // edit — cannot be drawn: the row renders its icon from the type and the whole window
  // goes down with it. Nothing is thrown away quietly either, because a show saved back
  // without its unknown cues would be a show missing its cues, so the file is refused.
  const unknown = workspace.cues.find(
    cue => !(CUE_TYPES as readonly string[]).includes(cue.type as string)
  )
  if (unknown !== undefined) {
    throw new Refusal(
      `that show has a cue this version of WinsLab does not know (${String(unknown.type)})` +
      ` — ${source} was probably saved by a newer version`
    )
  }

  workspace.cues = normalizeGrouping(workspace.cues, notes)
  // A workspace saved before the firing guard existed has none: it gets the default,
  // which is the window that keeps a bounced trigger from truncating a cue.
  workspace.triggerGuard = normalizeTriggerGuard(workspace.triggerGuard)
  return workspace
}

const MAX_RECENT = 10

// ─── Media portability ────────────────────────────────────────────────────────
//
// A workspace names its audio files, and the file it names has to be found after the
// folder around it has been copied to another machine or another drive. Saving writes
// each file twice: relative to the workspace folder when it lives inside it, and always
// as the absolute path it had. Loading tries the stored path first — the relative half
// is what survives a move — and falls back to the absolute original, which is what
// finds media that stayed put while the workspace file was copied. What neither finds
// is reported, so the operator can relink it instead of running a show with a silent cue.
//
// The pair travels with the resolved cue through the session, because nothing else knows
// it: the window hands the show back at save time with no path arithmetic of its own, so
// the route a file was read with is the only record of it a later save can write. A save
// writes that pair back rather than deriving one from the path this machine happened to
// resolve, which is what keeps a show that moved findable.

/** Whether a candidate path is a file that can actually be played. */
export type ExistsCheck = (candidate: string) => boolean

const isFile: ExistsCheck = candidate =>
  statSync(candidate, { throwIfNoEntry: false })?.isFile() === true

/** Where a workspace says a cue's media is, before anything has been looked for. */
export interface MediaReferenceLike {
  path: string
  originalPath?: string | null
}

export interface MediaResolution {
  /** The absolute path to play, or null when no candidate was there. */
  filePath: string | null
  /** The path the workspace stored, exactly as stored. */
  storedPath: string
  /** Absolute last-known location, for the relink dialog to point at. */
  originalPath: string
}

/**
 * Looks for one reference: the stored path (relative to the workspace folder when it is
 * relative), then the absolute original. Nothing else is guessed.
 */
export function resolveMediaReference(
  reference: MediaReferenceLike,
  workspaceDir: string | null,
  exists: ExistsCheck = isFile
): MediaResolution {
  const storedPath = reference.path
  const originalPath = typeof reference.originalPath === 'string' ? reference.originalPath : ''

  const candidates: string[] = []
  if (isAbsolute(storedPath)) candidates.push(storedPath)
  else if (workspaceDir) candidates.push(resolve(workspaceDir, storedPath))
  if (originalPath !== '' && isAbsolute(originalPath) && !candidates.includes(originalPath)) {
    candidates.push(originalPath)
  }

  return {
    filePath: candidates.find(candidate => exists(candidate)) ?? null,
    storedPath,
    // A missing entry always carries somewhere to point a picker at.
    originalPath: originalPath || candidates[0] || storedPath
  }
}

/**
 * The route pair a cue came with, or null when it carries none — a blank cue, a file
 * dropped into this session, a workspace saved before the pair existed. Read through the
 * cast for the same reason it always was: `media` is a disk shape, and the runtime cue
 * type declares only `filePath`.
 */
function mediaOf(cue: AudioCue): MediaReferenceLike | null {
  const media = legacyFields(cue).media as Partial<MediaReference> | undefined
  if (!media || typeof media.path !== 'string' || media.path === '') return null
  return media as MediaReferenceLike
}

/**
 * The pair a save may write back: a cue's own record only when the file holds both
 * halves. Half a pair is not written back as half a pair — the file would carry a route
 * whose last-known absolute was never recorded, and the cue's own path is then the better
 * record of where the file is — so such a cue is saved the way a cue with no pair is.
 */
function storedPairOf(cue: AudioCue): MediaReference | null {
  const media = mediaOf(cue)
  if (media === null || typeof media.originalPath !== 'string') return null
  return { path: media.path, originalPath: media.originalPath }
}

function resolveCueMedia(
  cue: Cue,
  workspaceDir: string | null,
  missingMedia: MissingMedia[]
): Cue {
  if (cue.type !== 'audio') return cue
  const audio = cue as AudioCue
  const stored = mediaOf(audio)
  // A cue with no file is waiting to be given one, not broken: blank audio cues are
  // added from the toolbar and filled in later.
  if (!stored && audio.filePath === '') return cue

  const resolution = resolveMediaReference(
    stored ?? { path: audio.filePath, originalPath: isAbsolute(audio.filePath) ? audio.filePath : '' },
    workspaceDir
  )

  // The session carries the route the show came from, not only the path this machine
  // resolved: the pair is what a later save writes back, so a show whose folder moved
  // keeps the route it was saved with. `filePath` is the absolute this machine found when
  // the file was there; when nothing was found it keeps what the file carried, which for
  // a file this build wrote is the stored route — the missing report and the next save
  // are what work from there.
  const runtime = { ...audio } as AudioCue & Record<string, unknown>
  if (stored) runtime.media = stored
  if (resolution.filePath !== null) {
    runtime.filePath = resolution.filePath
  } else {
    missingMedia.push({
      cueId: cue.id,
      path: resolution.storedPath,
      originalPath: resolution.originalPath
    })
  }
  return runtime
}

/**
 * Resolves every audio cue in a workspace. The workspace is not modified: the caller
 * gets a copy whose cues carry playable paths, plus the cues nothing could be found for.
 * `workspacePath` is the .cuerunner file — relative references resolve against the folder
 * that holds it. A workspace with no path of its own (a demo, an unsaved show) can still
 * resolve absolute references.
 */
export function resolveWorkspaceMedia(
  workspace: Workspace,
  workspacePath: string | null
): { workspace: Workspace; missingMedia: MissingMedia[] } {
  const workspaceDir = workspacePath ? dirname(workspacePath) : null
  const missingMedia: MissingMedia[] = []
  const cues = workspace.cues.map(cue => resolveCueMedia(cue, workspaceDir, missingMedia))
  return { workspace: { ...workspace, cues }, missingMedia }
}

/**
 * The path to store for a file: relative to the workspace folder when it really lives
 * inside that folder, absolute when it does not. Compared with `relative` rather than a
 * string prefix, so a sibling folder whose name merely starts with the folder's is not
 * mistaken for being inside it.
 */
export function storedMediaPath(absolutePath: string, workspaceDir: string): string {
  const fromFolder = relative(workspaceDir, absolutePath)
  const outside =
    fromFolder === '' ||
    fromFolder === '..' ||
    fromFolder.startsWith(`..${sep}`) ||
    isAbsolute(fromFolder)
  return outside ? absolutePath : fromFolder
}

/**
 * The route a save writes for one cue, and the absolute path the file was last seen at.
 *
 * A file this session resolved to a path inside the folder being saved into is this
 * folder's own — the path is the proof — so the route is written from where the file now
 * sits, relative to that folder.
 *
 * Everywhere else the route the show came with is the one that travels: it presumes the
 * media moves with the show, and the absolute half is the fallback for the machine where
 * the media stayed put, tried only where nothing sits at the route. So the pair is
 * written back as the file carried it — the relative route kept, the last-known absolute
 * kept with it — which is what a save over a folder that does not hold the media does.
 * Deriving a route from the path this session tried instead would replace a portable
 * route with one machine's absolute path, and the copy the show was made for would open
 * missing its media.
 *
 * A cue whose own path the stored pair does not name has no route of its own to keep —
 * the session was pointed at another file after that pair was read — so one is derived
 * from the path the cue holds now, exactly as for a cue that never carried a pair.
 *
 * The pair wins over the resolution when the pair's own route names the very file this
 * session resolved: the show still points where it pointed, so the absolute half is the
 * file's record rather than this machine's path — which is what keeps a show that ships
 * beside its media byte-identical on every machine it is opened on, the demo included.
 * That is only so while the pair's route is the route this save would write; a pair naming
 * an absolute path for a file the folder being saved into holds is not written back, because
 * `storedMediaPath` has the portable answer for exactly that file.
 */
function savedMedia(cue: AudioCue, workspaceDir: string): MediaReference {
  const held = cue.filePath
  const stored = storedPairOf(cue)
  if (isAbsolute(held)) {
    const route = storedMediaPath(held, workspaceDir)
    if (route !== held) {
      // A pair whose own route names the very file this session resolved is kept — the pair
      // is the show's record, which is what keeps a show that ships beside its media
      // byte-identical on every machine — but only when that route is already the route this
      // save would write. A pair recording an absolute path for a file the folder being saved
      // into holds is not: `storedMediaPath` has the portable answer for that file, and
      // writing the pair back would turn it into one machine's path.
      if (stored && stored.path === route && resolve(workspaceDir, stored.path) === held) return stored
      return { path: route, originalPath: held }
    }
  }
  if (stored && (held === stored.path || held === stored.originalPath)) return stored
  const absolutePath = isAbsolute(held) ? held : resolve(workspaceDir, held)
  return { path: storedMediaPath(absolutePath, workspaceDir), originalPath: absolutePath }
}

// The on-disk form: the runtime workspace, with each named file's location written as
// both its route — relative to the folder being saved into when the media lives inside
// it — and the absolute path it was last seen at. A cue whose file this session resolved
// inside that folder is refreshed from that path; otherwise the pair the show came with
// is written back, which is what keeps a route that has moved portable. The caller's
// object is left alone.
//
// The bytes are a function of the show's state and the folder it is saved into — nothing
// else, and in particular not the clock. The show's id and createdAt arrive in the
// workspace object and are written back as they came; the renderer owns them
// (`buildWorkspace`) and only mints them for a new show. That is what makes a showfile
// diffable: saving a show that has not changed puts the same bytes back.
//
// The key order is the saved form's own declaration, not whichever object the caller
// built: a format whose bytes depend on the order somebody happened to assign fields in
// is a format that will eventually churn for a reason nobody can find. `savedShape`
// writes the declared order; adding or moving a key means editing the declaration
// (`src/shared/workspaceSections.ts`), and the declaration is also what the settings diff
// and the merge walk.
// Held by src/main/workspace/savedShape.test.ts, determinism.test.ts and e2e/showfile.spec.ts.
//
// `references` is for the one caller that stores a show somewhere other than the folder
// its media lives in: a bundle records each cue's entry inside the bundle and the
// absolute path the file had where it came from, neither of which can be derived from
// the folder the bundle is written into.
export function serialiseWorkspace(
  workspace: Workspace,
  workspaceDir: string,
  references?: Map<string, MediaReference>
): string {
  const cues = workspace.cues.map(cue => {
    const recorded = references?.get(cue.id)
    // A recorded pair is the bundle's own route to the file, so it is the cue's written
    // path too: no caller has to have set one first for the rule to hold.
    if (recorded) return { ...cue, filePath: recorded.path, media: recorded }
    if (cue.type !== 'audio' || cue.filePath === '') {
      // A cue with no file has no route to record. A pair a file left on one — a
      // hand-edited show, where the path was blanked but the record was not — names a
      // file this cue does not play, so it is not written back.
      const pairless = { ...cue } as Cue & { media?: unknown }
      delete pairless.media
      return pairless
    }
    const media = savedMedia(cue, workspaceDir)
    // The written `filePath` is the route, never the path this machine resolved: a path
    // a workspace-relative route can describe has no business on disk (AD-10).
    return { ...cue, filePath: media.path, media }
  })
  return JSON.stringify(savedShape({ ...workspace, cues }), null, 2)
}

// ─── The identity of the file on disk ─────────────────────────────────────────
//
// A save replaces whatever is at the path it is handed. Every path it can be handed was
// either read or written by this process first, so main can hold those bytes' identity —
// and holding it is what lets a save tell "the file this session was built from" from "a
// file somebody else has changed since". An identity is taken where main reads or writes
// a showfile and nowhere else: the reads that merely report on a file (a comparison, a
// merge, the save's own history pass) leave no record behind, or they would refresh the
// very baseline the next save checks.
//
// The bytes are the verdict, never the mtime: a show lives on a share, a copy preserves
// timestamps, and two writes inside one filesystem tick share one mtime.

/** What main last saw at a path: the byte length, and the SHA-256 of the bytes. */
export interface FileFingerprint {
  size: number
  hash: string
}

const fileIdentities = new Map<string, FileFingerprint>()

/**
 * The key a path is remembered by. The same file arrives spelled differently — a dialog
 * that hands over a redundant segment, a share reached by its mapped letter and by its
 * UNC name on Windows — and a check that missed one of those spellings would replace the
 * very file it exists to ask about. Resolving settles the first; folding the case on
 * win32, the same rule the relink below decides two paths with, settles the second.
 */
function identityKey(filePath: string): string {
  return comparable(resolve(filePath))
}

function fingerprintOf(bytes: string | Buffer): FileFingerprint {
  const buffer = typeof bytes === 'string' ? Buffer.from(bytes, 'utf-8') : bytes
  return { size: buffer.byteLength, hash: createHash('sha256').update(buffer).digest('hex') }
}

/** Records the identity of a path from bytes this process has just read or written. */
export function rememberFile(filePath: string, bytes: string | Buffer): void {
  fileIdentities.set(identityKey(filePath), fingerprintOf(bytes))
}

/**
 * Records an identity main was handed rather than computed itself: a recovery snapshot
 * carries the fingerprint of the file the crashed session was built from, so a save after
 * a crash can compare the disk against the file as it was before the app died — the only
 * record that can speak for a session that is gone.
 */
function rememberFingerprint(filePath: string, fingerprint: FileFingerprint): void {
  fileIdentities.set(identityKey(filePath), fingerprint)
}

/** The identity main holds for a path, or null when it holds none. */
export function knownFingerprint(filePath: string | null): FileFingerprint | null {
  return filePath === null ? null : fileIdentities.get(identityKey(filePath)) ?? null
}

/**
 * Records the identity of a file from the disk itself, through the same ceiling every
 * read path uses. Best-effort: a file that is missing, unreadable or past the ceiling
 * keeps no identity, and a save to it asks nothing — the same treatment a path this app
 * has never read gets.
 */
async function rememberFileFromDisk(filePath: string): Promise<void> {
  try {
    const { size } = await stat(filePath)
    if (size > MAX_WORKSPACE_BYTES) return
    rememberFile(filePath, await readFile(filePath))
  } catch {
    // Nothing there to remember.
  }
}

/**
 * Whether the file at a path is no longer the one main last read or wrote there. The
 * verdict is the bytes: the sizes are compared first — a mismatch settles it without a
 * read — and equal sizes are settled by a bounded read and a hash. A path main holds no
 * identity for is not checked at all; a file that is gone or unreadable has changed, as
 * far as the operator is concerned.
 */
async function fileChangedOnDisk(filePath: string): Promise<boolean> {
  const known = knownFingerprint(filePath)
  if (known === null) return false
  try {
    const { size } = await stat(filePath)
    // An oversize file is a change decided without its body: the read below is bounded by
    // what this app would read in the first place.
    if (size !== known.size || size > MAX_WORKSPACE_BYTES) return true
    return fingerprintOf(await readFile(filePath)).hash !== known.hash
  } catch {
    // Missing or unreadable: the file this session knew is not there to compare with.
    return true
  }
}

/**
 * A showfile as it is on disk — read through the funnel, so this build knows the shape and
 * has repaired a damaged grouping — but not resolved: the stored form, which is what
 * a comparison between two files has to look at — a diff of resolved workspaces would
 * compare this machine's paths with this machine's paths.
 *
 * `remember` is for the reads that establish a session over the file — File→Open and the
 * recent list — and for nothing else.
 */
export async function readWorkspaceFile(
  filePath: string,
  notes?: LoadNote[],
  remember = false
): Promise<Workspace> {
  // A hostile .cuerunner is a zip bomb of the plain kind: cap the read before the parse,
  // rather than inflating attacker-declared JSON into main-process memory.
  //
  // The file being unreadable, oversize or not JSON is an ordinary state of a file the
  // operator picked, so each is a refusal — a marked error the channels answer as a
  // value — while the funnel below keeps its own refusals and its bugs keep throwing.
  let text: string
  // Only a session's own read wants an identity, and it is taken from the bytes as they
  // come off the disk — not from the decoded text, which a file that is not valid UTF-8
  // would not round-trip — and the buffer is out of scope before the parse. What is
  // carried through the parse is the fingerprint's two fields, not the file.
  let identity: FileFingerprint | undefined
  try {
    const { size } = await stat(filePath)
    if (size > MAX_WORKSPACE_BYTES) {
      throw new Refusal('that workspace file is larger than this app will open')
    }
    if (remember) {
      const bytes = await readFile(filePath)
      identity = fingerprintOf(bytes)
      text = bytes.toString('utf-8')
    } else {
      // The reads that only report on a file — a comparison, a merge, the save's own
      // history pass — carry the text alone: there is no identity to take, and no reason
      // to hold the file's bytes in memory beside their decoding.
      text = await readFile(filePath, 'utf-8')
    }
  } catch (error) {
    throw asRefusal(error)
  }
  let parsed: Workspace
  try {
    parsed = JSON.parse(text) as Workspace
  } catch {
    // A file the operator picked that is not a show: V8's own parse text names neither
    // the file nor the fact, so the two are said here — this is the only place that has
    // the path, and the File menu's route reaches the window without one.
    throw new Refusal(`that file is not a show — ${filePath} is not JSON`)
  }
  // Bytes that parse are still not necessarily a show — a hand edit, another tool's export,
  // a download that is JSON because the proxy's error page is. The migration's first read is
  // the cue list, so a document without one is answered with V8's own
  // `Cannot read properties of undefined (reading 'find')` unless the shape is refused here,
  // and the sentence says which file it was.
  if (!hasCueList(parsed)) {
    throw new Refusal(`that file is not a show — ${filePath} holds no cue list`)
  }
  const workspace = migrateWorkspace(parsed, filePath, notes)
  // Recorded only once the read has produced a workspace: a file this build refuses is not
  // one a session was established over, and the identity describes the bytes a session is
  // built from — what the next save checks the disk against.
  if (identity !== undefined) rememberFingerprint(filePath, identity)
  return workspace
}

/** Who a save is attributed to: the operating system's own answer, not the app's. */
function whoSaved(): { by: string; machine?: string } {
  let by: string
  try {
    by = userInfo().username
  } catch {
    // A machine with no user record can still save a show; the entry says so.
    by = 'unknown'
  }
  let machine: string | undefined
  try {
    machine = hostname() || undefined
  } catch {
    machine = undefined
  }
  return machine ? { by, machine } : { by }
}

/**
 * The file's history as this save leaves it: what the file already had, plus one entry
 * describing what this save changed — or the show's own history when there is no file to
 * compare against, which is what a first save, a Save As and a recovered session are.
 *
 * The file is what history is carried in, for the same reason a save compares itself
 * with the file rather than with the window's memory of it: a caller that never asked
 * what was written must not be able to drop it by saving again.
 *
 * The comparison is against the file that is about to be replaced, read through the same
 * funnel a load uses, so the app's own bookkeeping — where a cue's media sits on this
 * machine, and the settings section the window stands in for when a file carries none —
 * is not reported as an edit. A file that
 * cannot be read is not an error here: there is simply nothing to compare against, and a
 * history entry is not worth failing a save for.
 */
async function historyForSave(
  filePath: string,
  workspace: Workspace,
  contents: string
): Promise<ShowHistoryEntry[]> {
  const carried = workspace.history ?? []
  let previous: Workspace
  try {
    previous = await readWorkspaceFile(filePath)
  } catch {
    return carried
  }
  // Saving over another show's file — Save As onto a name that is taken — replaces a
  // document rather than editing one: the difference between two different shows is not
  // a change to either, and this show's own history travels with it.
  if (previous.id !== workspace.id) return carried

  const base = previous.history ?? []
  // The window stands its own defaults in for a settings section a file does not carry, so a
  // file's first save writes one it never had. That section is the app's, not the operator's:
  // both sides are compared as the window holds them — `heldShowSettings`, the one place that
  // rule lives — so the defaults are what such a file already meant, while a setting somebody
  // changed inside them is still the change it is.
  // `contents` is this build's own serialisation, so the funnel has nothing to refuse here;
  // the file being replaced went through it above, where a refusal is the
  // nothing-to-compare-against answer.
  const diff = diffWorkspaces(
    { ...previous, showSettings: heldShowSettings(previous.showSettings) },
    asHeld(migrateWorkspace(JSON.parse(contents) as Workspace, filePath))
  )
  const { by, machine } = whoSaved()
  const entry = historyEntry(diff, new Date().toISOString(), by, machine)
  return entry ? appendHistory(base, entry) : base
}

// ─── Relink ───────────────────────────────────────────────────────────────────
//
// One pick should put a moved media folder back together, not one pick per file. The
// operator points at one missing file; the path they chose and the path the workspace
// remembers it by share a tail — the folders the file never left — and everything before
// that tail is what changed. The same change is applied to the other missing files, and
// a file is only relinked when it is really there afterwards.

const comparable = (part: string): string =>
  process.platform === 'win32' ? part.toLowerCase() : part

// An absolute path is a root and a list of segments. Keeping the root apart matters on
// Windows, where it is a drive ("C:\") or a network share ("\\server\share\") and cannot
// be reassembled from the segments alone.
const ABSOLUTE_ROOT = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]|[\\/])/

interface SplitPath {
  root: string
  segments: string[]
}

function splitAbsolute(absolutePath: string): SplitPath {
  const normalized = resolve(absolutePath)
  const root = normalized.match(ABSOLUTE_ROOT)?.[0] ?? sep
  return {
    root,
    segments: normalized.slice(root.length).split(sep).filter(segment => segment !== '')
  }
}

/**
 * What one picked file relinks. A cue is relinked only when the mapped path exists, and
 * the mapping is never used to search a folder for another file with the same name —
 * with several candidates there is no way to know which one the operator meant.
 */
export function planMediaRelink(
  missingMedia: MissingMedia[],
  cueId: string,
  chosenFile: string,
  exists: ExistsCheck = isFile
): Map<string, string> {
  const plan = new Map<string, string>()
  const primary = missingMedia.find(entry => entry.cueId === cueId)
  if (!primary || !exists(chosenFile)) return plan

  const chosen = resolve(chosenFile)
  plan.set(cueId, chosen)

  if (!isAbsolute(primary.originalPath)) return plan
  const target = splitAbsolute(primary.originalPath)
  const arrived = splitAbsolute(chosen)

  // How much of the way to the file is the same on both sides. The shared tail is the
  // part of the path that did not move; what precedes it is the difference to carry
  // over to the files that have not been picked yet.
  let common = 0
  while (
    common < target.segments.length &&
    common < arrived.segments.length &&
    comparable(target.segments[target.segments.length - 1 - common]) ===
      comparable(arrived.segments[arrived.segments.length - 1 - common])
  ) {
    common++
  }

  const oldPrefix = target.segments.slice(0, target.segments.length - common)
  const newPrefix = arrived.segments.slice(0, arrived.segments.length - common)
  // The same file picked from where it already was: nothing moved, so nothing is
  // inferred about the files that are still missing.
  if (oldPrefix.length === 0 && comparable(target.root) === comparable(arrived.root)) return plan

  for (const entry of missingMedia) {
    if (plan.has(entry.cueId) || !isAbsolute(entry.originalPath)) continue
    const missingFile = splitAbsolute(entry.originalPath)
    if (comparable(missingFile.root) !== comparable(target.root)) continue
    if (missingFile.segments.length <= oldPrefix.length) continue
    if (!oldPrefix.every((segment, i) => comparable(missingFile.segments[i]) === comparable(segment))) continue

    const candidate = arrived.root + [...newPrefix, ...missingFile.segments.slice(oldPrefix.length)].join(sep)
    if (exists(candidate)) plan.set(entry.cueId, candidate)
  }
  return plan
}

const AUDIO_FILTERS = [
  { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aiff'] },
  { name: 'All Files', extensions: ['*'] }
]

/**
 * Prompts once for one missing cue's media, then relinks every other missing file the
 * same move accounts for. Cancel, or a pick that resolves nothing, hands the workspace
 * back unchanged: unresolved media keeps the path it was last seen at rather than
 * losing it.
 */
export async function relinkWorkspaceMedia(
  win: BrowserWindow,
  workspace: Workspace,
  workspacePath: string | null,
  cueId: string
): Promise<{ workspace: Workspace; missingMedia: MissingMedia[] }> {
  const current = resolveWorkspaceMedia(workspace, workspacePath)
  const entry = current.missingMedia.find(media => media.cueId === cueId)
  if (!entry) return current

  const result = await dialog.showOpenDialog(win, {
    title: 'Find Missing Media',
    defaultPath: entry.originalPath !== '' ? entry.originalPath : undefined,
    filters: AUDIO_FILTERS,
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return current

  const plan = planMediaRelink(current.missingMedia, cueId, result.filePaths[0])
  if (plan.size === 0) return current

  const workspaceDir = workspacePath === null ? null : dirname(workspacePath)
  const cues = current.workspace.cues.map(cue => {
    const relinked = cue.type === 'audio' ? plan.get(cue.id) : undefined
    if (relinked === undefined) return cue
    // The picked file replaces the show's stored route as well as the runtime path: the
    // next save writes where the file is now, not where the show last saw it. The route
    // is the one a save would write — relative when the pick lives inside the show's own
    // folder, absolute when it does not.
    const audio = { ...cue } as AudioCue & Record<string, unknown>
    audio.filePath = relinked
    audio.media = {
      path: workspaceDir === null ? relinked : storedMediaPath(relinked, workspaceDir),
      originalPath: relinked
    } satisfies MediaReference
    return audio as Cue
  })
  // Resolving again reports whatever the pick did not account for, so the operator can
  // pick again for the rest.
  return resolveWorkspaceMedia({ ...current.workspace, cues }, workspacePath)
}

// Simple JSON persistence for the recent files: a handful of paths do not need a store
function recentFilePath(): string {
  return join(app.getPath('userData'), 'recent.json')
}

async function readRecent(): Promise<string[]> {
  try {
    const raw = await readFile(recentFilePath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function writeRecent(paths: string[]): Promise<void> {
  const filePath = recentFilePath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(paths), 'utf-8')
}

async function addToRecent(filePath: string): Promise<void> {
  const recent = await readRecent()
  const updated = [filePath, ...recent.filter(p => p !== filePath)].slice(0, MAX_RECENT)
  await writeRecent(updated)
}

export async function getRecentFiles(): Promise<string[]> {
  return readRecent()
}

export async function openWorkspace(
  win: BrowserWindow
): Promise<{
  path: string
  workspace: Workspace
  missingMedia: MissingMedia[]
  loadNotes: LoadNote[]
} | null> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Workspace',
    filters: [{ name: 'Cuerunner Workspace', extensions: ['cuerunner'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return null

  const filePath = result.filePaths[0]
  // The same read, cap and funnel every other load path uses: File→Open is the way
  // most shows arrive, and a 500 MB one must be refused here too — as the ordinary state
  // it is, so the channel can answer it instead of logging a stack.
  const loadNotes: LoadNote[] = []
  const workspace = await readWorkspaceFile(filePath, loadNotes, true)
  await addToRecent(filePath)
  return { path: filePath, ...resolveWorkspaceMedia(workspace, filePath), loadNotes }
}

export async function openWorkspaceFromPath(
  filePath: string
): Promise<{
  path: string
  workspace: Workspace
  missingMedia: MissingMedia[]
  loadNotes: LoadNote[]
}> {
  const loadNotes: LoadNote[] = []
  const workspace = await readWorkspaceFile(filePath, loadNotes, true)
  await addToRecent(filePath)
  return { path: filePath, ...resolveWorkspaceMedia(workspace, filePath), loadNotes }
}

/**
 * A recovery snapshot as the renderer sees it, with its media resolved like any other
 * load: work recovered days later may well point at files that have moved since.
 */
export async function openRecovery(): Promise<{
  workspace: Workspace
  savedAt: number
  sourcePath: string | null
  selectedCueId?: string | null
  missingMedia: MissingMedia[]
  loadNotes: LoadNote[]
} | null> {
  const snapshot = await readRecovery()
  if (!snapshot) return null
  // A session that died on another build leaves a snapshot this one may not know: it goes
  // through the same funnel every other file does, and a shape this build does not write
  // is refused by name like any other file's.
  const loadNotes: LoadNote[] = []
  const workspace = migrateWorkspace(snapshot.workspace, recoveryFilePath(), loadNotes)
  // The file this session was built from gets its identity back before the session is on
  // screen: the snapshot's own record of it speaks for a crash that left no process
  // behind, so a file changed while the app was dead is a change the recovered save can
  // report. A snapshot written before that record existed leaves the disk to answer,
  // which makes the file as it is at recovery the baseline.
  if (snapshot.sourcePath !== null) {
    if (snapshot.sourceFingerprint) rememberFingerprint(snapshot.sourcePath, snapshot.sourceFingerprint)
    else await rememberFileFromDisk(snapshot.sourcePath)
  }
  return {
    savedAt: snapshot.savedAt,
    sourcePath: snapshot.sourcePath,
    selectedCueId: snapshot.selectedCueId,
    ...resolveWorkspaceMedia(workspace, snapshot.sourcePath),
    loadNotes
  }
}

export interface SavedWorkspace {
  path: string
  /**
   * The file's own history as it was written, including the entry this save added. The
   * window carries it from then on, so the next save appends to a history rather than
   * replacing one.
   */
  history: ShowHistoryEntry[]
}

export async function saveWorkspace(
  win: BrowserWindow,
  workspace: Workspace,
  existingPath: string | null
): Promise<SavedWorkspace | null> {
  let filePath = existingPath

  if (!filePath) {
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Workspace',
      defaultPath: `${workspace.name || 'Untitled'}.cuerunner`,
      filters: [{ name: 'Cuerunner Workspace', extensions: ['cuerunner'] }]
    })
    if (result.canceled || !result.filePath) return null
    filePath = result.filePath
  }

  // The file about to be replaced, checked against the one this session was built from
  // before anything is even serialised. What is checked is a path main holds an identity
  // for — one this app has read or written. A path it has never seen, however it was
  // chosen, is not checked: there is nothing to compare against, and the file was named
  // in the OS dialog.
  if (await fileChangedOnDisk(filePath)) {
    const answer = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Overwrite', 'Abandon'],
      // Enter and Escape both abandon: the file keeps whatever is at it, and the show
      // stays unsaved — which is the recoverable half of the two answers.
      defaultId: 1,
      cancelId: 1,
      // Worded for every verdict the check can reach — changed, gone, unreadable, or too
      // large to read — and for what it can and cannot say: it never saw the bytes it was
      // refused, so it cannot claim the file changed, only that it is not vouching for it.
      message: `This app cannot confirm “${basename(filePath)}” is the file it opened or last saved`,
      detail: 'It has changed, gone, or become unreadable since. Overwrite replaces whatever is at '
        + 'that path with this show; Abandon leaves it alone and keeps this show unsaved.'
    })
    if (answer.response !== 0) return null
  }

  // Serialise first: a workspace that cannot be turned into JSON must not touch the
  // file, and the write itself goes through a temporary file plus a rename. Media
  // locations are written against the folder the file is going into, which is what
  // makes a show folder portable — and what keeps an outside file pointing at itself
  // instead of at a relative path that would not exist.
  const workspaceDir = dirname(filePath)
  const contents = serialiseWorkspace(workspace, workspaceDir)
  // What this save changed, written into the file as the file's own history. An
  // unchanged save adds no entry and writes the same bytes back.
  const history = await historyForSave(filePath, workspace, contents)
  const written =
    history === workspace.history
      ? contents
      : serialiseWorkspace(
          { ...workspace, history: history.length > 0 ? history : undefined },
          workspaceDir
        )
  await writeFileAtomically(filePath, written)
  // The bytes this save put there are this session's baseline from then on: a save that
  // replaces nothing new asks nothing.
  rememberFile(filePath, written)
  // The recent list is a convenience. The workspace is on disk at this point, and
  // reporting a failure here would tell the operator their show was not saved.
  await addToRecent(filePath).catch(() => {})
  return { path: filePath, history }
}

export async function saveWorkspaceAs(
  win: BrowserWindow,
  workspace: Workspace
): Promise<SavedWorkspace | null> {
  return saveWorkspace(win, workspace, null)
}

/** What a comparison says: the file it was made against, and the differences. */
export interface WorkspaceComparison {
  /** The file the show was compared with, which is the "before" side of the diff. */
  path: string
  diff: WorkspaceDiff
}

/**
 * How this show differs from a file the operator picks. The pick is the "before" side —
 * what changed since that file was written is the question, and the chosen file is
 * almost always the older one.
 *
 * The window's show has not been written yet, so it is put into the same stored form the
 * file on disk is in before the two are compared: a comparison between a runtime
 * workspace and a file would be comparing this machine's paths with a file's.
 */
export async function compareWorkspace(
  win: BrowserWindow,
  workspace: Workspace
): Promise<WorkspaceComparison | null> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Compare With',
    filters: [{ name: 'Cuerunner Workspace', extensions: ['cuerunner'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return null
  return compareWithFile(workspace, result.filePaths[0])
}

/** The comparison itself, for a file that is already known — a comparison with no dialog. */
export async function compareWithFile(
  workspace: Workspace,
  otherPath: string
): Promise<WorkspaceComparison> {
  const other = await readWorkspaceFile(otherPath)
  // Both sides go through the one funnel, which is what makes a comparison honest; the
  // window's side is this build's own serialisation, so there is nothing there to refuse.
  const mine = migrateWorkspace(
    JSON.parse(serialiseWorkspace(workspace, dirname(otherPath))) as Workspace,
    otherPath
  )
  // And both sides are compared as the window holds them: a document that has never written
  // a settings section is read as this build's defaults for the sections it leaves out, so a
  // file that has not got one is not reported as that whole section changing. What is
  // reported is what a person typed — the comparison's own promise.
  return { path: otherPath, diff: diffWorkspaces(asHeld(other), asHeld(mine)) }
}

/**
 * The merge itself, as the window asks for it: two files — the one to merge in, and the
 * version the two sides started from — merged into this show, written to a file the
 * operator names.
 *
 * A file rather than the open show, deliberately. A merge is a thing to look at before
 * trusting it, the show being merged into is a document somebody is still working on, and
 * writing the result somewhere new leaves every input exactly as it was — which is what
 * makes a merge safe to try twice.
 */
export interface MergedShow {
  path: string
  notes: MergeNote[]
  tally: MergeTally
  /** The two files this merge read, for a second attempt with the other policy. */
  inputs: MergeInputs
}

/**
 * How the merge report words a repair one of its input reads made. The source file is
 * named in every row: the same damage in both inputs would otherwise produce two rows
 * that read identically, and the ancestor's would claim to be about "the file it came
 * from" without saying which one that was.
 */
const MERGE_REPAIR_DETAIL: Record<LoadNote['kind'], (source: string) => string> = {
  'missing-group': source => `its group is not in “${source}”: placed at the top level`,
  cycle: source => `its group led back to it in “${source}”: placed at the top level`,
  reordered: source => `its children were gathered into one block behind it in “${source}”`
}

/**
 * The notes a read repaired one of the merge's input files with, as rows of the merge's
 * own report: the cue is named by the file it came from, and the wording says which file.
 * Without this the repair would have happened silently — the funnel nulls a dangling
 * parent before the merge's own parent repair ever sees it.
 */
function repairRows(notes: LoadNote[], file: Workspace, source: string): MergeNote[] {
  return notes.map(note => {
    const cue = file.cues.find(candidate => candidate.id === note.cueId)
    return {
      subject: cue ? cueLabel(cue) : note.cueId,
      detail: MERGE_REPAIR_DETAIL[note.kind](source),
      conflict: false
    }
  })
}

export async function mergeIntoNewFile(
  win: BrowserWindow,
  ours: Workspace,
  oursPath: string | null,
  theirsPath: string,
  ancestorPath: string,
  policy: ConflictPolicy = 'ours'
): Promise<MergedShow | null> {
  const theirsNotes: LoadNote[] = []
  const ancestorNotes: LoadNote[] = []
  const [theirs, ancestor] = await Promise.all([
    readWorkspaceFile(theirsPath, theirsNotes),
    readWorkspaceFile(ancestorPath, ancestorNotes)
  ])
  const result = mergeWorkspaces(ancestor, ours, theirs, { onConflict: policy })
  // The history of the file being merged into is the one that continues: the other two
  // are other files, and their entries belong to them.
  const merged = { ...result.workspace, history: ours.history }

  const suggested = `${ours.name || 'Untitled'} (merged)`
  const where = await dialog.showSaveDialog(win, {
    title: 'Save the Merged Show',
    defaultPath: oursPath === null
      ? `${suggested}.cuerunner`
      : join(dirname(oursPath), `${suggested}.cuerunner`),
    filters: [{ name: 'Cuerunner Workspace', extensions: ['cuerunner'] }]
  })
  if (where.canceled || !where.filePath) return null
  const written = serialiseWorkspace(merged, dirname(where.filePath))
  await writeFileAtomically(where.filePath, written)
  // The merge wrote a showfile, so it is this app's own bytes at that path: an identity is
  // taken where main writes one, here as much as in a save. (The window opens the merged
  // show from the report, and would take the identity again there — this is for the file
  // the merge left behind either way.)
  rememberFile(where.filePath, written)
  await addToRecent(where.filePath).catch(() => {})
  return {
    path: where.filePath,
    notes: [
      ...result.notes,
      ...repairRows(theirsNotes, theirs, basename(theirsPath)),
      ...repairRows(ancestorNotes, ancestor, basename(ancestorPath))
    ],
    tally: result.tally,
    inputs: { theirs: theirsPath, ancestor: ancestorPath }
  }
}

/** What a merge read, so a second attempt can start from the same two files. */
export interface MergeInputs {
  theirs: string
  ancestor: string
}

/** Asks for the two files a merge needs, then merges them. */
export async function mergeShow(
  win: BrowserWindow,
  ours: Workspace,
  oursPath: string | null,
  policy: ConflictPolicy = 'ours',
  inputs?: MergeInputs
): Promise<MergedShow | null> {
  let files = inputs
  if (!files) {
    const theirs = await dialog.showOpenDialog(win, {
      title: 'Merge which show in?',
      message: 'The other person’s copy of the show',
      filters: [{ name: 'Cuerunner Workspace', extensions: ['cuerunner'] }],
      properties: ['openFile']
    })
    if (theirs.canceled || !theirs.filePaths[0]) return null
    const ancestor = await dialog.showOpenDialog(win, {
      title: 'Which version did the two of you start from?',
      message: 'The copy both of you saved before working apart',
      filters: [{ name: 'Cuerunner Workspace', extensions: ['cuerunner'] }],
      properties: ['openFile']
    })
    if (ancestor.canceled || !ancestor.filePaths[0]) return null
    files = { theirs: theirs.filePaths[0], ancestor: ancestor.filePaths[0] }
  }
  const merged = await mergeIntoNewFile(win, ours, oursPath, files.theirs, files.ancestor, policy)
  if (merged === null) return null
  return { ...merged, inputs: files }
}

