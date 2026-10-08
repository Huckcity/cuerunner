import { describe, expect, it, vi } from 'vitest'
import { EngineClock } from './engineClock'

describe('the engine clock, as an output sees it', () => {
  it('runs on the window\'s own clock until a reading arrives, then on the engine\'s', () => {
    let local = 1000
    const clock = new EngineClock(async () => null, () => {}, () => local)
    expect(clock.now()).toBe(1000)
    expect(clock.settled()).toBe(false)
    clock.accept({ sentAt: 1000, receivedAt: 1002, engineMs: 50_001, sessionId: 's1' })
    expect(clock.settled()).toBe(true)
    local = 2001
    expect(clock.now()).toBe(51_001)
    expect(clock.toEngine(1001)).toBe(50_001)
  })

  it('moves every picture by the difference when the engine is replaced', () => {
    const rebase = vi.fn()
    const clock = new EngineClock(async () => null, rebase, () => 0)
    clock.accept({ sentAt: 0, receivedAt: 0, engineMs: 90_000, sessionId: 'old' })
    clock.accept({ sentAt: 10, receivedAt: 10, engineMs: 90_010, sessionId: 'old' })
    expect(rebase).not.toHaveBeenCalled()
    // The new engine counts from zero: the same instant is 90 000 ms earlier on it.
    clock.accept({ sentAt: 20, receivedAt: 20, engineMs: 20, sessionId: 'new' })
    expect(rebase).toHaveBeenCalledWith(-90_000)
  })

  it('reads the engine through its bridge, placing the answer at the trip\'s midpoint', async () => {
    let local = 0
    const clock = new EngineClock(async () => {
      local += 10
      return { clockMs: 5005, sessionId: 's1' }
    }, () => {}, () => local)
    await clock.poll()
    clock.stop()
    expect(clock.toEngine(5)).toBe(5005)
  })
})
