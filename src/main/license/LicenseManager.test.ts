import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLicenseManager } from './LicenseManager'
import { canonicalLicense, createLicense, type LicenseDraft } from './key'

// The manager writes through the durable-write helper the workspace saves use, which
// reads `app.getPath` at the module boundary.
vi.mock('electron', () => ({ app: { getPath: () => process.env['CUERUNNER_TEST_USER_DATA'] } }))

const issuer = generateKeyPairSync('ed25519')
const PRIVATE_PEM = issuer.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC_PEM = issuer.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const OTHER_PRIVATE_PEM = generateKeyPairSync('ed25519').privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()

const PAYLOAD: LicenseDraft = {
  v: 1,
  id: 'CRN-4K7Q2',
  licensee: 'Huckcity Ltd',
  issued: '2026-09-12'
}

function key(overrides: Partial<LicenseDraft> = {}, privatePem = PRIVATE_PEM): string {
  return createLicense({ ...PAYLOAD, ...overrides }, privatePem)
}

let dir: string
let filePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-license-'))
  filePath = join(dir, 'license.key')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const manager = (now?: () => number) =>
  createLicenseManager({ filePath, publicKeys: [PUBLIC_PEM], ...(now ? { now } : {}) })

describe('reading the stored key', () => {
  it('starts unlicensed when this machine has never been given a key', () => {
    expect(manager().status()).toEqual({ state: 'unlicensed' })
  })

  it('starts unlicensed when the file is there but empty', () => {
    writeFileSync(filePath, ' \n', 'utf-8')
    expect(manager().status()).toEqual({ state: 'unlicensed' })
  })

  it('reads a key stored by an earlier run', async () => {
    const first = manager()
    await first.activate(key())

    expect(manager().status()).toEqual({
      state: 'active',
      license: { v: 1, id: 'CRN-4K7Q2', licensee: 'Huckcity Ltd', issued: '2026-09-12' }
    })
  })

  it('reports a stored key that verifies against nothing as invalid', () => {
    writeFileSync(filePath, key({}, OTHER_PRIVATE_PEM), 'utf-8')
    const status = manager().status()
    expect(status.state).toBe('invalid')
    expect(status.state === 'invalid' && status.error).toContain('not issued by Cuerunner')
  })

  it('reports a stored key past its date as expired, keeping who it was for', () => {
    writeFileSync(filePath, key({ expires: '2026-01-31' }), 'utf-8')
    const status = manager().status()
    expect(status.state).toBe('expired')
    expect(status.state === 'expired' && status.license.licensee).toBe('Huckcity Ltd')
  })
})

describe('activate', () => {
  it('stores the canonical key and unlocks', async () => {
    const license = manager()
    const result = await license.activate(key().toLowerCase().replace(/-/g, '\n'))

    expect(result.ok).toBe(true)
    expect(license.status().state).toBe('active')
    expect(readFileSync(filePath, 'utf-8')).toBe(canonicalLicense(key()))
  })

  it('refuses a key that is not one, and keeps the key it already had', async () => {
    const license = manager()
    await license.activate(key())

    const result = await license.activate('hello there')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not a Cuerunner license key')
    expect(license.status().state).toBe('active')
  })

  it('refuses an expired key, and says the date', async () => {
    const license = manager()
    const result = await license.activate(key({ expires: '2026-02-01' }))

    expect(result.ok).toBe(false)
    expect(result.error).toContain('2026-02-01')
    expect(license.status()).toEqual({ state: 'unlicensed' })
    expect(existsSync(filePath)).toBe(false)
  })

  it('refuses a key signed by somebody else', async () => {
    const license = manager()
    const result = await license.activate(key({}, OTHER_PRIVATE_PEM))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not issued by Cuerunner')
  })

  it('refuses a key that has run out, judged by the clock it was handed', async () => {
    const license = manager(() => Date.parse('2026-09-12T12:00:00Z'))
    expect((await license.activate(key({ expires: '2026-09-11' }))).ok).toBe(false)
    expect((await license.activate(key({ expires: '2026-09-12' }))).ok).toBe(true)
  })
})

describe('deactivate', () => {
  it('removes the key and every copy of it', async () => {
    const license = manager()
    await license.activate(key())
    await license.activate(key({ id: 'CRN-9ZZZZ' }))

    expect(await license.deactivate()).toEqual({ state: 'unlicensed' })
    expect(existsSync(filePath)).toBe(false)
    expect(existsSync(`${filePath}.bak`)).toBe(false)
    expect(manager().status()).toEqual({ state: 'unlicensed' })
  })

  it('is harmless when there was nothing to remove', async () => {
    const license = manager()
    expect(await license.deactivate()).toEqual({ state: 'unlicensed' })
  })
})

describe('subscribe', () => {
  it('tells every listener what the license is now, and stops when unsubscribed', async () => {
    const license = manager()
    const seen: string[] = []
    const off = license.subscribe(status => seen.push(status.state))

    await license.activate(key())
    await license.deactivate()
    off()
    await license.activate(key())

    expect(seen).toEqual(['active', 'unlicensed'])
  })
})