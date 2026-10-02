// The credentials file is where a receiver's password lives, so it is held to the things
// that matter about one: the password is not on disk as written when the platform can
// protect it, nothing is left beside it, and a bad file does not stop a show opening.
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEwDxCredentials } from './credentials'
import type { Cipher } from './credentials'

const reverse = (text: string): string => [...text].reverse().join('')
const protectedCipher: Cipher = {
  available: () => true,
  encrypt: text => `enc:${reverse(text)}`,
  decrypt: text => {
    if (!text.startsWith('enc:')) throw new Error('not ours')
    return reverse(text.slice(4))
  }
}
const bareCipher: Cipher = { available: () => false, encrypt: text => text, decrypt: text => text }

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ewdx-credentials-'))
  file = join(dir, 'ew-dx.json')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('createEwDxCredentials', () => {
  it('keeps a password across a restart and does not write it as typed', async () => {
    const first = createEwDxCredentials({ filePath: file, cipher: protectedCipher })
    await first.setPassword('rack-a', 'Hunter2!')
    expect(await readFile(file, 'utf8')).not.toContain('Hunter2!')

    const second = createEwDxCredentials({ filePath: file, cipher: protectedCipher })
    expect(second.get('rack-a')).toEqual({ password: 'Hunter2!' })
  })

  it('says so when the platform cannot protect the password', async () => {
    const store = createEwDxCredentials({ filePath: file, cipher: bareCipher })
    expect(store.encrypted()).toBe(false)
    await store.setPassword('rack-a', 'Hunter2!')
    expect(createEwDxCredentials({ filePath: file, cipher: bareCipher }).get('rack-a')?.password).toBe('Hunter2!')
  })

  it('is readable by its owner alone and leaves no copy of an older version beside it', async () => {
    const store = createEwDxCredentials({ filePath: file, cipher: protectedCipher })
    await store.setPassword('rack-a', 'first')
    await store.setPassword('rack-a', 'second')
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o077).toBe(0)
    expect(await readdir(dir)).toEqual(['ew-dx.json'])
  })

  it('pins a certificate for a receiver it has a password for, and keeps the pin through a new password', async () => {
    const store = createEwDxCredentials({ filePath: file, cipher: protectedCipher })
    await store.setPassword('rack-a', 'one')
    await store.pin('rack-a', 'AA:BB')
    await store.setPassword('rack-a', 'two')
    expect(store.get('rack-a')).toEqual({ password: 'two', fingerprint: 'AA:BB' })
  })

  it('forgets a pin on request, and a receiver entirely', async () => {
    const store = createEwDxCredentials({ filePath: file, cipher: protectedCipher })
    await store.setPassword('rack-a', 'one')
    await store.pin('rack-a', 'AA:BB')
    await store.unpin('rack-a')
    expect(store.get('rack-a')).toEqual({ password: 'one' })
    await store.forget('rack-a')
    expect(store.get('rack-a')).toBeUndefined()
  })

  it('does not invent an entry for a certificate with no password', async () => {
    const store = createEwDxCredentials({ filePath: file, cipher: protectedCipher })
    await store.pin('rack-a', 'AA:BB')
    expect(store.get('rack-a')).toBeUndefined()
  })

  it('treats a password it cannot decrypt as no password', async () => {
    await writeFile(file, JSON.stringify({ version: 1, sources: { 'rack-a': { password: 'garbage', encrypted: true } } }))
    expect(createEwDxCredentials({ filePath: file, cipher: protectedCipher }).get('rack-a')).toBeUndefined()
  })

  it('opens with nothing from a file that is missing, corrupt or not ours', async () => {
    expect(createEwDxCredentials({ filePath: file, cipher: protectedCipher }).get('rack-a')).toBeUndefined()
    await writeFile(file, '{ not json')
    expect(createEwDxCredentials({ filePath: file, cipher: protectedCipher }).get('rack-a')).toBeUndefined()
    await writeFile(file, JSON.stringify({ sources: { 'rack-a': { password: 5 } } }))
    expect(createEwDxCredentials({ filePath: file, cipher: protectedCipher }).get('rack-a')).toBeUndefined()
  })

  it('leaves the last pin on disk when two arrive together', async () => {
    const store = createEwDxCredentials({ filePath: file, cipher: protectedCipher })
    await store.setPassword('rack-a', 'one')
    await Promise.all([store.pin('rack-a', 'FIRST'), store.pin('rack-a', 'SECOND')])
    expect(createEwDxCredentials({ filePath: file, cipher: protectedCipher }).get('rack-a')?.fingerprint).toBe('SECOND')
  })
})
