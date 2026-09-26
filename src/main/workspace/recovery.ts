import { app } from 'electron'
import { randomUUID } from 'crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { isRefusal, Refusal } from '../ipc/refusal'
import { hasCueList, type Workspace } from '../../shared/workspace'
import type { FileFingerprint } from './WorkspaceManager'

/** The largest snapshot this app reads back: the same ceiling a workspace file gets. */
const MAX_RECOVERY_BYTES = 64 * 1024 * 1024

export interface RecoverySnapshot {
  workspace: Workspace
  /** When the snapshot was taken, ms since epoch. */
  savedAt: number
  /** Path of the workspace it belongs to, or null if it was never saved. */
  sourcePath: string | null
  /**
   * The cue the session was standing on, which is the one GO would have fired next.
   * Absent from snapshots written before it was recorded, and null when nothing was
   * selected: a recovered show hands the operator back their place, not just their cues.
   */
  selectedCueId?: string | null
  /**
   * The identity of `sourcePath` as main last read or wrote it. Main already holds it when
   * autosave runs, so recording it costs no read — and it is the only thing that can say
   * the file changed while the app was dead, which is exactly what a session that is gone
   * cannot know. Absent from snapshots written before it was recorded.
   */
  sourceFingerprint?: FileFingerprint
}

// Autosave writes here, not over the operator's file: a recovery snapshot is offered
// back on the next launch instead of being applied behind their back.
//
// Exported because it is also the source a refusal about the snapshot names: the funnel
// that reads one back is in `WorkspaceManager`, and this is the only place that knows
// which file the snapshot came from.
export function recoveryFilePath(): string {
  return join(app.getPath('userData'), 'recovery.cuerunner')
}

export async function writeRecovery(
  workspace: Workspace,
  sourcePath: string | null,
  selectedCueId: string | null = null,
  sourceFingerprint: FileFingerprint | null = null
): Promise<void> {
  const filePath = recoveryFilePath()
  const snapshot: RecoverySnapshot = {
    workspace,
    savedAt: Date.now(),
    sourcePath,
    selectedCueId,
    ...(sourceFingerprint === null ? {} : { sourceFingerprint })
  }
  await mkdir(dirname(filePath), { recursive: true })
  // A death mid-write must not cost the previous good snapshot too: same atomic path
  // as every other write in this module.
  await writeFileAtomically(filePath, JSON.stringify(snapshot))
}

/** Whether a value is the file identity a snapshot records: a byte length and a hash. */
function isFingerprint(value: unknown): value is FileFingerprint {
  if (typeof value !== 'object' || value === null) return false
  const carried = value as Record<string, unknown>
  return typeof carried.size === 'number' && typeof carried.hash === 'string'
}

/**
 * Refuses a snapshot whose own fields are not the kinds the type writes. The workspace is
 * checked before this; the fields beside it are read as their types by the window and by
 * main — a `sourcePath` of another kind reaches `dirname` — so a file an operator's tools
 * have been through, carrying `sourcePath: 3`, would answer the channel with a stack where
 * it declares a bar naming the file. Each field is held to the kind it is written as, and
 * the optional two are allowed to be absent as their types say.
 */
function refuseForeignSnapshotFields(snapshot: RecoverySnapshot, filePath: string): void {
  const carried = snapshot as unknown as Record<string, unknown>
  const refuse = (field: string): never => {
    const value = carried[field]
    const kind = value === null || value === undefined
      ? 'nothing'
      : Array.isArray(value)
        ? 'a list'
        : typeof value === 'object'
          ? 'an object'
          : `a ${typeof value}`
    throw new Refusal(
      `that file is not a show — ${filePath} holds a snapshot whose ${field} is ${kind}`
    )
  }
  if (typeof carried.savedAt !== 'number') refuse('savedAt')
  // A path is a string, or nothing: `null` is a snapshot of a show that was never saved.
  if (carried.sourcePath !== null && typeof carried.sourcePath !== 'string') refuse('sourcePath')
  if (
    carried.selectedCueId !== undefined &&
    carried.selectedCueId !== null &&
    typeof carried.selectedCueId !== 'string'
  ) {
    refuse('selectedCueId')
  }
  if (carried.sourceFingerprint !== undefined && !isFingerprint(carried.sourceFingerprint)) {
    refuse('sourceFingerprint')
  }
}

export async function readRecovery(): Promise<RecoverySnapshot | null> {
  const filePath = recoveryFilePath()
  let text: string
  try {
    const { size } = await stat(filePath)
    // Past the cap the app's other load paths use, the file is not read into main's memory
    // on the strength of a filename — and it is said rather than dropped, for the same
    // reason a snapshot that will not parse is.
    if (size > MAX_RECOVERY_BYTES) {
      throw new Refusal(`that snapshot file is larger than this app will open — ${filePath}`)
    }
    text = await readFile(filePath, 'utf-8')
  } catch (error) {
    // A refusal raised above is already the answer.
    if (isRefusal(error)) throw error
    // Absence alone is the ordinary "nothing to offer": a process that died before the
    // first autosave leaves no snapshot at all. A snapshot that is there and cannot be read
    // — a path that is a directory, a file this process has no permission for, a disk that
    // failed — is work that cannot be brought forward, and the operator is owed the
    // sentence rather than the same silence an absent snapshot gives.
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw new Refusal(`that file is not a show — ${filePath} could not be read (${code ?? 'unreadable'})`)
  }
  // The bytes are there; now they have to be a snapshot. A file an operator's own tools
  // have been through can parse and hold something else entirely, and a workspace with no
  // cue list would take the funnel down inside the channel, where a fault renders no
  // bar at all — so the parse, the workspace's shape and the snapshot's own fields are all
  // checked before the value is returned.
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Refusal(`that file is not a show — ${filePath} is not JSON`)
  }
  // A snapshot whose show is not a show this build can walk is nothing to offer either,
  // and saying so is the difference between a bar and a thrown TypeError with no bar. The
  // shape check is the one the two load funnels share, so a document that is a show for
  // one of them is a show for all three.
  const workspace: unknown = (parsed as RecoverySnapshot | null)?.workspace
  if (!hasCueList(workspace)) {
    throw new Refusal(`that file is not a show — ${filePath} holds no snapshot to bring back`)
  }
  const snapshot = parsed as RecoverySnapshot
  refuseForeignSnapshotFields(snapshot, filePath)
  return snapshot
}

export async function clearRecovery(): Promise<void> {
  await rm(recoveryFilePath(), { force: true })
}

/**
 * Replaces `filePath` with `contents` without ever leaving it half-written: the
 * contents land in a temporary file first and the replace is a rename, which is atomic
 * on one filesystem. The previous version is kept as `<name>.bak` so a save that goes
 * wrong still leaves the operator a file to open.
 */
export async function writeFileAtomically(filePath: string, contents: string): Promise<void> {
  // The temp is named for this write, not for the path: two saves of one file can be in
  // the air together — a Ctrl+S and a close-prompt save — and a shared temp would have
  // both of them writing at their own offsets into the same file.
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
  await writeFile(tempPath, contents, 'utf-8')
  try {
    // Keep the previous version aside before replacing it. copyFile leaves the
    // original where it is, so a failure at any point below still leaves the operator
    // a file to open.
    await copyFile(filePath, `${filePath}.bak`).catch(() => {
      // Nothing to back up on a first save.
    })
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}
