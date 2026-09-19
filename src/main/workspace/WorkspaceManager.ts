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
import { readRecovery, writeFileAtomically } from './recovery'
import { migrateLegacyAudioRouting } from '../../shared/audioRouting'
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
import {
  CHANNEL_START_COUNT,
  defaultShowSettings,
  normalizeShowSettings
} from '../../shared/show'
import { normalizeTriggerGuard } from '../../shared/workspace'
import { savedShape } from '../../shared/workspaceSections'

/**
 * The largest workspace file this app opens: 64 MiB of JSON is already far past a
 * readable show.
 */
const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024

// Cues come out of a JSON file, so they can still carry fields a previous version
// wrote and this one no longer knows about. Read and delete those through here.
function legacyFields(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>
}

function migrateCue(cue: Cue & Record<string, unknown>): Cue {
  if (cue.advance === undefined) cue.advance = 'none'
  if (cue.preWait === undefined) cue.preWait = 0
  if (cue.postWait === undefined) cue.postWait = 0
  if (cue.timelineOffset === undefined) cue.timelineOffset = 0
  if (cue.colorLabel === undefined) cue.colorLabel = 'none'
  if (cue.isArmed === undefined) cue.isArmed = true
  if (cue.notes === undefined) cue.notes = ''
  if (cue.parentId === undefined) cue.parentId = null
  if (cue.triggers === undefined) cue.triggers = []
  // A cue saved before the policy existed restarts when it is re-fired, which is what
  // the app did unconditionally; what the show wants is the other one.
  if (cue.refire === undefined) cue.refire = 'ignore'
  if (cue.type === 'audio') {
    if (cue.playbackRate === undefined) cue.playbackRate = 1.0
    if (cue.trim === undefined) cue.trim = 1.0
    // A cue saved before silence trimming existed is not trimming anything, and a scan
    // started on somebody's show unasked is not a migration, it is a surprise.
    if (cue.trimSilence === undefined) cue.trimSilence = false
    // Per-cue device and channel-pair routing was never wired to the audio graph: only
    // the first output was ever audible, which is what the routing migration keeps.
    const routing = migrateLegacyAudioRouting(legacyFields(cue))
    cue.volume = routing.volume
    cue.pan = routing.pan
    cue.outputs = routing.outputs
  }
  if (cue.type === 'stop' && cue.waitForFade === undefined) cue.waitForFade = false
  if (cue.type === 'script' && cue.timeout === undefined) cue.timeout = 60000
  delete cue.autoContinue
  delete cue.autoFollow
  return cue
}

interface LegacyPack {
  id: string
  performerId?: string | null
  deskChannelId?: string | null
}

interface LegacyPerformer {
  id: string
  name?: string
  role?: string
  notes?: string
  ensembleId?: string | null
  deskChannelId?: string | null
  channelId?: string | null
}

interface LegacyEnsemble {
  id: string
  name?: string
  deskChannelId?: string | null
  members?: string[]
}

interface LegacyCast {
  groups?: unknown[]
  dcas?: LegacyDca[]
  channels?: unknown[]
  performers?: LegacyPerformer[]
  ensembles?: LegacyEnsemble[]
}

/** A DCA as an earlier build wrote it: both of its messages, one field at a time. */
interface LegacyDca {
  id: string
  label?: string
  mute?: LegacyMessage | null
  unmute?: LegacyMessage | null
  note?: number | null
  address?: string | null
}

type LegacyMessage =
  | { kind: 'midi'; portName?: string; message?: { kind?: string; channel?: number; note?: number } }
  | { kind: 'osc'; host?: string; port?: number; address?: string }

/**
 * Performers and desk groups used to live under the plot and the scenes section, keyed
 * to packs: a pack carried the desk group it fed, and a scene named the packs open in
 * it. Both moved up a level onto the cast — onto the performer, or the ensemble that
 * grouped them — so a workspace saved before that move is rewritten in place, once. The
 * pass after this one carries that routing the rest of the way, onto the channel strips
 * that hold it now.
 *
 * A file already in the new shape has no `rf.plot.performers` or `scenes.channels` left
 * to find, which is what makes this safe to run unconditionally on every load.
 */
