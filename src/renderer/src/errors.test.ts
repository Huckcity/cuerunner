// Errors that escape React and the engine still have to reach the operator: a packaged
// build has no visible console, so the session log is the surface.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { installRuntimeErrorReporting } from './errors'
import { useStore } from './store'

describe('runtime error reporting', () => {
  let consoleError: MockInstance

  beforeEach(() => {
    installRuntimeErrorReporting()
    useStore.setState({ log: [] })
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => consoleError.mockRestore())

  const loggedMessages = (): string[] => useStore.getState().log.map(entry => entry.message)

  it('records an unhandled promise rejection', () => {
    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = new Error('promise exploded')
    window.dispatchEvent(event)

    expect(loggedMessages()).toContain('Unhandled rejection: promise exploded')
  })

  it('records an error thrown outside a render', () => {
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'timer exploded',
      error: new Error('timer exploded')
    }))

    expect(loggedMessages()).toContain('Unhandled error: timer exploded')
  })

  it('ignores resource load failures, which carry neither an error nor a message', () => {
    window.dispatchEvent(new Event('error'))

    expect(loggedMessages()).toEqual([])
  })
})
