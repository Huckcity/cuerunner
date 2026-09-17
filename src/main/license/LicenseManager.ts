import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { writeFileAtomically } from '../workspace/recovery'
import { canonicalLicense, describeRefusal, licenseExpired, verifyLicense } from './key'
import type { ActivationResult, LicensePayload, LicenseStatus } from '../../shared/license'

/**
 * The key this machine holds, and the only place it is read or written.
 *
 * The license lives in a file of its own beside `recent.json` rather than inside a
 * workspace: it belongs to the machine and its operator, not to the show, and a
 * workspace that travels to another machine must not carry an unlock with it.
 */
export interface LicenseManager {
  status(): LicenseStatus
  /** Verifies and stores a key. A refused key leaves the stored one where it was. */
  activate(text: string): Promise<ActivationResult>
  deactivate(): Promise<LicenseStatus>
  /** Called on every change, so the window and the show services can follow it. */
  subscribe(listener: (status: LicenseStatus) => void): () => void
}

export interface LicenseManagerOptions {
  /** Where the key is kept between runs. */
  filePath: string
  /** Keys a key may be signed with. Held in the build, never written. */
  publicKeys: string[]
  /** Test seam for the clock that decides expiry. */
  now?: () => number
}

/** What a key means right now: signed, and either inside its dates or past them. */
function statusOf(text: string, publicKeys: string[], now: number): LicenseStatus {
  const verified = verifyLicense(text, publicKeys)
  if (!verified.ok) return { state: 'invalid', error: describeRefusal(verified.reason) }
  return licenseExpired(verified.payload, now)
    ? { state: 'expired', license: verified.payload }
    : { state: 'active', license: verified.payload }
}

function expiredMessage(payload: LicensePayload): string {
  return payload.expires === undefined
    ? 'That key is no longer valid.'
    : `That key expired on ${payload.expires}.`
}

export function createLicenseManager(options: LicenseManagerOptions): LicenseManager {
  const now = options.now ?? Date.now
  const listeners = new Set<(status: LicenseStatus) => void>()

  const stored = ((): string | null => {
    try {
      return readFileSync(options.filePath, 'utf-8')
    } catch {
      // Never entered, or unreadable: either way there is no key to act on, and the
      // operator can paste one. A missing file is not an error to report.
      return null
    }
  })()

  let status: LicenseStatus =
    stored === null || stored.trim() === ''
      ? { state: 'unlicensed' }
      : statusOf(stored, options.publicKeys, now())

  function publish(next: LicenseStatus): void {
    status = next
    for (const listener of listeners) listener(next)
  }

  return {
    status: () => status,

    async activate(text: string): Promise<ActivationResult> {
      const canonical = canonicalLicense(text)
      if (canonical === null) {
        return { ok: false, error: describeRefusal('malformed'), status }
      }
      const next = statusOf(canonical, options.publicKeys, now())
      if (next.state === 'invalid') return { ok: false, error: next.error, status }
      if (next.state === 'expired') {
        return { ok: false, error: expiredMessage(next.license), status }
      }
      try {
        await writeFileAtomically(options.filePath, canonical)
      } catch (error) {
        // The key is good but the machine would not keep it: say so rather than
        // unlocking until the next launch and then quietly forgetting.
        const reason = error instanceof Error ? error.message : String(error)
        return { ok: false, error: `The key could not be saved: ${reason}`, status }
      }
      publish(next)
      return { ok: true, status: next }
    },

    async deactivate(): Promise<LicenseStatus> {
      // The `.bak` carries the key that was just removed, so it goes too.
      await rm(options.filePath, { force: true })
      await rm(`${options.filePath}.bak`, { force: true })
      const next: LicenseStatus = { state: 'unlicensed' }
      publish(next)
      return next
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}