function migratePlotCast(showSettings: Record<string, unknown>): void {
  const rf = showSettings.rf as Record<string, unknown> | undefined
  const plot = rf?.plot as Record<string, unknown> | undefined
  const scenes = showSettings.scenes as Record<string, unknown> | undefined
  const legacyPerformers = plot?.performers as
    Array<Record<string, unknown>> | undefined
  const legacyChannels = scenes?.channels as unknown[] | undefined
  if (legacyPerformers === undefined && legacyChannels === undefined) return

  const packs = ((plot?.packs as LegacyPack[] | undefined) ?? [])
  const performers: Array<Record<string, unknown>> = (legacyPerformers ?? []).map(
    (performer: Record<string, unknown>) => ({
      ...performer,
      ensembleId: null,
      deskChannelId: null as string | null
    })
  )

  // A performer's desk group used to live on whichever pack they wore. The first pack
  // found wearing them is what they carry forward — the same "only the first legacy
  // value survives" rule the audio-routing migration above already uses.
  for (const pack of packs) {
    if (!pack.deskChannelId || !pack.performerId) continue
    const performer = performers.find(candidate => candidate.id === pack.performerId)
    if (performer && performer.deskChannelId === null) performer.deskChannelId = pack.deskChannelId
  }

  const cast = (showSettings.cast as Record<string, unknown> | undefined) ?? {}
  cast.performers = performers
  cast.groups = legacyChannels ?? []
  cast.ensembles = cast.ensembles ?? []
  showSettings.cast = cast

  if (plot) delete plot.performers
  if (scenes) delete scenes.channels
  for (const pack of packs) delete (pack as unknown as Record<string, unknown>).deskChannelId

  // A scene's live list named packs; what it means now is who was wearing them. A pack
  // nobody was wearing drops out rather than leaving a dangling id nothing can show.
  const wornBy = new Map(packs.map(pack => [pack.id, pack.performerId ?? null]))
  const list = (scenes?.list as Array<Record<string, unknown>> | undefined) ?? []
  for (const scene of list) {
    const live = (scene.live as string[] | undefined) ?? []
    scene.live = [...new Set(
      live.map(packId => wornBy.get(packId) ?? null).filter((id): id is string => id !== null)
    )]
  }
}

/**
 * The second move, and the shape this build writes: a performer's desk routing left the
 * performer for their channel strip, an ensemble became membership rather than a pointer
 * on each of its members, and the desk's groups are the DCAs the show drives.
 *
 * What is preserved is what the desk was told: a performer who had a DCA — their own, or
 * the one their ensemble carried for them — is given the channel strip that now carries
 * it, named after them, which is the strip an operator would have made by hand. Nobody
 * routed gets no strip, which is the state a new performer starts in.
 */
function migrateChannelRouting(showSettings: Record<string, unknown>): void {
  const cast = showSettings.cast as LegacyCast | undefined
  if (!cast) return
  if (cast.channels !== undefined && cast.dcas !== undefined) return

  const performers = cast.performers ?? []
  const ensembles = cast.ensembles ?? []
  const dcas = (cast.dcas ?? cast.groups ?? []) as LegacyDca[]

  const ensembleDca = new Map(ensembles.map(ensemble => [ensemble.id, ensemble.deskChannelId ?? null]))
  const channels: Array<{ id: string; name: string; dcaId: string | null }> = []
  const migrated = performers.map(performer => {
    const dcaId = performer.deskChannelId
      ?? (performer.ensembleId ? ensembleDca.get(performer.ensembleId) ?? null : null)
    // The strip's id is its position, not a fresh one: migrating the same file twice —
    // on two machines, or twice on one — has to give the same bytes, or the same old
    // show becomes two different files the moment both copies are saved.
    const channelId = dcaId === null ? null : `channel-${channels.length + 1}`
    if (channelId !== null) {
      channels.push({ id: channelId, name: performer.name ?? '', dcaId })
    }
    return {
      id: performer.id,
      name: performer.name ?? '',
      role: performer.role ?? '',
      notes: performer.notes ?? '',
      channelId
    }
  })

  // A show whose performers were never routed keeps no strips here: an empty list reads
  // as "not set up yet", and the defaults give it the twelve a new show starts with.
  if (channels.length > 0) {
    while (channels.length < CHANNEL_START_COUNT) {
      channels.push({ id: `channel-${channels.length + 1}`, name: '', dcaId: null })
    }
    cast.channels = channels
  } else {
    delete cast.channels
  }

  // A strip used to carry whether it was in tonight's patch. One gesture answers that
  // now — it is there or it is not — so the field goes with the shape that had it.
  for (const channel of (cast.channels ?? []) as Array<Record<string, unknown>>) {
    delete channel.enabled
  }

  cast.performers = migrated
  cast.ensembles = ensembles.map(ensemble => ({
    id: ensemble.id,
    name: ensemble.name ?? '',
    members: performers.filter(candidate => candidate.ensembleId === ensemble.id).map(candidate => candidate.id)
  }))
  cast.dcas = dcas
  delete cast.groups
}

