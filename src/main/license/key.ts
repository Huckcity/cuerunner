import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import type { LicensePayload } from '../../renderer/src/types/license'

/**
 * Licence keys are signed offline and verified against a public key built into the app.
 *
 * The text is `WSL1-` followed by base32 of the payload, a NUL, and the Ed25519
 * signature over those payload bytes. Base32 rather than base64 because a key is
 * pasted out of an email and typed back in by a human when the email is not to hand:
 * it is case-insensitive, has no characters that look like each other, and the dashes
 * every eight characters are for reading, not for parsing.
 *
 * Verification never re-serialises the payload. What was signed is what is stored, so
 * a key minted by an older or newer tool reads the same here.
 */

/** Marks the format, so a key out of an unrelated product is refused on sight. */
export const LICENSE_PREFIX = 'WSL1'

/** The alphabet is RFC 4648 base32: A-Z and 2-7, uppercase, no padding. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Long enough for any real key, short enough that a mis-paste is not buffered. */
const MAX_LICENSE_LENGTH = 4096

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type LicenseRefusal = 'malformed' | 'version' | 'signature' | 'payload'

/**
 * The fields a key carries, whatever the format version says. The app acts on `v: 1`
 * only; the minting tool writes that version today, and a reader refuses one it has
 * never seen rather than guessing at it.
 */
export interface LicenseDraft {
  v: number
  id: string
  licensee: string
  issued: string
  expires?: string
}

export type LicenseVerification =
  | { ok: true; payload: LicensePayload }
  | { ok: false; reason: LicenseRefusal }

function toBase32(bytes: Buffer): string {
  let out = ''
  let bits = 0
  let value = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function fromBase32(text: string): Buffer {
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const char of text) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index < 0) throw new Error(`not base32: ${char}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function group(body: string): string {
  return (body.match(/.{1,8}/g) ?? []).join('-')
}

/**
 * Reads a key the way an operator types it: any case, any whitespace, with or without
 * the dashes, and possibly wrapped across lines by an email client. Returns the key in
 * the one form this app writes to disk, or null when it is not a key at all.
 */
export function canonicalLicense(text: string): string | null {
  const stripped = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (stripped.length > MAX_LICENSE_LENGTH) return null
  if (!stripped.startsWith(LICENSE_PREFIX)) return null
  const body = stripped.slice(LICENSE_PREFIX.length)
  // The alphabet check belongs here rather than at decode time: `canonicalLicense` is
  // what refuses a truncated paste before anything tries to verify it.
  if (body.length === 0 || ![...body].every(char => BASE32_ALPHABET.includes(char))) return null
  return `${LICENSE_PREFIX}-${group(body)}`
}

/** Mints a key. Only ever called with a private key the repo does not hold. */
export function createLicense(payload: LicenseDraft, privateKeyPem: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8')
  const signature = sign(null, body, createPrivateKey(privateKeyPem))
  return `${LICENSE_PREFIX}-${group(toBase32(Buffer.concat([body, Buffer.from([0]), signature])))}`
}

/**
 * Checks that a key was signed by the holder of the private key and that it carries a
 * payload this version understands. Says nothing about whether it has expired: that is
 * a question about the clock, not about the key.
 */
export function verifyLicense(text: string, publicKeys: string[]): LicenseVerification {
  const canonical = canonicalLicense(text)
  if (canonical === null) return { ok: false, reason: 'malformed' }

  let contents: Buffer
  try {
    const encoded = canonical.slice(LICENSE_PREFIX.length + 1).replace(/-/g, '')
    contents = fromBase32(encoded)
    // Re-encoding has to give back exactly what was pasted. Base32 leaves up to four
    // bits of the final character unused, so a key that differs from the real one in
    // its last character still decodes to the same bytes — and `toBase32` is what
    // catches that, rather than a typo quietly verifying.
    if (toBase32(contents) !== encoded) return { ok: false, reason: 'malformed' }
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const split = contents.indexOf(0)
  // A body shorter than a payload and a signature, or one with no separator, cannot
  // have come from `createLicense`.
  if (split <= 0 || contents.length - split - 1 !== 64) return { ok: false, reason: 'malformed' }

  const body = contents.subarray(0, split)
  const signature = contents.subarray(split + 1)

  const signed = publicKeys.some((pem) => {
    try {
      return verify(null, body, createPublicKey(pem), signature)
    } catch {
      return false
    }
  })
  if (!signed) return { ok: false, reason: 'signature' }

  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf-8'))
  } catch {
    return { ok: false, reason: 'payload' }
  }
  const candidate = readPayload(parsed)
  if (candidate === null) return { ok: false, reason: 'payload' }
  if (candidate.v !== 1) return { ok: false, reason: 'version' }
  return {
    ok: true,
    payload: {
      v: 1,
      id: candidate.id,
      licensee: candidate.licensee,
      issued: candidate.issued,
      ...(candidate.expires === undefined ? {} : { expires: candidate.expires })
    }
  }
}

/** The signed bytes are only trusted as far as this shape check takes them. */
function readPayload(value: unknown): LicenseDraft | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('v' in value) || !('id' in value) || !('licensee' in value) || !('issued' in value)) return null
  const { v, id, licensee, issued } = value
  if (typeof v !== 'number') return null
  if (typeof id !== 'string' || id.length === 0) return null
  if (typeof licensee !== 'string' || licensee.length === 0) return null
  if (typeof issued !== 'string' || !DATE_PATTERN.test(issued)) return null
  const expires = 'expires' in value ? value.expires : undefined
  if (expires !== undefined && (typeof expires !== 'string' || !DATE_PATTERN.test(expires))) {
    return null
  }
  return { v, id, licensee, issued, ...(expires === undefined ? {} : { expires }) }
}

/**
 * When the key stops working, or null for one that does not expire. A key is good for
 * the whole of its last day, in UTC: a show that opens on the day the licence runs out
 * should not stop mid-performance because the operator is east of the issuer.
 */
export function licenseExpiry(payload: LicensePayload): number | null {
  if (payload.expires === undefined) return null
  const end = Date.parse(`${payload.expires}T23:59:59.999Z`)
  return Number.isNaN(end) ? null : end
}

export function licenseExpired(payload: LicensePayload, now: number): boolean {
  const expiry = licenseExpiry(payload)
  return expiry !== null && now > expiry
}

/** What the operator is told when a key is refused. Terse, and never a stack trace. */
export function describeRefusal(reason: LicenseRefusal): string {
  switch (reason) {
    case 'malformed':
      return 'That is not a WinsLab license key. Paste the whole key, dashes and all.'
    case 'version':
      return 'That key was issued for a newer version of WinsLab. Update the app, then try again.'
    case 'payload':
      return 'That key is missing part of its licence. Paste the whole key.'
    case 'signature':
      return 'That key was not issued by WinsLab.'
  }
}