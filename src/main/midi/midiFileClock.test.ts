// The real clock: never early, cancellable, and never re-entering the caller from inside its
// own request. How late it may be is the machine's, so the bound here is loose; what is held
// tight is that a wake does not fire before its moment.

import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { createHighResolutionClock } from './midiFileClock'

describe('the high-resolution clock', () => {
  it('wakes at or after the moment asked for, and close to it', async () => {
    const clock = createHighResolutionClock()
    const lateness: number[] = []
    for (const delay of [1, 5, 12, 30]) {
      const at = clock.now() + delay
      await new Promise<void>(resolve => clock.wakeAt(at, () => {
        lateness.push(clock.now() - at)
        resolve()
      }))
    }
    for (const late of lateness) {
      // A quarter of a millisecond is "on it": the wake fires when that little is left.
      expect(late).toBeGreaterThanOrEqual(-0.25)
      expect(late).toBeLessThan(50)
    }
  })

  it('never wakes a cancelled request', async () => {
    const clock = createHighResolutionClock()
    let woken = false
    const cancel = clock.wakeAt(clock.now() + 5, () => { woken = true })
    cancel()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(woken).toBe(false)
  })

  it('wakes a request that is already due on a later turn, not inside the request', async () => {
    const clock = createHighResolutionClock()
    let woken = false
    clock.wakeAt(clock.now() - 10, () => { woken = true })
    expect(woken).toBe(false)
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    expect(woken).toBe(true)
  })

  it('reads the process’s high-resolution clock by default', () => {
    const clock = createHighResolutionClock()
    const before = performance.now()
    const read = clock.now()
    expect(read).toBeGreaterThanOrEqual(before)
    expect(read - before).toBeLessThan(50)
  })
})
