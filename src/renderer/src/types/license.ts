/**
 * A key is a signed statement, not a secret: it says who bought WinsLab Pro and when
 * it runs out, and it is verified against a public key built into the app. Nothing is
 * called home — a show machine that has never seen the internet unlocks the same as
 * any other, and a key that was issued while the venue was dark keeps working in it.
 *
 * The field names below are the wire format as well as the parsed shape: the bytes
 * that were signed are the bytes that are stored, and nothing re-serialises them.
 */
export interface LicensePayload {
  /** Format version. A key from a newer app is refused rather than misread. */
  v: 1
  /** Short id, quoted on the invoice so a key can be traced back to a sale. */
  id: string
  /** Who the key was issued to. Shown in Settings. */
  licensee: string
  /** Issue date, YYYY-MM-DD. */
  issued: string
  /** Last day the key works, YYYY-MM-DD. Absent means it does not expire. */
  expires?: string
}

/**
 * What the app knows about the key it has. `active` is the only state that unlocks
 * anything: a missing, refused or expired key leaves the free feature set in place.
 */
export type LicenseStatus =
  | { state: 'unlicensed' }
  | { state: 'active'; license: LicensePayload }
  | { state: 'expired'; license: LicensePayload }
  | { state: 'invalid'; error: string }

/** Result of pasting a key into Settings. */
export interface ActivationResult {
  ok: boolean
  /** Why the key was refused, for the operator to read. */
  error?: string
  /** The status after the attempt: unchanged when the key was refused. */
  status: LicenseStatus
}

export function isPro(status: LicenseStatus): boolean {
  return status.state === 'active'
}