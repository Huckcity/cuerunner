// Where a script cue's shell() command runs.
//
// The script host hands over the workspace *file* as the default working directory — it is
// the one path the window has — and a script may name a directory of its own. Telling the
// two apart by whether the path has an extension read every folder with a dot in its name
// ("cues.v2", "Tour 2026.03") as a file, and ran the command in the folder above it. What
// the path is on disk is the answer, and the extension is only the guess for a path that
// is not there to ask.
import { statSync } from 'node:fs'
import * as path from 'node:path'

/** What is at a path: a directory, something else, or nothing. */
export type PathKind = 'directory' | 'file' | 'missing'

function kindOnDisk(target: string): PathKind {
  const stat = statSync(target, { throwIfNoEntry: false })
  if (stat === undefined) return 'missing'
  return stat.isDirectory() ? 'directory' : 'file'
}

/**
 * The directory a command starts in: the one it was given, the one holding the file it was
 * given, or the app's own when it was given nothing. `kindOf` is the disk, injectable so
 * the rule can be read without one.
 */
export function shellWorkingDirectory(
  cwd: string | undefined,
  kindOf: (target: string) => PathKind = kindOnDisk
): string {
  if (!cwd) return process.cwd()
  const kind = kindOf(cwd)
  if (kind === 'directory') return cwd
  if (kind === 'file') return path.dirname(cwd)
  // Nothing there: a path that looks like a file is read as one, as it always was, and the
  // command reports the directory that does not exist in its own words.
  return path.extname(cwd) ? path.dirname(cwd) : cwd
}
