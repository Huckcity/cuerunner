import { describe, expect, it } from 'vitest'
import { PRODUCT_PUBLIC_KEYS } from './publicKey'
import { trustedPublicKeys } from './trustedKeys'

// What a shipped build verifies against is the compiled-in set — the whole of it, which a rotation
// only adds to. The override exists so a dev session or the E2E suite can trust a pair of its own,
// because the private half of the product key is deliberately not in this repository.
describe('trustedPublicKeys', () => {
  it('gives a packaged build the compiled-in set, whatever the environment says', () => {
    // The same set object reaches verification — not a copy, not a subset of it.
    expect(trustedPublicKeys(true, {})).toBe(PRODUCT_PUBLIC_KEYS)
    expect(trustedPublicKeys(true, { CUERUNNER_LICENSE_PUBLIC_KEY: 'a key of its own' }))
      .toBe(PRODUCT_PUBLIC_KEYS)
  })

  it('lets a source tree trust one key of its own, and only there', () => {
    expect(trustedPublicKeys(false, { CUERUNNER_LICENSE_PUBLIC_KEY: 'a key of its own' }))
      .toEqual(['a key of its own'])
    expect(trustedPublicKeys(false, {})).toBe(PRODUCT_PUBLIC_KEYS)
  })
})