/**
 * The third move: a DCA used to carry both of its messages, one field at a time, and a
 * show had no connection of its own. What a DCA sends is now derived from its number
 * through the show's connection, so the connection is read back off the DCAs that were
 * patched — the pattern from the address of the first one, with its own number swapped
 * for `{n}` — and every one of those DCAs keeps what it was sending as an override. A
 * show does not start sending somewhere new because the app was updated; the derived
 * messages are the default for a show that has never been told otherwise.
 *
 * A show that had DCAs and drove none of them is left driving none.
 */
function migrateDesk(showSettings: Record<string, unknown>): void {
  const cast = showSettings.cast as LegacyCast | undefined
  const dcas = cast?.dcas
  if (dcas === undefined || showSettings.desk !== undefined) return

  const unmuteOf = (dca: LegacyDca): LegacyMessage | null => dca.unmute ?? dca.mute ?? null
  const patched = dcas.map(unmuteOf)
  if (patched.every(message => message === null)) {
    if (dcas.length > 0) showSettings.desk = { ...defaultShowSettings().desk, kind: 'none' }
    return
  }

  const firstOsc = patched.find((message): message is Extract<LegacyMessage, { kind: 'osc' }> =>
    message?.kind === 'osc')
  const firstMidi = patched.find((message): message is Extract<LegacyMessage, { kind: 'midi' }> =>
    message?.kind === 'midi')

  if (firstOsc !== undefined) {
    const pattern = addressPattern(firstOsc.address ?? '', 1)
    showSettings.desk = {
      ...defaultShowSettings().desk,
      kind: 'osc',
      host: firstOsc.host ?? '127.0.0.1',
      port: firstOsc.port ?? 8000,
      address: pattern
    }
  } else if (firstMidi !== undefined) {
    showSettings.desk = {
      ...defaultShowSettings().desk,
      kind: 'midi',
      midiPort: firstMidi.portName ?? '',
      midiChannel: firstMidi.message?.channel ?? 1
    }
  }

  const kind = (showSettings.desk as { kind: string } | undefined)?.kind
  dcas.forEach((dca, index) => {
    const message = patched[index]
    if (message === null) return
    if (kind === 'osc' && message.kind === 'osc') dca.address = message.address ?? null
    if (kind === 'midi' && message.kind === 'midi') dca.note = message.message?.note ?? index + 1
    delete dca.mute
    delete dca.unmute
  })
}

/**
 * The address pattern a show was driving its DCAs with: the DCA whose own number sat in
 * `/dca/7/mute` becomes `/dca/{n}/mute`, and an address with no number in it comes back
 * unchanged — which leaves every DCA carrying its address as an override, since none of
 * them is the pattern.
 */
function addressPattern(address: string, number: number): string {
  const token = new RegExp(`(?<![0-9])${number}(?![0-9])`)
  return token.test(address) ? address.replace(token, '{n}') : address
}

function migrateCast(showSettings: Record<string, unknown> | undefined): void {
  if (!showSettings) return
  migratePlotCast(showSettings)
  migrateChannelRouting(showSettings)
  migrateDesk(showSettings)
}

