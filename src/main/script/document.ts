import { readFile, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import { scriptLines } from '../../renderer/src/utils/scriptDocument'
import type { ScriptDocument } from '../../shared/show'

/**
 * A script is a text document a person reads, and the panel renders one element per
 * line. Handing it something else is not a slow page, it is a dead window: a large PDF
 * read as text is a million-line string, and rendering it took the renderer to 3 GB
 * before the interface stopped answering.
 *
 * The limits are deliberately far above any real script — a two-hour libretto is a few
 * hundred kilobytes — so what they actually catch is a document that was never a script.
 */
export const MAX_SCRIPT_BYTES = 1024 * 1024
export const MAX_SCRIPT_LINES = 10_000

/**
 * Whether a file is text at all. A NUL byte is the giveaway: every binary format that
 * might be picked by mistake — a PDF, a Word file, an image, a zip — has one in its
 * first block, and no plain text does.
 */
export function looksBinary(contents: Buffer): boolean {
  return contents.subarray(0, 4096).includes(0)
}

function size(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Reads a script document, or says why it will not. Resolves a relative path against
 * the workspace the same way a script cue's own includes are resolved.
 */
export async function loadScriptDocument(
  filePath: string,
  workspacePath: string | null
): Promise<ScriptDocument> {
  const from = workspacePath !== null ? path.dirname(workspacePath) : process.cwd()
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(from, filePath)
  const name = path.basename(resolved)

  let stats: Stats
  try {
    stats = await stat(resolved)
  } catch (error) {
    return { ok: false, error: `Cannot read ${name}: ${describe(error)}` }
  }

  if (stats.size > MAX_SCRIPT_BYTES) {
    return {
      ok: false,
      error: `${name} is ${size(stats.size)} — the script panel opens documents up to ${size(MAX_SCRIPT_BYTES)}`
    }
  }

  let contents: Buffer
  try {
    contents = await readFile(resolved)
  } catch (error) {
    return { ok: false, error: `Cannot read ${name}: ${describe(error)}` }
  }

  if (looksBinary(contents)) {
    return { ok: false, error: `${name} is not a text file — the script panel shows plain text` }
  }

  const lines = scriptLines(contents.toString('utf-8'))
  if (lines.length > MAX_SCRIPT_LINES) {
    return {
      ok: false,
      error: `${name} has ${lines.length.toLocaleString()} lines — the script panel opens up to ${MAX_SCRIPT_LINES.toLocaleString()}`
    }
  }

  return { ok: true, lines }
}
