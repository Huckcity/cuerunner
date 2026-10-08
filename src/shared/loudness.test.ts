import { describe, expect, it } from 'vitest'
import { formatDbtp, formatLufs, normalizeCueLoudness, normalizePlan } from './loudness'

describe('normalising a cue', () => {
  it('sets the trim that puts the file at the target', () => {
    const plan = normalizePlan({ integratedLufs: -18, truePeakDb: -10, silent: false }, -23, -1)
    expect(plan).toEqual({ trim: 0.5623, gainDb: -5, limitedBy: 'target', resultLufs: -23 })
  })

  it('stops at the true-peak ceiling and says that is what stopped it', () => {
    // −30 LUFS to −23 is +7 dB, but its peaks at −4 dBTP would go to +3: held at −1.
    const plan = normalizePlan({ integratedLufs: -30, truePeakDb: -4, silent: false }, -23, -1)
    expect(plan?.limitedBy).toBe('ceiling')
    expect(plan?.gainDb).toBe(3)
    expect(plan?.resultLufs).toBe(-27)
  })

  it('stops at the trim\'s own range', () => {
    const plan = normalizePlan({ integratedLufs: -40, truePeakDb: -30, silent: false }, -23, -1)
    expect(plan?.limitedBy).toBe('range')
    expect(plan?.trim).toBe(2)
  })

  it('has nothing to do for silence', () => {
    expect(normalizePlan({ integratedLufs: -70, truePeakDb: -200, silent: true }, -23, -1)).toBeNull()
  })

  it('writes loudness the way a meter does', () => {
    expect(formatLufs(-23)).toBe('−23.0 LUFS')
    expect(formatDbtp(-0.44)).toBe('−0.4 dBTP')
    expect(formatDbtp(1.2)).toBe('+1.2 dBTP')
    expect(formatDbtp(-200)).toBe('−∞ dBTP')
  })

  it('reads a measurement a file carries, and not one it cannot', () => {
    expect(normalizeCueLoudness({ filePath: '/a.wav', integratedLufs: -20, truePeakDb: -1, silent: false }))
      .toEqual({ filePath: '/a.wav', integratedLufs: -20, truePeakDb: -1, silent: false })
    expect(normalizeCueLoudness({ filePath: '/a.wav', integratedLufs: 'loud', truePeakDb: -1 })).toBeNull()
  })
})