// ─── Cue grouping ─────────────────────────────────────────────────────────────
//
// Array order is the running order: a group's children sit contiguously behind it, and
// the walk that orders the show follows parentIds down from the top level. A hand-edited
// or damaged file can disagree with both — children scattered through the list, a cue
// naming a group that is not there, groups that lead back into each other — and then a
// walk either mis-fires on a child where it does not sit or never reaches a cue at all.
// The damage is repaired as the file is read, by one normaliser in the migration funnel,
// rather than worked around in every walk. What it moved is reported through the
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
 * parent loops, then gather every group's subtree into one block behind it. Sibling and
 * top-level relative order is preserved, and the rebuild of an already well-formed array
 * is that array — the repair is a fixed point. The gather works on cue objects and
 * carries an emitted guard, so a file with a repeated id neither drops nor duplicates a
 * cue. Nothing but `parentId` and the order is touched; inside a timeline group the
 * offsets stay authoritative and are left exactly as they were.
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

export function migrateWorkspace(workspace: Workspace, notes?: LoadNote[]): Workspace {
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
      ' — it was probably saved by a newer version'
    )
  }

  // Pass 1: normalize all cues
  const cues = workspace.cues.map(c => migrateCue(c as Cue & Record<string, unknown>))

  // Pass 2: convert legacy childIds → parentId
  // Groups that still have childIds haven't been converted yet
  const needsConversion = cues.filter(
    c => c.type === 'group' && Array.isArray(legacyFields(c).childIds)
  )

  for (const group of needsConversion) {
    const childIds: string[] = legacyFields(group).childIds as string[]
    // Mark children with this parentId
    for (const cue of cues) {
      if (childIds.includes(cue.id)) cue.parentId = group.id
    }
    // Reorder: pull children out and re-insert immediately after the group
    const children = childIds
      .map(id => cues.find(c => c.id === id))
      .filter((c): c is Cue => c !== undefined)
    // Remove children from wherever they sit
    for (const child of children) {
      const i = cues.indexOf(child)
      if (i > -1) cues.splice(i, 1)
    }
    // Re-insert after group (group index may have shifted)
    const newGroupIdx = cues.findIndex(c => c.id === group.id)
    cues.splice(newGroupIdx + 1, 0, ...children)
    // Remove the now-obsolete childIds field
    delete legacyFields(group).childIds
  }

  // The grouping is repaired last, so it sees the tree the legacy conversion built:
  // childIds already became parent pointers and the children already follow their group.
  workspace.cues = normalizeGrouping(cues, notes)
  // Pass 3: the show's setup is brought forward to this build's shape — from the plot
  // and the scenes section onto the cast, and from desk routing on performers and
  // ensembles onto the channel strips that carry it now — before defaulting fills in a
  // shape that already agrees with the new one.
  migrateCast(workspace.showSettings as Record<string, unknown> | undefined)
  // A workspace written before the show services existed has no port settings; the
  // defaults bring it up listening where a new one would.
  workspace.showSettings = normalizeShowSettings(workspace.showSettings)
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
 */
function savedMedia(cue: AudioCue, workspaceDir: string): MediaReference {
  const held = cue.filePath
  if (isAbsolute(held)) {
    const route = storedMediaPath(held, workspaceDir)
    if (route !== held) return { path: route, originalPath: held }
  }
  const stored = storedPairOf(cue)
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
 * A showfile as it is on disk, migrated but not resolved: the stored form, which is what
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
  // value — while the migration below keeps its own refusals and its bugs keep throwing.
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
  } catch (error) {
    throw asRefusal(error)
  }
  const workspace = migrateWorkspace(parsed, notes)
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
 * The comparison is against the file that is about to be replaced, migrated the way a
 * load migrates it, so an upgrade of the format is not reported as an edit. A file that
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
  const diff = diffWorkspaces(previous, migrateWorkspace(JSON.parse(contents) as Workspace))
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
  // The same read, cap and migration every other load path uses: File→Open is the way
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
  // A session that died on an older build leaves an older snapshot: it comes back
  // through the same migration every other file does, or a pre-parentId one would
  // return groups with no children and a show section whose panels cannot be read.
  const loadNotes: LoadNote[] = []
  const workspace = migrateWorkspace(snapshot.workspace, loadNotes)
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
  const mine = migrateWorkspace(
    JSON.parse(serialiseWorkspace(workspace, dirname(otherPath))) as Workspace
  )
  return { path: otherPath, diff: diffWorkspaces(other, mine) }
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
 * Without this the repair would have happened silently — the migration nulls a dangling
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

