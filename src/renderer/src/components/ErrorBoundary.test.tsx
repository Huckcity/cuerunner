// The window must never be left empty by a render error: the boundary replaces the
// tree with an explanation and a reload.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ErrorBoundary } from './ErrorBoundary'

function Exploding(): never {
  throw new Error('render exploded')
}

describe('ErrorBoundary', () => {
  let container: HTMLDivElement
  let root: Root
  let consoleError: MockInstance

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    // React logs the caught error; the boundary is what is under test.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    consoleError.mockRestore()
  })

  it('replaces a render error with a recovery screen', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Exploding />
        </ErrorBoundary>
      )
    })

    expect(container.querySelector('.crash-screen')).not.toBeNull()
    expect(container.textContent).toContain('could not recover')
    expect(container.textContent).toContain('render exploded')
    expect(container.querySelector('.crash-screen-reload')).not.toBeNull()
  })

  it('renders children unchanged when nothing throws', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <p>show is running</p>
        </ErrorBoundary>
      )
    })

    expect(container.textContent).toBe('show is running')
    expect(container.querySelector('.crash-screen')).toBeNull()
  })
})
