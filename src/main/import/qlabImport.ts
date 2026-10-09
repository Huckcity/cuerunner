// File → Import QLab Workspace…: the flows the channels run.
//
// Either reader — the workspace file, or a QLab that is running — produces a `QLabShow`;
// the mapping turns it into cues and a report; and the cues go through the same funnel
// every show this build opens goes through (`migrateWorkspace`), so an import can never
// hand the window a show the window cannot draw. The result is a new show with no file of
// its own: nothing is written anywhere, the QLab project included, until the operator
// saves it.
//
// Audio paths are made absolute against the QLab workspace's own folder, which is where
// QLab keeps them relative to, so the show plays at once from where the media already
// is. What is not there is reported as missing like any other load's media, and a whole
// folder can be offered for it at once (`findMediaInFolder`).

import { dialog, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { Refusal } from '../ipc/refusal'
import { migrateWorkspace, resolveWorkspaceMedia } from '../workspace/WorkspaceManager'
import { storedMediaPath } from '../workspace/serialise'
import type { AudioCue, Cue } from '../../shared/cue'
import type { MediaReference, MissingMedia } from '../../shared/media'
import type { LoadNote, Workspace } from '../../shared/workspace'
import type {
  QLabFoundMedia,
  QLabImported,
  QLabImportReport,
  QLabLivePayload,
  QLabWorkspaceEntry
} from '../../shared/ipc/qlab'
import { QLAB_EXTENSIONS, readQLabWorkspace } from './qlabFile'
import { listQLabWorkspaces, readLiveWorkspace, type LiveOptions } from './qlabLive'
import { mapQLabShow } from './qlabMap'
import { isDefaultCueLists } from '../../shared/cueLists'
import { listFolder, renamedFile, type ListFolder } from '../workspace/mediaNames'
import type { QLabShow } from './qlabShow'

/** What a show with no name of its own is called once it has come across. */
const IMPORTED_NAME = 'Imported QLab Show'

/** Turns a QLab show into a workspace, checked by the load funnel, and reports on it. */
export function convertQLabShow(show: QLabShow, source: 'file' | 'live', origin: string): QLabImported {
  const mapped = mapQLabShow(show, randomUUID)
  const name = show.name.trim() || IMPORTED_NAME
  const workspace: Workspace = {
    version: 1,
    id: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    // Every QLab list a list here; a show of one list under QLab's default name writes none.
    ...(isDefaultCueLists(mapped.cueLists) ? {} : { cueLists: mapped.cueLists }),
    ...(mapped.oscPatches.length > 0 ? { oscPatches: mapped.oscPatches } : {}),
    cues: mapped.cues
  }
  const loadNotes: LoadNote[] = []
  const checked = migrateWorkspace(workspace, `the QLab import of “${name}”`, loadNotes)
  const resolved = resolveWorkspaceMedia(checked, null)
  const referenced = checked.cues.filter(cue => cue.type === 'audio' && cue.filePath !== '').length

  const report: QLabImportReport = {
    source,
    origin,
    workspaceName: name,
    cueLists: show.lists.length,
    totalCues: mapped.totalCues,
    types: mapped.types,
    notes: mapped.notes,
    media: { referenced, found: referenced - resolved.missingMedia.length }
  }
  return { workspace: resolved.workspace, missingMedia: resolved.missingMedia, loadNotes, report }
}

/** A workspace file, converted. */
export async function importQLabPath(filePath: string): Promise<QLabImported> {
  const show = await readQLabWorkspace(filePath)
  return convertQLabShow(show, 'file', filePath)
}

/** The OS dialog, then the workspace it picked. A cancel is null. */
export async function importQLabFile(win: BrowserWindow): Promise<QLabImported | null> {
  const picked = await dialog.showOpenDialog(win, {
    title: 'Import QLab Workspace',
    buttonLabel: 'Import',
    filters: [
      { name: 'QLab Workspace', extensions: [...QLAB_EXTENSIONS] },
      { name: 'All Files', extensions: ['*'] }
    ],
    // A QLab 5 workspace can be a package, which only a Mac shows as one file.
    properties: ['openFile', 'treatPackageAsDirectory']
  })
  if (picked.canceled || !picked.filePaths[0]) return null
  return importQLabPath(picked.filePaths[0])
}

/**
 * The address the operator typed, held to what a socket can be pointed at. A typo is an
 * ordinary state, so it is a sentence rather than a fault.
 */
export function checkedAddress(host: unknown, port: unknown): { host: string; port: number } {
  const name = typeof host === 'string' ? host.trim() : ''
  if (name === '' || name.length > 253 || /\s/.test(name)) {
    throw new Refusal('type the address of the Mac running QLab, or 127.0.0.1 for this computer')
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Refusal(`${String(port)} is not a port: QLab listens on 53000`)
  }
  return { host: name, port }
}

/** The workspaces a QLab has open. */
export async function listLiveWorkspaces(host: unknown, port: unknown, options?: LiveOptions): Promise<QLabWorkspaceEntry[]> {
  const address = checkedAddress(host, port)
  return listQLabWorkspaces(address.host, address.port, options)
}

/** One workspace of a running QLab, converted. */
export async function importQLabLive(payload: QLabLivePayload, options?: LiveOptions): Promise<QLabImported> {
  const address = checkedAddress(payload?.host, payload?.port)
  if (typeof payload.workspaceId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(payload.workspaceId)) {
    throw new Refusal('pick one of the workspaces QLab has open')
  }
  const passcode = typeof payload.passcode === 'string' && payload.passcode.trim() !== '' ? payload.passcode.trim() : undefined
  const show = await readLiveWorkspace(address.host, address.port, payload.workspaceId, passcode, options)
  return convertQLabShow(show, 'live', `${address.host}:${address.port}`)
}

const isFile = (candidate: string): boolean => statSync(candidate, { throwIfNoEntry: false })?.isFile() === true

/** The most trailing folders of a file's old path tried under a picked folder. */
const MAX_TAIL_SEGMENTS = 6

/**
 * Where a missing file would be under `folder`: the path the show stores it by, when that
 * is relative, and then the end of its old absolute path — the last few folders and the
 * name, then fewer, down to the name alone. Each is one look at one path; nothing is
 * searched for, so two files with the same name in different places are never confused.
 * Where none of them is there exactly, the folder each names is read for the file under the
 * name a cloud drive or a zip tool gave it (`mediaNames.ts`), in the same order.
 */
export function folderCandidates(entry: MissingMedia, folder: string): string[] {
  const candidates: string[] = []
  if (entry.path !== '' && !isAbsolute(entry.path)) candidates.push(join(folder, entry.path))
  const segments = (entry.originalPath || entry.path).split(/[\\/]/).filter(segment => segment !== '')
  for (let take = Math.min(MAX_TAIL_SEGMENTS, segments.length); take >= 1; take--) {
    const candidate = join(folder, ...segments.slice(segments.length - take))
    if (!candidates.includes(candidate)) candidates.push(candidate)
  }
  return candidates
}

/**
 * Points every missing cue at its file under `folder`, where one is there: by its own name
 * first, then by the name it was renamed to on the way. A renamed file two files in one folder
 * could both be is not chosen; the cue stays missing and the answer says which files they were.
 */
export function relinkFromFolder(
  workspace: Workspace,
  workspacePath: string | null,
  folder: string,
  exists: (candidate: string) => boolean = isFile,
  list: ListFolder = listFolder
): QLabFoundMedia {
  const current = resolveWorkspaceMedia(workspace, workspacePath)
  const found = new Map<string, string>()
  const ambiguous: QLabFoundMedia['ambiguous'] = []
  const listings = new Map<string, string[] | null>()
  for (const entry of current.missingMedia) {
    const candidates = folderCandidates(entry, folder)
    const hit = candidates.find(candidate => exists(candidate))
    if (hit !== undefined) {
      found.set(entry.cueId, hit)
      continue
    }
    for (const candidate of candidates) {
      const renamed = renamedFile(candidate, list, listings)
      if (renamed === null) continue
      if ('ambiguous' in renamed) ambiguous.push({ cueId: entry.cueId, candidates: renamed.ambiguous })
      else if (exists(renamed.path)) found.set(entry.cueId, renamed.path)
      else continue
      break
    }
  }
  if (found.size === 0) return { ...current, found: 0, ambiguous }
  const workspaceDir = workspacePath === null ? null : dirname(workspacePath)
  const cues = current.workspace.cues.map((cue): Cue => {
    const relinked = cue.type === 'audio' ? found.get(cue.id) : undefined
    if (relinked === undefined) return cue
    // The same record a single relink writes: the next save writes where the file is now.
    const audio = { ...cue } as AudioCue & Record<string, unknown>
    audio.filePath = relinked
    audio.media = {
      path: workspaceDir === null ? relinked : storedMediaPath(relinked, workspaceDir),
      originalPath: relinked
    } satisfies MediaReference
    return audio
  })
  const after = resolveWorkspaceMedia({ ...current.workspace, cues }, workspacePath)
  return { ...after, found: current.missingMedia.length - after.missingMedia.length, ambiguous }
}

/** Asks for a folder, then relinks every missing file it holds. A cancel is null. */
export async function findMediaInFolder(
  win: BrowserWindow,
  workspace: Workspace,
  workspacePath: string | null
): Promise<QLabFoundMedia | null> {
  const current = resolveWorkspaceMedia(workspace, workspacePath)
  const first = current.missingMedia[0]
  if (first === undefined) return { ...current, found: 0, ambiguous: [] }
  const picked = await dialog.showOpenDialog(win, {
    title: 'Find Missing Audio in a Folder',
    buttonLabel: 'Look Here',
    defaultPath: first.originalPath !== '' && isAbsolute(first.originalPath) ? dirname(first.originalPath) : undefined,
    properties: ['openDirectory']
  })
  if (picked.canceled || !picked.filePaths[0]) return null
  const folder = picked.filePaths[0]
  if (statSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Refusal(`“${basename(folder)}” is not a folder`)
  }
  return relinkFromFolder(workspace, workspacePath, folder)
}
