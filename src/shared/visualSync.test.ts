import { describe, expect, it } from 'vitest'
import { SYNC_DEADBAND_MS, SYNC_MAX_BEND, fitClock, rateWorthSetting, syncCorrection } from './visualSync'

describe('keeping a picture on the engine\'s clock', () => {
  it('leaves a picture that is where it should be at its own rate', () => {
    expect(syncCorrection(1000, 1000 + SYNC_DEADBAND_MS)).toEqual({ kind: 'hold', rate: 1 })
  })

  it('plays a picture that is behind a little fast, and one that is ahead a little slow', () => {
    const behind = syncCorrection(1000, 950)
    expect(behind.kind).toBe('bend')
    expect(behind.rate).toBeGreaterThan(1)
    const ahead = syncCorrection(1000, 1050)
    expect(ahead.rate).toBeLessThan(1)
    // Never more than the most it is allowed to bend.
    expect(syncCorrection(1000, 1240).rate).toBeGreaterThanOrEqual(1 - SYNC_MAX_BEND)
  })

  it('moves a picture that has strayed too far to chase, rather than chasing it', () => {
    expect(syncCorrection(5000, 4000)).toEqual({ kind: 'seek', toMs: 5000, rate: 1 })
    expect(syncCorrection(5000, 6000)).toEqual({ kind: 'seek', toMs: 5000, rate: 1 })
  })

  it('closes a drift a long video builds up, frame by frame, without seeking', () => {
    // A picture clock 1% slow for a minute, corrected at 60 frames a second.
    let actual = 0
    let expected = 0
    let rate = 1
    let seeks = 0
    let worst = 0
    for (let frame = 0; frame < 60 * 60; frame++) {
      expected += 1000 / 60
      actual += (1000 / 60) * 0.99 * rate
      const action = syncCorrection(expected, actual)
      if (action.kind === 'seek') { actual = action.toMs; seeks++ }
      rate = action.rate
      worst = Math.max(worst, Math.abs(actual - expected))
    }
    expect(seeks).toBe(0)
    // Held inside a frame and a half of where it belongs, all minute long.
    expect(worst).toBeLessThan(25)
    expect(Math.abs(actual - expected)).toBeLessThan(25)
  })

  it('does not ask the element for a rate change too small to matter', () => {
    expect(rateWorthSetting(1, 1.001)).toBe(false)
    expect(rateWorthSetting(1, 1.01)).toBe(true)
  })
})

describe('reading the engine\'s clock across a round trip', () => {
  it('places each reading at its trip\'s midpoint and trusts the shortest trip', () => {
    const fit = fitClock([
      { sentAt: 100, receivedAt: 140, engineMs: 5_120, sessionId: 's1' },
      { sentAt: 1000, receivedAt: 1002, engineMs: 6_001, sessionId: 's1' }
    ])
    expect(fit).toEqual({ offset: 5000, rttMs: 2, sessionId: 's1' })
  })

  it('does not mix a replaced engine\'s readings with its successor\'s', () => {
    const fit = fitClock([
      { sentAt: 0, receivedAt: 1, engineMs: 90_000, sessionId: 'old' },
      { sentAt: 10, receivedAt: 20, engineMs: 15, sessionId: 'new' }
    ])
    expect(fit).toEqual({ offset: 0, rttMs: 10, sessionId: 'new' })
  })

  it('has nothing to say before a reading', () => {
    expect(fitClock([])).toBeNull()
  })
})
