// The tool that mints licenses is the other half of the gate, and the only half that can
// be wrong in a way nobody notices until a customer cannot unlock. What these tests hold
// is that a key it prints is a key the app accepts, and that it refuses the mistakes an
// issuer makes at 2am: no name, a date that is not a date, and overwriting the key pair
// every key already sold depends on.
import { describe, expect, it } from 'vitest'
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { issueKey, parseArgs, runCli } from './license-keygen.ts'
import { verifyLicense } from '../src/main/license/key.ts'
import { PRODUCT_PUBLIC_KEYS } from '../src/main/license/publicKey.ts'

/** The advice a rotation is followed by hand, so the test resolves what it names from here. */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const ISSUED = '2026-09-12'

function run(argv: string[], publicKeys?: string[]): { lines: string[]; error: Error | null } {
  const lines: string[] = []
  try {
    runCli(argv, line => lines.push(line), publicKeys)
    return { lines, error: null }
  } catch (error) {
    return { lines, error: error instanceof Error ? error : new Error(String(error)) }
  }
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cuerunner-keygen-'))
}

describe('issueKey', () => {
  it('mints a key the app reads back, carrying what was asked for', () => {
    const text = issueKey(
      { licensee: 'Huckcity Ltd', id: 'CRN-4K7Q2', expires: '2027-09-12', issued: ISSUED },
      PRIVATE_PEM
    )

    expect(verifyLicense(text, [PUBLIC_PEM])).toEqual({
      ok: true,
      payload: {
        v: 1,
        id: 'CRN-4K7Q2',
        licensee: 'Huckcity Ltd',
        issued: ISSUED,
        expires: '2027-09-12'
      }
    })
  })

  it('mints a key that does not expire when no date is given, and makes up an id', () => {
    const verified = verifyLicense(issueKey({ licensee: 'Theatre X', issued: ISSUED }, PRIVATE_PEM), [PUBLIC_PEM])
    expect(verified.ok).toBe(true)
    expect(verified.ok && verified.payload.expires).toBeUndefined()
    expect(verified.ok && verified.payload.id).toMatch(/^CRN-[A-Z2-7]{6}$/)
  })

  it('refuses to mint without a name', () => {
    expect(() => issueKey({ licensee: '   ', issued: ISSUED }, PRIVATE_PEM))
      .toThrow(/needs a name/)
  })

  it('refuses a date that is not one', () => {
    expect(() => issueKey({ licensee: 'Theatre X', expires: 'next year', issued: ISSUED }, PRIVATE_PEM))
      .toThrow(/YYYY-MM-DD/)
    expect(() => issueKey({ licensee: 'Theatre X', expires: '2027-13-45', issued: ISSUED }, PRIVATE_PEM))
      .toThrow(/not a real date/)
  })
})

