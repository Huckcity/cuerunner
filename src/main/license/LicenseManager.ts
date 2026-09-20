import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { writeFileAtomically } from '../workspace/recovery'
import { canonicalLicense, describeRefusal, licenseExpiry, verifyLicense } from './key'
import type { ActivationResult, LicensePayload, LicenseStatus } from '../../shared/license'

/**
 * The key this machine holds, and the only place it is read or written.
 *
 * The license lives in a file of its own beside `recent.json` rather than inside a
 * workspace: it belongs to the machine and its operator, not to the show, and a
 * workspace that travels to another machine must not carry an unlock with it.
 */
export interface LicenseManager {
  /**
   * What the key is worth right now, read off the clock rather than remembered from
   * startup: a key that runs out with the app open stops unlocking the moment it does. A
   * read that finds the answer changed publishes it, so a lapse the clock has crossed
   * reaches the window and the services even when nobody asks.
   */
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

/**
 * What the stored key comes to, verified: the half of the answer that does not depend on
 * the clock — a key, a refusal, or nothing at all. Verification says nothing about dates
 * by design, so this is decided once and the clock's half is read off it on every ask.
 */
type Reading =
  | { kind: 'none' }
  | { kind: 'refused'; status: LicenseStatus }
  | { kind: 'key'; expiry: number | null; active: LicenseStatus; expired: LicenseStatus }

/** The one unlicensed status, frozen and shared, so "unchanged" can be told by identity. */
const UNLICENSED: LicenseStatus = Object.freeze({ state: 'unlicensed' })

/**
 * Node refuses a delay longer than this and fires the timer at once. A ninety-day key is
 * 7.8e9 ms away, so a wait armed without the cap would come back immediately, for ever.
 */
const MAX_DELAY_MS = 2_147_483_647

function readingOf(text: string, publicKeys: string[]): Reading {
  const verified = verifyLicense(text, publicKeys)
  if (!verified.ok) {
    return { kind: 'refused', status: { state: 'invalid', error: describeRefusal(verified.reason) } }
  }
  const license = verified.payload
  // Both answers are built here, once, and are then handed out as they are: a read is a
  // comparison and a reference rather than an allocation, and a key that is still good is
  // the same object every time, which is the whole of how "unchanged" is told. Frozen,
  // because a reader that wrote to one of these would silence every later publish —
  // including the lapse.
  return {
    kind: 'key',
    expiry: licenseExpiry(license),
    active: Object.freeze({ state: 'active', license }),
    expired: Object.freeze({ state: 'expired', license })
  }
}

/**
 * What the reading means at `now`. The instant is the one `licenseExpiry` computes and
 * the comparison is strictly past it: a key is good for the whole of its last day in UTC,
 * so a show that opens on the day it runs out is not stopped mid-performance.
 */
function statusOf(reading: Reading, now: number): LicenseStatus {
  switch (reading.kind) {
    case 'none':
      return UNLICENSED
    case 'refused':
      return reading.status
    case 'key':
      return reading.expiry !== null && now > reading.expiry ? reading.expired : reading.active
  }
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

  let reading: Reading =
    stored === null || stored.trim() === ''
      ? { kind: 'none' }
      : readingOf(stored, options.publicKeys)
  let status: LicenseStatus = statusOf(reading, now())

  function publish(next: LicenseStatus): void {
    status = next
    // The wait follows the answer. Whoever changes what the key means — the clock here, an
    // activation, a removal — leaves the schedule pointed at the boundary that answer has
    // next, so a clock that stepped back inside the dates is waited for a second time
    // rather than only noticed on the next ask.
    schedule()
    for (const listener of listeners) listener(next)
  }

  /**
   * The answer for right now, published when the clock has changed it. This is the only
   * path that publishes with no operator action — `activate` and `deactivate` publish
   * because they were asked to — and it is how a lapse reaches the window and the
   * services: the path deactivation already takes, arrived at by waiting.
   */
  function currentStatus(): LicenseStatus {
    const next = statusOf(reading, now())
    if (next !== status) publish(next)
    return next
  }

  let timer: NodeJS.Timeout | null = null

  /**
   * Waits for the instant the key ends, so the boundary is crossed whether or not anyone
   * asks. A store with no key, and a key with no expiry, have no instant to wait for.
   */
  function schedule(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (reading.kind !== 'key' || reading.expiry === null) return
    const remaining = reading.expiry + 1 - now()
    // Past it already: a read says so, and there is nothing left to wait for.
    if (remaining <= 0) return
    timer = setTimeout(fire, Math.min(remaining, MAX_DELAY_MS))
    // A license must never be the thing that keeps the app alive on quit.
    timer.unref?.()
  }

  /**
   * The boundary — or as much of the wait as a timer can carry. It derives through the
   * same read as everyone else, so one that came back early (the cap above, or a clock
   * that moved backwards) is still `active`, publishes nothing, and waits again.
   */
  function fire(): void {
    timer = null
    if (currentStatus().state === 'active') schedule()
  }

  schedule()

  return {
    status: currentStatus,

    async activate(text: string): Promise<ActivationResult> {
      const canonical = canonicalLicense(text)
      if (canonical === null) {
        return { ok: false, error: describeRefusal('malformed'), status: currentStatus() }
      }
      const candidate = readingOf(canonical, options.publicKeys)
      const next = statusOf(candidate, now())
      if (next.state === 'invalid') return { ok: false, error: next.error, status: currentStatus() }
      if (next.state === 'expired') {
        return { ok: false, error: expiredMessage(next.license), status: currentStatus() }
      }
      try {
        await writeFileAtomically(options.filePath, canonical)
      } catch (error) {
        // The key is good but the machine would not keep it: say so rather than
        // unlocking until the next launch and then quietly forgetting.
        const reason = error instanceof Error ? error.message : String(error)
        return { ok: false, error: `The key could not be saved: ${reason}`, status: currentStatus() }
      }
      // Every answer this function gives comes off the derived read, this one included:
      // it is taken after the write rather than computed before it, so a key whose instant
      // the clock crossed while the file was being written is reported as expired here
      // instead of as an unlock that no later read agrees with.
      reading = candidate
      const accepted = currentStatus()
      return { ok: true, status: accepted }
    },

    async deactivate(): Promise<LicenseStatus> {
      // The `.bak` carries the key that was just removed, so it goes too.
      await rm(options.filePath, { force: true })
      await rm(`${options.filePath}.bak`, { force: true })
      reading = { kind: 'none' }
      // The same object a read answers with, so a later read must not take the removal for
      // a second change; `publish` finds no instant left and clears the wait.
      publish(UNLICENSED)
      return UNLICENSED
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
