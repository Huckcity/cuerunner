// A show and its media as one file.
//
// A show is a workspace plus a folder of audio, and the two travel together badly: send
// the .cuerunner and the other end gets a cue list full of files it does not have. Hand over a
// folder and there is always one file left behind — the walk-in that lives on the
// desktop, the sting somebody dropped in from a render folder. A bundle is the answer:
// one artifact, the showfile and every file it plays, which is also the artifact that
// arrives intact after being emailed, copied to a stick, or handed to a venue's IT desk.
//
// Inside it the layout is fixed, and the showfile is written with its media pointing at
// it, so unpacking the bundle anywhere gives a show that plays:
//
//     show.cuerunner        the show, with its media paths relative to the bundle root
//     media/<name>     one entry per distinct file the show plays, in name order
//
// The bytes are a function of the show and of nothing else — the same entries in the same
// order, with the fixed timestamps `zip.ts` writes — so two bundles of one show are the
// same file, and a bundle can be hashed or kept beside the show it came from.

import { dialog, BrowserWindow } from 'electron'
import { mkdir, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'path'
import type { ZipEntry, ZipSource } from './zip'
import { extractZipEntry, readZip, readZipEntry, writeZip } from './zip'
import { asRefusal, Refusal } from '../ipc/refusal'
import { migrateWorkspace, resolveWorkspaceMedia, serialiseWorkspace } from './WorkspaceManager'
import type { MediaReference, MissingMedia } from '../../shared/media'
import type { AudioCue } from '../../shared/cue'
import type { LoadNote, Workspace } from '../../shared/workspace'

export const BUNDLE_EXTENSION = 'cuerunnerx'

/** The showfile inside a bundle. Fixed, so a reader knows what it is looking for. */
const SHOW_ENTRY = 'show.cuerunner'

/** Where a bundle's media goes, and what the showfile inside it points at. */
const MEDIA_DIR = 'media'

/**
 * The largest showfile a bundle may carry: 64 MiB of JSON is already far past a
 * readable show, and the entry is inflated whole into main-process memory.
 */
const MAX_BUNDLE_SHOW_BYTES = 64 * 1024 * 1024
export interface ExportedBundle {
  path: string
  /** Files the show names that were not on this machine to be bundled. */
  missing: string[]
}

export interface ImportedBundle {
  path: string
  workspace: Workspace
  missingMedia: MissingMedia[]
  /** Grouping repairs the showfile inside the bundle needed, same as any other load. */
  loadNotes: LoadNote[]
}

/**
 * Raised when a bundle would be unpacked over files that are already there. It is an
 * ordinary state of the folder the operator picked, so it is a refusal: the import
 * channel answers its sentence as a value, while the class still carries the colliding
 * files for the callers in this process that read them.
 */
export class BundleCollision extends Refusal {
  constructor(readonly files: string[]) {
    super(`${files.length} ${files.length === 1 ? 'file is' : 'files are'} already there`)
    this.name = 'BundleCollision'
  }
}

/** A name a file may be given inside the bundle, on any machine that opens it. */
function portable(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  return cleaned === '' ? 'Untitled' : cleaned.slice(0, 80)
}

/** The file a bundle is unpacked as: the show's own name, made safe for a folder. */
export function bundleFileName(showName: string): string {
  return `${portable(showName)}.cuerunner`
}

/** One media file as the bundle holds it: the entry it was given, and where it came from. */
interface Entry {
  name: string
  source: string
}

interface Gathering {
  /** The entry each cue's file was given. */
  byCue: Map<string, Entry>
  /** What the show names but this machine does not have. */
  missing: string[]
}

async function isThere(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Which of the show's files go into the bundle, and what each is called inside it.
 *
 * Two cues that play the same file share one entry — a show that plays its walk-in
 * before and after the interval should not carry it twice — and two different files that
 * happen to share a name get `-2`, `-3`, so nothing is quietly overwritten. A file the
 * machine does not have is left out and reported: a bundle missing one cue's audio is
 * worth having, and the operator is the one who knows where that file went.
 */
async function gatherMedia(workspace: Workspace, workspacePath: string | null): Promise<Gathering> {
  const byCue = new Map<string, Entry>()
  const taken = new Map<string, string>()
  // One file, one entry. On Windows two spellings of the same path are the same file, so
  // the key is folded there — the same rule the relink planner uses, and the same reason:
  // otherwise a show would carry the same audio twice under two names.
  const key = (path: string): string => (process.platform === 'win32' ? path.toLowerCase() : path)
  const missing: string[] = []
  const folder = workspacePath === null ? null : dirname(workspacePath)

  for (const cue of workspace.cues) {
    if (cue.type !== 'audio') continue
    const audio = cue as AudioCue
    if (audio.filePath === '') continue
    const source = isAbsolute(audio.filePath)
      ? audio.filePath
      : folder === null ? null : resolve(folder, audio.filePath)
    if (source === null || !(await isThere(source))) {
      missing.push(source ?? audio.filePath)
      continue
    }
    const known = taken.get(key(source))
    if (known !== undefined) {
      byCue.set(cue.id, { name: known, source })
      continue
    }
    const name = uniqueName(audio.filePath, taken)
    taken.set(key(source), name)
    byCue.set(cue.id, { name, source })
  }

  return { byCue, missing }
}

/** `media/walk-in.wav`, then `media/walk-in-2.wav` when that name is spoken for. */
function uniqueName(path: string, taken: Map<string, string>): string {
  // Compared folded, because the bundle is unpacked onto the filesystem that will hold
  // it and Windows and macOS do not tell two names differing only in case apart: two
  // entries that are one file extract over each other, and a cue ends up playing the
  // other one's audio.
  const used = new Set([...taken.values()].map(name => name.toLowerCase()))
  const stem = portable(basename(path, extname(path)))
  const extension = extname(path)
  for (let attempt = 1; ; attempt++) {
    const candidate = `${MEDIA_DIR}/${attempt === 1 ? stem : `${stem}-${attempt}`}${extension}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

/** What the bundle records about each cue's file: its entry, and where the file came from. */
function references(gathered: Gathering): Map<string, MediaReference> {
  const found = new Map<string, MediaReference>()
  for (const [cueId, entry] of gathered.byCue) {
    found.set(cueId, { path: entry.name, originalPath: entry.source })
  }
  return found
}

/**
 * Writes a show and its media to one file.
 */
export async function writeBundle(
  workspace: Workspace,
  workspacePath: string | null,
  bundlePath: string
): Promise<ExportedBundle> {
  const gathered = await gatherMedia(workspace, workspacePath)
  const cues = workspace.cues.map(cue => {
    const entry = gathered.byCue.get(cue.id)
    return entry ? { ...cue, filePath: entry.name } : cue
  })
  const media = new Map<string, string>()
  for (const entry of gathered.byCue.values()) media.set(entry.name, entry.source)

  const sources: ZipSource[] = [
    {
      name: SHOW_ENTRY,
      data: Buffer.from(
        serialiseWorkspace({ ...workspace, cues }, dirname(bundlePath), references(gathered)),
        'utf8'
      )
    },
    ...[...media]
      .map(([name, source]) => ({ name, source }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(entry => ({ name: entry.name, file: entry.source }))
  ]
  await writeZip(bundlePath, sources)
  return { path: bundlePath, missing: gathered.missing }
}

/** What a bundle holds, read without writing anything anywhere. */
export interface ReadBundle {
  workspace: Workspace
  /** The showfile's own bytes, which are what unpacking writes back out. */
  show: Buffer
  /** The media files it carries. */
  media: ZipEntry[]
  /**
   * Grouping repairs the showfile needed, carried only so `unpackBundle` can return them
   * on the imported workspace; nothing else reads them.
   */
  loadNotes: LoadNote[]
}

export async function readBundle(bundlePath: string): Promise<ReadBundle> {
  const entries = await readZip(bundlePath)
  const show = entries.find(entry => entry.name === SHOW_ENTRY)
  if (!show) throw new Refusal('that file is not a Cuerunner bundle: it carries no show')
  // The showfile is read whole into memory: refuse an absurd declared size before
  // the allocation, and cap the inflated bytes — a small deflated entry with a huge
  // output would otherwise OOM main before the size check runs.
  if (show.size > MAX_BUNDLE_SHOW_BYTES) {
    throw new Refusal('that bundle’s show is larger than this app will read')
  }
  const bytes = await readZipEntry(bundlePath, show, MAX_BUNDLE_SHOW_BYTES)
  // A show the bundle carries but cannot parse is a damaged bundle — the same ordinary
  // state as the archive checks above, so it refuses the same way.
  let parsed: Workspace
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as Workspace
  } catch (error) {
    throw asRefusal(error)
  }
  // Import is a load path too: the showfile inside the bundle goes through the same
  // migration, and the repair it makes must reach the window like any other load's.
  const loadNotes: LoadNote[] = []
  return {
    workspace: migrateWorkspace(parsed, loadNotes),
    show: bytes,
    media: entries.filter(entry => entry.name.startsWith(`${MEDIA_DIR}/`)),
    loadNotes
  }
}

/** Where a bundle would be written, and what is already there. */
export async function bundleTargets(
  bundle: ReadBundle,
  folderPath: string
): Promise<{ show: string; files: string[]; existing: string[] }> {
  const show = join(folderPath, bundleFileName(bundle.workspace.name))
  const files = bundle.media.map(entry => join(folderPath, entry.name))
  const existing: string[] = []
  for (const path of [show, ...files]) {
    if (await isThere(path)) existing.push(path)
  }
  return { show, files, existing }
}

/**
 * Unpacks a bundle into a folder: the show under its own name, and its media underneath
 * it, in the layout the showfile already points at. Anything already there is a collision
 * rather than something to overwrite, unless the operator has said otherwise.
 */
export async function unpackBundle(
  bundlePath: string,
  folderPath: string,
  bundle: ReadBundle,
  options: { overwrite?: boolean } = {}
): Promise<ImportedBundle> {
  const targets = await bundleTargets(bundle, folderPath)
  if (targets.existing.length > 0 && options.overwrite !== true) {
    throw new BundleCollision(targets.existing)
  }
  for (const entry of bundle.media) {
    await extractZipEntry(bundlePath, entry, folderPath)
  }
  await mkdir(dirname(targets.show), { recursive: true })
  // The showfile is written exactly as the bundle carries it: the paths inside it are
  // relative to the bundle's root, which is the folder it has just been unpacked into.
  await writeFile(targets.show, bundle.show)
  return {
    path: targets.show,
    ...resolveWorkspaceMedia(bundle.workspace, targets.show),
    loadNotes: bundle.loadNotes
  }
}

/**
 * Export: a show and its media as one file the operator names. The bundle is written
 * where they say, and nothing is copied anywhere else.
 */
export async function exportBundle(
  win: BrowserWindow,
  workspace: Workspace,
  workspacePath: string | null
): Promise<ExportedBundle | null> {
  const result = await dialog.showSaveDialog(win, {
    title: 'Export Bundle',
    defaultPath: `${portable(workspace.name)}.${BUNDLE_EXTENSION}`,
    filters: [{ name: 'Cuerunner Bundle', extensions: [BUNDLE_EXTENSION] }]
  })
  if (result.canceled || !result.filePath) return null
  return writeBundle(workspace, workspacePath, result.filePath)
}

/**
 * Import: a bundle in, a show folder out. Two questions — which bundle, and where the
 * show should live — and a third only when the answer to the second names a folder that
 * already holds files by those names.
 */
export async function importBundle(win: BrowserWindow): Promise<ImportedBundle | null> {
  const picked = await dialog.showOpenDialog(win, {
    title: 'Open Bundle',
    filters: [{ name: 'Cuerunner Bundle', extensions: [BUNDLE_EXTENSION] }],
    properties: ['openFile']
  })
  if (picked.canceled || !picked.filePaths[0]) return null
  const bundlePath = picked.filePaths[0]
  const bundle = await readBundle(bundlePath)

  const folder = await dialog.showOpenDialog(win, {
    title: `Where to unpack “${bundle.workspace.name}”`,
    buttonLabel: 'Unpack Here',
    properties: ['openDirectory', 'createDirectory']
  })
  if (folder.canceled || !folder.filePaths[0]) return null
  const folderPath = folder.filePaths[0]

  const targets = await bundleTargets(bundle, folderPath)
  if (targets.existing.length > 0) {
    const answer = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'That folder already holds files by these names',
      detail: `${targets.existing.length} of the files this bundle carries would replace a file `
        + `that is already in the folder, starting with “${basename(targets.existing[0])}”.`
    })
    if (answer.response !== 0) return null
  }

  return unpackBundle(bundlePath, folderPath, bundle, {
    overwrite: targets.existing.length > 0
  })
}
