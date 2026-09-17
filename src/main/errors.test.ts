// The backlog exists because of a race that used to lose errors: the window subscribes
// a moment after it loads, so a failure during startup is reported before anyone is
// listening. These tests pin the two halves of the fix — nothing is lost, and nothing is
// delivered twice by accident — and the counting that lets one thing going wrong in a
// loop be one entry whose count climbs rather than twenty copies.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { drainMainErrors, onMainError, reportMainError } from './errors'

describe('main error reporting', () => {
  beforeEach(() => {
    // Silence the reporter: the tests are about delivery, not about stdout.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Each test starts from an empty backlog.
    drainMainErrors()
  })

  it('keeps a failure that was reported before anything was listening', () => {
    reportMainError('[main] boom during startup')

    expect(drainMainErrors()).toEqual(['[main] boom during startup'])
  })

  it('hands a failure to a live listener as it happens', () => {
    const heard: string[] = []
    onMainError(message => heard.push(message))

    reportMainError('[main] boom during the show')

    expect(heard).toEqual(['[main] boom during the show'])
  })

  it('stops delivering to a listener that has unsubscribed', () => {
    const heard: string[] = []
    const off = onMainError(message => heard.push(message))
    off()

    reportMainError('[main] after unsubscribing')

    expect(heard).toEqual([])
  })

  it('empties the backlog when it is drained, so nothing is logged twice', () => {
    reportMainError('first')
    reportMainError('second')

    expect(drainMainErrors()).toEqual(['first', 'second'])
    expect(drainMainErrors()).toEqual([])
  })

  it('raises the count of the entry a repeat names instead of adding another one', () => {
    const heard: string[] = []
    onMainError(message => heard.push(message))

    // The same fact three times, reported under the key the caller gave it: the key is
    // the fact, not the rendered text, so every occurrence finds the one entry.
    for (let i = 0; i < 3; i++) {
      reportMainError("[main] audio engine sent an unrecognised event type 'fly'", 'audio-event-type:fly')
    }

    // The live listener sees every occurrence: the first as written, then the count
    // climbing — that is what an operator watches in the log.
    expect(heard).toEqual([
      "[main] audio engine sent an unrecognised event type 'fly'",
      "[main] audio engine sent an unrecognised event type 'fly' (×2)",
      "[main] audio engine sent an unrecognised event type 'fly' (×3)"
    ])
    // The backlog holds the fact once, with its count in the text the drain carries.
    expect(drainMainErrors()).toEqual(["[main] audio engine sent an unrecognised event type 'fly' (×3)"])
  })

  it('does not let one thing going wrong in a loop spend the backlog', () => {
    for (let i = 0; i < 40; i++) reportMainError('[main] the same failure', 'same-failure')

    const drained = drainMainErrors()
    expect(drained).toHaveLength(1)
    expect(drained[0]).toBe('[main] the same failure (×40)')
  })

  it('keeps the newest failures when a failure loop runs long', () => {
    for (let i = 0; i < 25; i++) reportMainError(`failure ${i}`)

    const drained = drainMainErrors()
    expect(drained).toHaveLength(20)
    expect(drained[0]).toBe('failure 5')
    expect(drained[19]).toBe('failure 24')
  })

  it('still records a failure when one listener throws', () => {
    const heard: string[] = []
    onMainError(() => { throw new Error('this listener is broken') })
    onMainError(message => heard.push(message))

    reportMainError('[main] with a broken listener')

    expect(heard).toEqual(['[main] with a broken listener'])
    expect(drainMainErrors()).toEqual(['[main] with a broken listener'])
  })
})
