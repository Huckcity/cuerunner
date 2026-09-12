// The scheduler's whole point: a task's time is the time it was given, and the tick
// only decides when to look — never when a cue is due.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SampleScheduler, SCHEDULER_LOOKAHEAD_MS } from './scheduler'

describe('SampleScheduler', () => {
  let now = 0
  let callbacks: Array<() => void> = []
  let scheduler: SampleScheduler

  const tick = (): void => { for (const cb of callbacks) cb() }

  beforeEach(() => {
    now = 1000
    callbacks = []
    scheduler = new SampleScheduler(
      () => now,
      cb => { callbacks.push(cb); return () => { callbacks = callbacks.filter(c => c !== cb) } }
    )
  })

  it('dispatches a task when the clock reaches its time', () => {
    const due = vi.fn()
    scheduler.schedule({ at: 1100, due })

    expect(due).not.toHaveBeenCalled()
    now = 1100
    tick()
    expect(due).toHaveBeenCalledTimes(1)
  })

  it('dispatches the early phase once the time is within the lookahead', () => {
    const early = vi.fn()
    scheduler.schedule({ at: 2000, early })

    now = 2000 - SCHEDULER_LOOKAHEAD_MS - 1
    tick()
    expect(early).not.toHaveBeenCalled()

    now = 2000 - SCHEDULER_LOOKAHEAD_MS
    tick()
    expect(early).toHaveBeenCalledTimes(1)

    // Once is once: later ticks must not send the command again.
    now = 1990
    tick()
    expect(early).toHaveBeenCalledTimes(1)
  })

  it('dispatches a task that is already due as soon as it is scheduled', () => {
    const due = vi.fn()
    scheduler.schedule({ at: 900, due })
    expect(due).toHaveBeenCalledTimes(1)
  })

  it('runs several tasks that come due in one tick in their scheduled order', () => {
    const order: string[] = []
    scheduler.schedule({ at: 1500, due: () => order.push('later') })
    scheduler.schedule({ at: 1400, due: () => order.push('earlier') })

    now = 1500
    tick()
    expect(order).toEqual(['earlier', 'later'])
  })

  it('an early-only task is done once its command has gone out', () => {
    const early = vi.fn()
    const id = scheduler.schedule({ at: 1700, early })
    now = 1700
    tick()
    expect(early).toHaveBeenCalledTimes(1)
    // Nothing left behind that a cancel could find, and no second dispatch.
    scheduler.cancel(id)
    tick()
    expect(early).toHaveBeenCalledTimes(1)
  })

  it('cancel removes a task before it fires', () => {
    const due = vi.fn()
    const id = scheduler.schedule({ at: 1100, due })
    scheduler.cancel(id)

    now = 1200
    tick()
    expect(due).not.toHaveBeenCalled()
  })

  it('cancelAll clears every pending task', () => {
    const due = vi.fn()
    scheduler.schedule({ at: 1100, due })
    scheduler.schedule({ at: 1200, due })
    scheduler.cancelAll()

    now = 2000
    tick()
    expect(due).not.toHaveBeenCalled()
  })

  it('does not touch a task whose time is still beyond the lookahead', () => {
    // A stall in the tick loop must not pull work forward: the task is only reachable
    // when its own time is within the horizon.
    const early = vi.fn()
    const due = vi.fn()
    scheduler.schedule({ at: 9000, early, due })

    now = 1500
    tick()
    now = 8500
    tick()
    expect(early).not.toHaveBeenCalled()
    expect(due).not.toHaveBeenCalled()

    now = 9000
    tick()
    expect(early).toHaveBeenCalledTimes(1)
    expect(due).toHaveBeenCalledTimes(1)
  })
})
