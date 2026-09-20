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

// The wait the manager arms for a key's last instant is a real timer, so these cases drive
// vitest's clock: the timer has to come back at that instant, and the clock the manager
// reads has to be standing on the other side of it when it does.
describe('the boundary', () => {
  it('holds through the whole of the last day, in UTC', async () => {
    const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
    const license = manager(() => clock.at)
    await license.activate(key({ expires: '2026-09-12' }))

    clock.at = Date.parse('2026-09-12T23:59:59.000Z')
    expect(license.status().state).toBe('active')

    clock.at = Date.parse('2026-09-12T23:59:59.999Z') // the last millisecond of its day
    expect(license.status().state).toBe('active')

    clock.at = Date.parse('2026-09-13T00:00:00.000Z') // one millisecond later
    expect(license.status().state).toBe('expired')

    clock.at = Date.parse('2026-09-13T00:00:00.001Z')
    expect(license.status().state).toBe('expired')
  })

  it('answers a refused paste from the clock rather than from the status it was holding', async () => {
    const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
    const license = manager(() => clock.at)
    await license.activate(key({ expires: '2026-09-12' }))

    // The instant passes with nobody asking, and then a paste is refused: what the
    // refusal answers has to be the state the machine is in now, not the `active` it was
    // holding when the clock crossed.
    clock.at = Date.parse('2026-09-13T09:00:00Z')

    const malformed = await license.activate('CRN1-ABCDEFGH-ABCDEFGH')
    expect(malformed.error).toContain('not a Cuerunner license key')
    expect(malformed.status.state).toBe('expired')

    const ranOut = await license.activate(key({ expires: '2026-09-12' }))
    expect(ranOut.error).toContain('expired on 2026-09-12')
    expect(ranOut.status.state).toBe('expired')
  })

  it('leaves the stored key and its wait as they were when a paste is refused', async () => {
    vi.useFakeTimers()
    try {
      const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
      const license = manager(() => clock.at)
      await license.activate(key({ expires: '2026-09-12' }))
      const stored = license.status()

      const seen: string[] = []
      license.subscribe(status => seen.push(status.state))

      const refused = await license.activate(key({}, OTHER_PRIVATE_PEM))

      expect(refused.ok).toBe(false)
      expect(refused.status).toBe(stored)
      expect(license.status()).toBe(stored)
      expect(readFileSync(filePath, 'utf-8')).toBe(canonicalLicense(key({ expires: '2026-09-12' })))
      expect(seen).toEqual([])

      // And the key that is still stored is the one still being waited for.
      clock.at = Date.parse('2026-09-13T00:00:00Z')
      vi.advanceTimersByTime(43_200_000)
      expect(seen).toEqual(['expired'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends a key on its own when the clock crosses its last instant', async () => {
    vi.useFakeTimers()
    try {
      const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
      const license = manager(() => clock.at)
      await license.activate(key({ expires: '2026-09-12' }))

      const seen: string[] = []
      license.subscribe(status => seen.push(status.state))
      expect(license.status().state).toBe('active')

      // Half a day short of the end of the key's last day in UTC, which is where the
      // wait armed when the key was taken is pointed.
      clock.at = Date.parse('2026-09-13T00:00:00Z')
      vi.advanceTimersByTime(43_200_000)

      // Told without anyone asking: the wait itself crossed the boundary.
      expect(seen).toEqual(['expired'])
      expect(license.status().state).toBe('expired')

      // Once, and then not again however long the app is left open.
      vi.advanceTimersByTime(86_400_000)
      expect(seen).toEqual(['expired'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for a key it read from disk, not only for one entered this session', async () => {
    writeFileSync(filePath, key({ expires: '2026-09-12' }), 'utf-8')
    vi.useFakeTimers()
    try {
      const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
      const license = manager(() => clock.at)
      const seen: string[] = []
      license.subscribe(status => seen.push(status.state))
      expect(license.status().state).toBe('active')

      clock.at = Date.parse('2026-09-13T00:00:00Z')
      vi.advanceTimersByTime(43_200_000)

      expect(seen).toEqual(['expired'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('is noticed by a read even when the wait has not come back yet', async () => {
    const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
    const license = manager(() => clock.at)
    await license.activate(key({ expires: '2026-09-12' }))

    const seen: string[] = []
    license.subscribe(status => seen.push(status.state))

    // A machine that was asleep, or a clock that was corrected: the instant is long past
    // and nothing waited through it.
    clock.at = Date.parse('2026-09-14T09:00:00Z')

    expect(license.status().state).toBe('expired')
    expect(seen).toEqual(['expired'])
  })

  it('caps the wait for a key far enough out, and waits again until the real instant', async () => {
    vi.useFakeTimers()
    try {
      const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
      const license = manager(() => clock.at)
      await license.activate(key({ expires: '2026-12-01' })) // 80 days away

      const seen: string[] = []
      license.subscribe(status => seen.push(status.state))

      // Node refuses a delay longer than this and fires at once, so the wait is armed as
      // far as a timer can carry it and the boundary is met by arming again.
      clock.at += 2_147_483_647
      vi.advanceTimersByTime(2_147_483_647)
      expect(seen).toEqual([]) // the cap came back early: nothing has changed
      expect(license.status().state).toBe('active')

      // Three more capped waits is past the eighty days, and the boundary is crossed once.
      for (let i = 0; i < 3; i++) {
        clock.at += 2_147_483_647
        vi.advanceTimersByTime(2_147_483_647)
      }
      expect(seen).toEqual(['expired'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits a second time when the clock steps back inside the dates', async () => {
    vi.useFakeTimers()
    try {
      const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
      const license = manager(() => clock.at)
      await license.activate(key({ expires: '2026-09-12' }))

      const seen: string[] = []
      license.subscribe(status => seen.push(status.state))

      // The key ends with nobody asking.
      clock.at = Date.parse('2026-09-13T00:00:00Z')
      vi.advanceTimersByTime(43_200_000)
      expect(seen).toEqual(['expired'])

      // A corrected clock puts the key back inside its dates. The read that finds it arms
      // the wait again, so the crossing that follows is crossed with nobody asking either.
      clock.at = Date.parse('2026-09-12T12:00:00Z')
      expect(license.status().state).toBe('active')

      clock.at = Date.parse('2026-09-13T00:00:00Z')
      vi.advanceTimersByTime(43_200_000)
      expect(seen).toEqual(['expired', 'active', 'expired'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops waiting when the key is removed', async () => {
    vi.useFakeTimers()
    try {
      const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
      const license = manager(() => clock.at)
      await license.activate(key({ expires: '2026-09-12' }))

      const seen: string[] = []
      license.subscribe(status => seen.push(status.state))
      expect(await license.deactivate()).toEqual({ state: 'unlicensed' })

      // The instant the key would have ended comes and goes: there is nothing to tell.
      clock.at = Date.parse('2026-09-13T00:00:00Z')
      vi.advanceTimersByTime(12 * 60 * 60 * 1000)
      expect(seen).toEqual(['unlicensed'])
      expect(license.status()).toEqual({ state: 'unlicensed' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for the key it was given instead of the one it replaced', async () => {
    vi.useFakeTimers()
    try {
      const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
      const license = manager(() => clock.at)
      await license.activate(key({ expires: '2026-09-12' }))
      await license.activate(key({ id: 'CRN-9ZZZZ', expires: '2026-09-20' }))

      const seen: string[] = []
      license.subscribe(status => seen.push(status.state))

      // The first key's boundary passes with the second one in force: nothing is told.
      clock.at = Date.parse('2026-09-13T00:00:00Z')
      vi.advanceTimersByTime(12 * 60 * 60 * 1000)
      expect(seen).toEqual([])
      expect(license.status().state).toBe('active')

      // The second key's own instant is the one that is waited for.
      clock.at = Date.parse('2026-09-21T00:00:00Z')
      vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000)
      expect(seen).toEqual(['expired'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a key that is still good', () => {
  it('reads as the same status and tells nobody as the clock moves within its dates', async () => {
    const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
    const license = manager(() => clock.at)
    await license.activate(key({ expires: '2026-10-31' }))

    const seen: string[] = []
    license.subscribe(status => seen.push(status.state))

    const first = license.status()
    clock.at += 90 * 60 * 1000
    expect(license.status()).toBe(first)
    expect(seen).toEqual([])
  })

  it('never waits for a key that does not expire', async () => {
    vi.useFakeTimers()
    try {
      const clock = { at: Date.parse('2026-09-12T12:00:00Z') }
      const license = manager(() => clock.at)
      await license.activate(key())

      const seen: string[] = []
      license.subscribe(status => seen.push(status.state))
      const first = license.status()

      clock.at += 40 * 365 * 24 * 60 * 60 * 1000
      vi.advanceTimersByTime(24 * 60 * 60 * 1000)

      expect(license.status()).toBe(first)
      expect(seen).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
