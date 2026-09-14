import { app } from 'electron'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import type { Workspace } from '../../renderer/src/types/workspace'

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
}

// Autosave writes here, not over the operator's file: a recovery snapshot is offered
// back on the next launch instead of being applied behind their back.
function recoveryFilePath(): string {
  return join(app.getPath('userData'), 'recovery.wlab')
}

export async function writeRecovery(
  workspace: Workspace,
  sourcePath: string | null,
  selectedCueId: string | null = null
): Promise<void> {
  const filePath = recoveryFilePath()
  const snapshot: RecoverySnapshot = { workspace, savedAt: Date.now(), sourcePath, selectedCueId }
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(snapshot), 'utf-8')
}

export async function readRecovery(): Promise<RecoverySnapshot | null> {
  try {
    const snapshot = JSON.parse(await readFile(recoveryFilePath(), 'utf-8')) as RecoverySnapshot
    return snapshot?.workspace ? snapshot : null
  } catch {
    // No snapshot, or one that was truncated by a dying process: either way there is
    // nothing to offer.
    return null
  }
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
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.tmp`)
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
