// A Pro dev run is worth nothing unless the app comes up licensed, and the ways it comes
// up unlocked-by-accident are the ones nobody sees: a key the trusted public key does not
// sign for, a key in a profile the app was never pointed at, and a flag that never
// reached the Electron process. All three are decided by what is set up here.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEV_LICENSEE, devArgs, devEnv, mintDevLicense, provision } from './dev-pro.ts'
import { verifyLicense } from '../src/main/license/key.ts'

const ISSUED = '2026-09-14'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'winslab-dev-pro-'))
}

describe('mintDevLicense', () => {
  it('mints a key the public key it hands the app accepts', () => {
    const license = mintDevLicense(ISSUED)
    const verified = verifyLicense(license.text, [license.publicKeyPem])
    expect(verified.ok).toBe(true)
    expect(verified.ok ? verified.payload.licensee : null).toBe(DEV_LICENSEE)
  })

  it('mints a new pair every run, so one run cannot vouch for the next', () => {
    expect(mintDevLicense(ISSUED).publicKeyPem).not.toBe(mintDevLicense(ISSUED).publicKeyPem)
  })
})

describe('provision', () => {
  it('plants the key in the profile, where the app reads the one it holds', () => {
    const dir = tempDir()
    try {
      const license = mintDevLicense(ISSUED)
      expect(provision(license, dir)).toBe(dir)
      expect(readFileSync(join(dir, 'license.key'), 'utf-8')).toBe(license.text)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('devEnv', () => {
  it('tells the app which key to check a license against, and leaves the rest alone', () => {
    const license = mintDevLicense(ISSUED)
    const env = devEnv({ PATH: '/usr/bin' }, license)
    expect(env['WINSLAB_LICENSE_PUBLIC_KEY']).toBe(license.publicKeyPem)
    expect(env['PATH']).toBe('/usr/bin')
  })
})

describe('devArgs', () => {
  it('points the app at the profile, past the separator the dev server reads it from', () => {
    expect(devArgs([], '/tmp/profile')).toEqual([
      'run',
      'dev',
      '--',
      '--',
      '--user-data-dir=/tmp/profile'
    ])
  })

  it('leaves the flags the developer added where the dev server parses them', () => {
    expect(devArgs(['--inspect', '5858'], '/tmp/profile')).toEqual([
      'run',
      'dev',
      '--',
      '--inspect',
      '5858',
      '--',
      '--user-data-dir=/tmp/profile'
    ])
  })
})
