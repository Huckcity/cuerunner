// The backlog exists because of a race that used to lose errors: the window subscribes
// a moment after it loads, so a failure during startup is reported before anyone is
// listening. These tests pin the two halves of the fix — nothing is lost, and nothing
// is delivered twice by accident.
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
