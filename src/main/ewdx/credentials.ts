import { readFileSync } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * What this machine knows about the receivers it has been told about: the password a
 * receiver was given in WSM, and the certificate it was first seen presenting.
 *
 * It is a file of its own beside `license.key`, never the workspace, for the same reason
 * the redundancy pair's settings are: the showfile is emailed, copied to the second machine
 * and kept in version control, and a receiver's password has no business travelling with
 * it. Entries are keyed by the telemetry source's id, so the show says *which* receiver
 * and the machine says *how to get in*.
 */
export interface SourceCredentials {
  password: string
  /** SHA-256 fingerprint of the certificate trusted for this receiver, once one has been seen. */
  fingerprint?: string
}

/** Turns a password into what is written to disk and back. Electron's `safeStorage` in the app. */
export interface Cipher {
  available(): boolean
  encrypt(text: string): string
  decrypt(text: string): string
}

/**
 * The platform's keychain would not keep a password: it is locked, or there is none to ask.
 * An ordinary state of a machine rather than a bug, so it has a class of its own for the
 * channel to say as a sentence — and the password is not written down in the clear to get
 * round it, which would turn a refusal into a leak.
 */
export class KeychainRefusedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'KeychainRefusedError'
  }
}

export interface EwDxCredentials {
  get(sourceId: string): SourceCredentials | undefined
  setPassword(sourceId: string, password: string): Promise<void>
  /** Trust this certificate for this receiver, replacing whichever was trusted before. */
  pin(sourceId: string, fingerprint: string): Promise<void>
  /** Forget the trusted certificate, so the next connection trusts whatever it is shown. */
  unpin(sourceId: string): Promise<void>
  forget(sourceId: string): Promise<void>
  /** False when the platform has nowhere safe to put a password and it is on disk as written. */
  encrypted(): boolean
}

export interface EwDxCredentialsOptions {
  filePath: string
  cipher: Cipher
  /** Test seam for a file that is not there or not readable. */
  readFile?: (path: string) => string
}

interface StoredEntry {
  password: string
  /** Whether `password` went through the cipher. Recorded per entry: the platform can change. */
  encrypted: boolean
  fingerprint?: string
}

interface StoredFile {
  version: 1
  sources: Record<string, StoredEntry>
}

function isEntry(value: unknown): value is StoredEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.password === 'string' &&
    typeof entry.encrypted === 'boolean' &&
    (entry.fingerprint === undefined || typeof entry.fingerprint === 'string')
  )
}

export function createEwDxCredentials(options: EwDxCredentialsOptions): EwDxCredentials {
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))

  const sources = ((): Map<string, StoredEntry> => {
    const entries = new Map<string, StoredEntry>()
    try {
      const parsed: unknown = JSON.parse(read(options.filePath))
      const carried = (parsed as { sources?: unknown } | null)?.sources
      if (typeof carried !== 'object' || carried === null) return entries
      for (const [id, entry] of Object.entries(carried)) if (isEntry(entry)) entries.set(id, entry)
    } catch {
      // Missing, unreadable or corrupt: a show must still open. No receiver has a
      // password yet, which the source says out loud rather than the app failing to start.
    }
    return entries
  })()

  // Writes go one at a time, in order: two pins arriving together must not leave the
  // older one on disk.
  let writing: Promise<void> = Promise.resolve()
  const persist = (): Promise<void> => {
    const file: StoredFile = { version: 1, sources: Object.fromEntries(sources) }
    const next = writing.then(() => writePrivately(options.filePath, JSON.stringify(file, null, 2)))
    writing = next.catch(() => undefined)
    return next
  }

  return {
    get(sourceId) {
      const entry = sources.get(sourceId)
      if (!entry) return undefined
      let password = entry.password
      if (entry.encrypted) {
        try {
          password = options.cipher.decrypt(entry.password)
        } catch {
          // Written by another user or another machine's keychain: it is not readable
          // here, and a password that cannot be read is a password nobody has set.
          return undefined
        }
      }
      return { password, ...(entry.fingerprint === undefined ? {} : { fingerprint: entry.fingerprint }) }
    },

    async setPassword(sourceId, password) {
      const encrypted = options.cipher.available()
      let stored = password
      if (encrypted) {
        try {
          stored = options.cipher.encrypt(password)
        } catch (error) {
          // Nothing has been changed yet: the old password, if there was one, still stands.
          throw new KeychainRefusedError(error instanceof Error ? error.message : String(error))
        }
      }
      const previous = sources.get(sourceId)
      sources.set(sourceId, {
        password: stored,
        encrypted,
        // A new password may belong to a replaced receiver, but the pin is about the
        // certificate and not the password; changing one does not forget the other.
        ...(previous?.fingerprint === undefined ? {} : { fingerprint: previous.fingerprint })
      })
      await persist()
    },

    async pin(sourceId, fingerprint) {
      const entry = sources.get(sourceId)
      // A certificate with no password is not a receiver this machine has been given.
      if (!entry) return
      sources.set(sourceId, { ...entry, fingerprint })
      await persist()
    },

    async unpin(sourceId) {
      const entry = sources.get(sourceId)
      if (!entry?.fingerprint) return
      const { fingerprint: _forgotten, ...rest } = entry
      sources.set(sourceId, rest)
      await persist()
    },

    async forget(sourceId) {
      if (sources.delete(sourceId)) await persist()
    },

    encrypted: () => options.cipher.available()
  }
}

/**
 * Owner-only, and no backup copy: the atomic write the workspace uses keeps the previous
 * version beside the file, which for a file of passwords is exactly the copy nobody meant to leave.
 */
async function writePrivately(filePath: string, contents: string): Promise<void> {
  const temp = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
  await writeFile(temp, contents, { encoding: 'utf-8', mode: 0o600 })
  try {
    await rename(temp, filePath)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}
