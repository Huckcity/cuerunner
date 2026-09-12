// The tool that mints licences is the other half of the gate, and the only half that can
// be wrong in a way nobody notices until a customer cannot unlock. What these tests hold
// is that a key it prints is a key the app accepts, and that it refuses the mistakes an
// issuer makes at 2am: no name, a date that is not a date, and overwriting the key pair
// every key already sold depends on.
import { describe, expect, it } from 'vitest'
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { issueKey, parseArgs, runCli } from './license-keygen.ts'
import { verifyLicense } from '../src/main/license/key.ts'
import { PRODUCT_PUBLIC_KEYS } from '../src/main/license/publicKey.ts'

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
  return mkdtempSync(join(tmpdir(), 'winslab-keygen-'))
}

describe('issueKey', () => {
  it('mints a key the app reads back, carrying what was asked for', () => {
    const text = issueKey(
      { licensee: 'Huckcity Ltd', id: 'WSP-4K7Q2', expires: '2027-09-12', issued: ISSUED },
      PRIVATE_PEM
    )

    expect(verifyLicense(text, [PUBLIC_PEM])).toEqual({
      ok: true,
      payload: {
        v: 1,
        id: 'WSP-4K7Q2',
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
    expect(verified.ok && verified.payload.id).toMatch(/^WSP-[A-Z2-7]{6}$/)
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

      expect(statSync(keyPath).mode & 0o777).toBe(0o600)
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
      expect(text.startsWith('WSL1-')).toBe(true)
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
    // the key this build trusts, it is not a key this build will take.
    const { error } = run(['verify', issueKey({ licensee: 'Theatre X', issued: ISSUED }, PRIVATE_PEM)])

    expect(error?.message).toContain('not issued by WinsLab')
  })

  it('says what a real key is, and when it runs out', () => {
    const dir = tempDir()
    try {
      const keyPath = join(dir, 'issuer.pem')
      run(['keygen', '--key', keyPath])
      const privateKeyPem = readFileSync(keyPath, 'utf-8')
      const signed = issueKey({ licensee: 'Theatre X', issued: ISSUED, expires: '2027-01-31' }, privateKeyPem)
      // The shipped keys are what a released build carries; a rotated build would hold
      // this pair's public half instead, which is what the check has to work against.
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
    expect(parseArgs(['issue', '--name', 'Theatre X', '--id=WSP-1', '--force'])).toEqual({
      command: 'issue',
      flags: { name: 'Theatre X', id: 'WSP-1', force: 'true' },
      rest: []
    })
  })

  it('says what it is missing rather than reading the next flag as a value', () => {
    expect(() => parseArgs(['issue', '--name'])).toThrow(/needs a value/)
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