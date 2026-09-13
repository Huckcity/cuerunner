import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LogPanel } from './LogPanel'
import { useStore } from '../../store'

describe('LogPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ log: [] })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const count = (): string | null | undefined => container.querySelector('.log-count')?.textContent

  it('counts entries the way they are said', () => {
    act(() => { root.render(<LogPanel onClose={() => {}} />) })
    expect(count()).toBe('empty')

    act(() => { useStore.getState().appendLog([{ level: 'info', message: 'started' }]) })
    expect(count()).toBe('1 entry')

    act(() => { useStore.getState().appendLog([{ level: 'info', message: 'completed' }]) })
    expect(count()).toBe('2 entries')
  })
})
