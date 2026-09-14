import { app, dialog, BrowserWindow } from 'electron'
import { readFile, mkdir, writeFile } from 'fs/promises'
import { statSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { readRecovery, writeFileAtomically } from './recovery'
import { migrateLegacyAudioRouting } from '../../shared/audioRouting'
import type { MediaReference, MissingMedia } from '../../shared/media'
import type { Workspace } from '../../renderer/src/types/workspace'
import type { AudioCue, Cue } from '../../renderer/src/types/cue'
import {
  CHANNEL_START_COUNT,
  defaultShowSettings,
  normalizeShowSettings
} from '../../renderer/src/types/show'
import {
  DEFAULT_TRIGGER_GUARD,
  normalizeTriggerGuard
} from '../../renderer/src/types/workspace'

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
    const channelId = dcaId === null ? null : crypto.randomUUID()
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
      channels.push({ id: crypto.randomUUID(), name: '', dcaId: null })
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

export function migrateWorkspace(workspace: Workspace): Workspace {
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

  workspace.cues = cues
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

function mediaOf(cue: AudioCue): MediaReference | null {
  const media = legacyFields(cue).media as Partial<MediaReference> | undefined
  if (!media || typeof media.path !== 'string' || media.path === '') return null
  return {
    path: media.path,
    originalPath: typeof media.originalPath === 'string' ? media.originalPath : ''
  }
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

  // `media` is a disk shape. The runtime cue carries the path playback can open, so it
  // is resolved here and dropped; saving writes it again from the current filePath.
  const runtime = { ...audio } as AudioCue & Record<string, unknown>
  delete runtime.media
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
 * `workspacePath` is the .wlab file — relative references resolve against the folder
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

// The on-disk form: the runtime workspace, with each named file's location written as
// both its workspace-relative form and the absolute original it had at this save. The
// caller's object is left alone.
//
// The bytes are a function of the show's state and the folder it is saved into — nothing
// else, and in particular not the clock. The show's id and createdAt arrive in the
// workspace object and are written back as they came; the renderer owns them
// (`buildWorkspace`) and only mints them for a new show. That is what makes a showfile
// diffable: saving a show that has not changed puts the same bytes back.
// Held by src/main/workspace/determinism.test.ts and e2e/showfile.spec.ts.
function serialiseWorkspace(workspace: Workspace, workspaceDir: string): string {
  const cues = workspace.cues.map(cue => {
    if (cue.type !== 'audio' || cue.filePath === '') return cue
    const absolutePath = isAbsolute(cue.filePath) ? cue.filePath : resolve(workspaceDir, cue.filePath)
    return {
      ...cue,
      media: {
        path: storedMediaPath(absolutePath, workspaceDir),
        originalPath: absolutePath
      } satisfies MediaReference
    }
  })
  return JSON.stringify({ ...workspace, cues }, null, 2)
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

  const cues = current.workspace.cues.map(cue => {
    const relinked = cue.type === 'audio' ? plan.get(cue.id) : undefined
    return relinked === undefined ? cue : ({ ...cue, filePath: relinked } as Cue)
  })
  // Resolving again reports whatever the pick did not account for, so the operator can
  // pick again for the rest.
  return resolveWorkspaceMedia({ ...current.workspace, cues }, workspacePath)
}

// Simple JSON persistence for recent files (avoids adding electron-store dep complexity)
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
): Promise<{ path: string; workspace: Workspace; missingMedia: MissingMedia[] } | null> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Workspace',
    filters: [{ name: 'WinsLab Workspace', extensions: ['wlab'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return null

  const filePath = result.filePaths[0]
  const raw = await readFile(filePath, 'utf-8')
  const workspace: Workspace = migrateWorkspace(JSON.parse(raw))
  await addToRecent(filePath)
  return { path: filePath, ...resolveWorkspaceMedia(workspace, filePath) }
}

export async function openWorkspaceFromPath(
  filePath: string
): Promise<{ path: string; workspace: Workspace; missingMedia: MissingMedia[] }> {
  const raw = await readFile(filePath, 'utf-8')
  const workspace: Workspace = migrateWorkspace(JSON.parse(raw))
  await addToRecent(filePath)
  return { path: filePath, ...resolveWorkspaceMedia(workspace, filePath) }
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
} | null> {
  const snapshot = await readRecovery()
  if (!snapshot) return null
  return { ...snapshot, ...resolveWorkspaceMedia(snapshot.workspace, snapshot.sourcePath) }
}

export async function saveWorkspace(
  win: BrowserWindow,
  workspace: Workspace,
  existingPath: string | null
): Promise<string | null> {
  let filePath = existingPath

  if (!filePath) {
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Workspace',
      defaultPath: `${workspace.name || 'Untitled'}.wlab`,
      filters: [{ name: 'WinsLab Workspace', extensions: ['wlab'] }]
    })
    if (result.canceled || !result.filePath) return null
    filePath = result.filePath
  }

  // Serialise first: a workspace that cannot be turned into JSON must not touch the
  // file, and the write itself goes through a temporary file plus a rename. Media
  // locations are written against the folder the file is going into, which is what
  // makes a show folder portable — and what keeps an outside file pointing at itself
  // instead of at a relative path that would not exist.
  const contents = serialiseWorkspace(workspace, dirname(filePath))
  await writeFileAtomically(filePath, contents)
  // The recent list is a convenience. The workspace is on disk at this point, and
  // reporting a failure here would tell the operator their show was not saved.
  await addToRecent(filePath).catch(() => {})
  return filePath
}

export async function saveWorkspaceAs(
  win: BrowserWindow,
  workspace: Workspace
): Promise<string | null> {
  return saveWorkspace(win, workspace, null)
}

export function blankWorkspace(name = 'Untitled'): Workspace {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: defaultShowSettings(),
    triggerGuard: { ...DEFAULT_TRIGGER_GUARD },
    cues: []
  }
}