describe('keygen', () => {
  it('writes a private key nobody else can read, and prints the public half', () => {
    const dir = tempDir()
    try {
      const keyPath = join(dir, 'issuer.pem')
      const { lines } = run(['keygen', '--key', keyPath])

      // A mode is a POSIX fact: Windows has none, and the file's protection there is the
      // profile's own ACLs rather than anything this writer could set.
      if (process.platform !== 'win32') expect(statSync(keyPath).mode & 0o777).toBe(0o600)
      const printed = lines.join('\n')
      expect(printed).toContain('BEGIN PUBLIC KEY')
      expect(printed).not.toContain('PRIVATE KEY')

      // What it told the issuer to paste in is the public half of what it wrote.
      const pem = printed.slice(printed.indexOf('-----BEGIN PUBLIC KEY-----')).trim()
      expect(pem).toBe(createPublicKey(createPrivateKey(readFileSync(keyPath, 'utf-8')))
        .export({ type: 'spki', format: 'pem' })
        .toString()
        .trim())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite a key pair, because every key sold depends on it', () => {
    const dir = tempDir()
    try {
      const keyPath = join(dir, 'issuer.pem')
      run(['keygen', '--key', keyPath])
      const before = readFileSync(keyPath, 'utf-8')

      const { error } = run(['keygen', '--key', keyPath])

      expect(error?.message).toMatch(/already exists/)
      expect(readFileSync(keyPath, 'utf-8')).toBe(before)

      run(['keygen', '--key', keyPath, '--force'])
      expect(readFileSync(keyPath, 'utf-8')).not.toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('issue from the command line', () => {
  it('mints from the pair on disk and says who it is for', () => {
    const dir = tempDir()
    try {
      const keyPath = join(dir, 'issuer.pem')
      run(['keygen', '--key', keyPath])

      const { lines, error } = run([
        'issue', '--key', keyPath, '--name', 'Theatre X', '--expires', '2027-01-31'
      ])

      expect(error).toBeNull()
      const text = lines[0]
      expect(text.startsWith('CRN1-')).toBe(true)
      expect(lines.join('\n')).toContain('For Theatre X')
      expect(lines.join('\n')).toContain('until 2027-01-31')

      // The pair the tool wrote is the pair that signed it.
      const publicPem = createPublicKey(createPrivateKey(readFileSync(keyPath, 'utf-8')))
        .export({ type: 'spki', format: 'pem' })
        .toString()
      const verified = verifyLicense(text, [publicPem])
      expect(verified.ok).toBe(true)
      expect(verified.ok && verified.payload.licensee).toBe('Theatre X')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a key that the shipped build would not accept', () => {
    // The check support runs before answering a customer: signed by anything other than
    // the keys this build trusts, it is not a key this build will take.
    const { error } = run(['verify', issueKey({ licensee: 'Theatre X', issued: ISSUED }, PRIVATE_PEM)])

    expect(error?.message).toContain('not issued by Cuerunner')
  })

  it('says what a real key is, and when it runs out', () => {
    const dir = tempDir()
    try {
      const keyPath = join(dir, 'issuer.pem')
      run(['keygen', '--key', keyPath])
      const privateKeyPem = readFileSync(keyPath, 'utf-8')
      const signed = issueKey({ licensee: 'Theatre X', issued: ISSUED, expires: '2027-01-31' }, privateKeyPem)
      // The shipped keys are what a released build carries; a rotated build carries this pair's
      // public half added to them, which is what the check has to work against.
      const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem))
        .export({ type: 'spki', format: 'pem' })
        .toString()

      const { lines, error } = run(['verify', signed], [publicKeyPem])

      expect(error).toBeNull()
      expect(lines.join('\n')).toContain('for Theatre X')
      expect(lines.join('\n')).toContain('good through 2027-01-31')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('parseArgs', () => {
  it('reads flags whether they are spaced or joined, and takes switches as switches', () => {
    expect(parseArgs(['issue', '--name', 'Theatre X', '--id=CRN-1', '--force'])).toEqual({
      command: 'issue',
      flags: { name: 'Theatre X', id: 'CRN-1', force: 'true' },
      rest: []
    })
  })

  it('says what it is missing rather than reading the next flag as a value', () => {
    expect(() => parseArgs(['issue', '--name'])).toThrow(/needs a value/)
  })
})

// A rotation adds a public key and releases; it never replaces the set, because every key already
// sold was signed under a key that has to keep verifying. These hold the tool's advice and the
// verification together, over the set rather than by inspection.
describe('rotation', () => {
  it('tells the issuer to add the key to the set, and why replacing it would strand a sale', () => {
    const dir = tempDir()
    try {
      const { lines } = run(['keygen', '--key', join(dir, 'issuer.pem')])
      const printed = lines.join('\n')

      expect(printed).toContain('src/main/license/publicKey.ts')
      expect(printed).toMatch(/\badd\b/i)
      // The instruction the issuer follows is the one this holds: paste it into that set. Reading
      // `Replace PRODUCT_PUBLIC_KEYS … with this` there again is the defect, not a wording choice.
      expect(printed).not.toMatch(/replace PRODUCT_PUBLIC_KEYS/i)
      expect(printed).toMatch(/already sold/i)
      // And the path it names has to be a file, or the instruction cannot be followed.
      const named = /src\/[A-Za-z0-9_./-]+\.ts/.exec(printed)?.[0]
      expect(named).toBeDefined()
      expect(existsSync(join(repoRoot, named ?? ''))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps an existing key verifying when the printed public key is added to the set', () => {
    const dir = tempDir()
    try {
      const keyPath = join(dir, 'issuer.pem')
      const { lines } = run(['keygen', '--key', keyPath])
      const printed = lines.join('\n')
      // What the tool tells the issuer to paste in, and the pair behind it.
      const addedPem = printed.slice(printed.indexOf('-----BEGIN PUBLIC KEY-----')).trim()
      const addedPrivatePem = readFileSync(keyPath, 'utf-8')

      // A key sold before the rotation: signed by a pair the shipped set holds. No private half of
      // the shipped keys is in this repository, so the pair these tests own stands in for that one
      // and the real compiled-in set rides along in the same list.
      const sold = issueKey({ licensee: 'Theatre X', issued: ISSUED }, PRIVATE_PEM)
      const before = verifyLicense(sold, [PUBLIC_PEM, ...PRODUCT_PUBLIC_KEYS])
      expect(before.ok).toBe(true)

      // The release the advice describes: the new public key added, nothing dropped.
      expect(verifyLicense(sold, [PUBLIC_PEM, ...PRODUCT_PUBLIC_KEYS, addedPem])).toEqual(before)
      // Position is not part of the contract, so a read of the first key alone fails here.
      expect(verifyLicense(sold, [addedPem, PUBLIC_PEM, ...PRODUCT_PUBLIC_KEYS])).toEqual(before)

      // And the addition is real: the new pair's own keys verify against the grown set, and did
      // not verify against it before the addition.
      const minted = issueKey({ licensee: 'Theatre Y', issued: ISSUED }, addedPrivatePem)
      expect(verifyLicense(minted, [PUBLIC_PEM, ...PRODUCT_PUBLIC_KEYS])).toEqual({
        ok: false,
        reason: 'signature'
      })
      expect(verifyLicense(minted, [PUBLIC_PEM, ...PRODUCT_PUBLIC_KEYS, addedPem]).ok).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the key the app ships with', () => {
  it('is a usable public key, and never the private half', () => {
    // A placeholder or a private key left in the build would be a gate that either
    // refuses every key ever sold or hands out the means to mint them.
    expect(PRODUCT_PUBLIC_KEYS.length).toBeGreaterThan(0)
    for (const pem of PRODUCT_PUBLIC_KEYS) {
      expect(pem.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true)
      expect(pem).not.toContain('PRIVATE KEY')
      expect(() => createPublicKey(pem)).not.toThrow()
    }
  })
})