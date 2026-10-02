import { rename as fsRename } from 'node:fs/promises'

/**
 * Errors a rename can fail with for a moment and then not. On Windows a rename over a file that
 * someone else has open — an antivirus scan, the indexer, another reader — is refused with one of
 * these until they let go, which is milliseconds. Elsewhere it never happens, which is how it
 * ships: a write that works on the machine it was written on and fails on a show computer.
 */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

export interface ReplaceOptions {
  /** Test seam for the rename itself. */
  rename?: (from: string, to: string) => Promise<void>
  attempts?: number
  delayMs?: number
}

/**
 * Moves a finished temporary file over its destination, trying again if the destination is briefly
 * held. Only the errors above are retried, and only a few times: a rename that cannot be done is
 * the caller's to hear about, and it is told after waiting a moment rather than at the first refusal.
 */
export async function replaceFile(from: string, to: string, options: ReplaceOptions = {}): Promise<void> {
  const rename = options.rename ?? fsRename
  const attempts = options.attempts ?? 8
  const delayMs = options.delayMs ?? 25
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt >= attempts || !TRANSIENT.has(code)) throw error
      await new Promise<void>(resolve => setTimeout(resolve, delayMs * attempt))
    }
  }
}
