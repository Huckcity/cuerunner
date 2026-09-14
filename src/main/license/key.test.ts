import { describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import {
  canonicalLicense,
  createLicense,
  describeRefusal,
  licenseExpired,
  licenseExpiry,
  verifyLicense,
  type LicenseDraft,
  type LicenseRefusal
} from './key'

const issuer = generateKeyPairSync('ed25519')
const PRIVATE_PEM = issuer.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC_PEM = issuer.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const STRANGER_PEM = generateKeyPairSync('ed25519').publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()

const PAYLOAD: LicenseDraft = {
  v: 1,
  id: 'WSP-4K7Q2',
  licensee: 'Huckcity Ltd',
  issued: '2026-09-12'
}

const key = (overrides: Partial<LicenseDraft> = {}): string =>
  createLicense({ ...PAYLOAD, ...overrides }, PRIVATE_PEM)

describe('createLicense', () => {
  it('writes a prefixed, grouped, uppercase key', () => {
    const text = key()
    expect(text.startsWith('WSL1-')).toBe(true)
    expect(text).toMatch(/^WSL1(-[A-Z2-7]{8})+(-[A-Z2-7]{1,8})?$/)
  })

  it('is stable: minting the same payload twice gives the same key', () => {
    // Ed25519 is deterministic, which is what lets a key be re-issued from the same
    // invoice without the two copies disagreeing.
    expect(key()).toBe(key())
  })
})

describe('verifyLicense', () => {
  it('reads back what was signed', () => {
    const result = verifyLicense(key(), [PUBLIC_PEM])
    expect(result).toEqual({
      ok: true,
      payload: { v: 1, id: 'WSP-4K7Q2', licensee: 'Huckcity Ltd', issued: '2026-09-12' }
    })
  })

  it('carries an expiry when one was written', () => {
    const result = verifyLicense(key({ expires: '2027-09-12' }), [PUBLIC_PEM])
    expect(result.ok && result.payload.expires).toBe('2027-09-12')
  })

  it('accepts a key pasted out of an email: any case, any whitespace, any wrapping', () => {
    const text = key()
    const pasted = text.toLowerCase().replace(/-/g, ' \n ')
    expect(verifyLicense(pasted, [PUBLIC_PEM]).ok).toBe(true)
  })

  it('accepts a key whose dashes were lost in the paste', () => {
    expect(verifyLicense(key().replace(/-/g, ''), [PUBLIC_PEM]).ok).toBe(true)
  })

  it('refuses anything that is not a key', () => {
    for (const text of ['', '   ', 'hello', 'WSL1', 'WSL1-', 'XXXX-1234', 'WSL1-11111111']) {
      expect(verifyLicense(text, [PUBLIC_PEM])).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('refuses a key whose signature was tampered with', () => {
    const text = key()
    const at = Math.floor(text.length / 2)
    const mangled = `${text.slice(0, at)}${text[at] === 'A' ? 'B' : 'A'}${text.slice(at + 1)}`
    expect(verifyLicense(mangled, [PUBLIC_PEM])).toEqual({ ok: false, reason: 'signature' })
  })

  it('refuses one character changed anywhere, including the last one', () => {
    const text = key()
    const last = `${text.slice(0, -1)}${text.endsWith('A') ? 'B' : 'A'}`
    expect(verifyLicense(last, [PUBLIC_PEM]).ok).toBe(false)
  })

  it('refuses a key that was signed by somebody else', () => {
    expect(verifyLicense(key(), [STRANGER_PEM])).toEqual({ ok: false, reason: 'signature' })
  })

  it('refuses a key that has been cut short', () => {
    expect(verifyLicense(key().slice(0, 40), [PUBLIC_PEM])).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses a format version it cannot read', () => {
    expect(verifyLicense(key({ v: 2 }), [PUBLIC_PEM])).toEqual({ ok: false, reason: 'version' })
  })

  it('refuses a signed payload with nothing in a field', () => {
    expect(verifyLicense(key({ licensee: '' }), [PUBLIC_PEM])).toEqual({ ok: false, reason: 'payload' })
    expect(verifyLicense(key({ expires: 'next year' }), [PUBLIC_PEM])).toEqual({
      ok: false,
      reason: 'payload'
    })
  })

  it('refuses a public key that is not a public key', () => {
    expect(verifyLicense(key(), ['not a pem'])).toEqual({ ok: false, reason: 'signature' })
  })
})

describe('canonicalLicense', () => {
  it('returns the one form the app stores', () => {
    const text = key()
    expect(canonicalLicense(text.toLowerCase().replace(/-/g, ''))).toBe(text)
  })

  it('refuses what it cannot read', () => {
    expect(canonicalLicense('WSL1-@@@')).toBeNull()
    expect(canonicalLicense('WSL2-ABCDEFGH')).toBeNull()
    expect(canonicalLicense('x'.repeat(5000))).toBeNull()
  })
})

describe('expiry', () => {
  it('treats a key without dates as one that never expires', () => {
    const payload = { ...PAYLOAD, v: 1 as const }
    expect(licenseExpiry(payload)).toBeNull()
    expect(licenseExpired(payload, Date.parse('2099-01-01T00:00:00Z'))).toBe(false)
  })

  it('holds through the whole of the last day, in UTC', () => {
    const payload = { ...PAYLOAD, v: 1 as const, expires: '2026-09-12' }
    expect(licenseExpired(payload, Date.parse('2026-09-12T23:59:59.000Z'))).toBe(false)
    expect(licenseExpired(payload, Date.parse('2026-09-13T00:00:00.001Z'))).toBe(true)
  })
})

describe('describeRefusal', () => {
  it('has something to read for every refusal', () => {
    const reasons: LicenseRefusal[] = ['malformed', 'version', 'signature', 'payload']
    for (const reason of reasons) {
      expect(describeRefusal(reason).length).toBeGreaterThan(20)
    }
  })
})