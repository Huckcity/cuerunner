import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The TSan lane judges races, not timing: the soak it runs must not gate on xruns, and the
// real-time lane (`native`, unsanitized) must keep the zero-xrun default.
const read = (p: string): string => readFileSync(p, 'utf8')

describe('xrun gating', () => {
  it('the sanitized soak passes an xrun budget no run reaches', () => {
    const tsan = read('native/audio/tests/tsan.mjs')
    expect(tsan).toMatch(/'--xrun-budget', String\(XRUN_BUDGET\)/)
    expect(tsan).toMatch(/XRUN_BUDGET = 1e9/)
  })

  it('the soak defaults to zero xruns, which the native lane uses', () => {
    expect(read('native/audio/tests/soak.mjs')).toMatch(/argValue\('xrun-budget', 0\)/)
    expect(read('.slipway/ci.yaml')).not.toMatch(/xrun-budget/)
  })
})
