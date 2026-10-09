// The session log, on disk. The window's Log tab holds the last 500 lines and goes with the
// window; a show that went wrong last night is read the next morning, after a restart, and
// sometimes after the window that held the log has crashed. So every line the log takes is
// also written here, beside the failures main reported itself.
//
// One file, `cuerunner.log`, in the app's own logs folder, and one previous file beside it:
// when the current one passes its ceiling it becomes `cuerunner.1.log` and a new one starts,
// so the folder never holds more than twice the ceiling. Every write is bounded — a line, a
// batch — because the input comes over IPC and a window that misbehaves must not be able to
// fill a disk through it.

import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** The ceiling one log file grows to before it is rolled. */
export const LOG_FILE_MAX_BYTES = 5 * 1024 * 1024

/** The longest line written; the window's own log caps a message at the same length. */
export const LOG_LINE_LIMIT = 4000

/** The most lines one write takes: a burst past this is the window misbehaving, not a show. */
export const LOG_BATCH_LIMIT = 500

export const LOG_FILE_NAME = 'cuerunner.log'
export const LOG_FILE_PREVIOUS = 'cuerunner.1.log'

/** One line as the file holds it: no line breaks inside it, and no longer than the limit. */
export function boundLine(line: string): string {
  const flat = line.replace(/\r?\n/g, ' ⏎ ')
  return flat.length > LOG_LINE_LIMIT ? `${flat.slice(0, LOG_LINE_LIMIT)}…` : flat
}

/** Whether a payload from the window is a list of lines this file will take. */
export function isLogBatch(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= LOG_BATCH_LIMIT && value.every(line => typeof line === 'string')
}

export class SessionLogFile {
  /** Writes in the order they were asked for: a roll between two appends must not split one. */
  private queue: Promise<void> = Promise.resolve()

  constructor(
    readonly dir: string,
    private readonly maxBytes: number = LOG_FILE_MAX_BYTES,
    private readonly now: () => Date = () => new Date()
  ) {}

  get path(): string {
    return join(this.dir, LOG_FILE_NAME)
  }

  /**
   * Appends lines, each stamped with the moment it was written. Never rejects: a log that
   * cannot be written is a log, and the show it describes goes on — the caller is the
   * failure path itself, and a failure of the failure path has nowhere better to go.
   */
  append(lines: readonly string[]): Promise<void> {
    if (lines.length === 0) return this.queue
    const stamp = this.now().toISOString()
    const text = lines.slice(0, LOG_BATCH_LIMIT).map(line => `${stamp} ${boundLine(line)}\n`).join('')
    this.queue = this.queue.then(() => this.write(text)).catch(() => {})
    return this.queue
  }

  private async write(text: string): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const size = await stat(this.path).then(info => info.size, () => 0)
    if (size > 0 && size + Buffer.byteLength(text) > this.maxBytes) {
      await rename(this.path, join(this.dir, LOG_FILE_PREVIOUS))
    }
    await appendFile(this.path, text, 'utf-8')
  }
}
