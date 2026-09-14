// The transport bindings are what run the show from the keyboard, so what is tested here
// is the one rule that keeps them out of the way: while a modal panel is up it owns the
// keyboard, and Space and Escape do nothing to the cues behind it.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useKeyboard } from './useCueRunner'
import { useModal } from './useModal'
import { useStore } from '../store'

/** A surface that binds the transport keys, with or without a modal over it. */
function Host({ modal }: { modal: boolean }) {
  useKeyboard(go, stop, panic)
  return modal ? <Panel /> : null
}

/** Stands in for any modal panel: registering is all it has to do. */
function Panel() {
  useModal()
  return null
}

let go: Mock<() => void>
let stop: Mock<() => void>
let panic: Mock<() => void>

function press(init: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { ...init, cancelable: true }))
  })
}

describe('useKeyboard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    go = vi.fn()
    stop = vi.fn()
    panic = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    useStore.setState({ modals: 0 })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('runs the show from the keyboard when nothing is in the way', () => {
    act(() => root.render(<Host modal={false} />))

    press({ code: 'Space' })
    press({ code: 'Escape' })
    press({ code: 'Escape', shiftKey: true })

    expect(go).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(panic).toHaveBeenCalledTimes(1)
  })

  it('stands down while a modal panel is up, and comes back when it closes', () => {
    act(() => root.render(<Host modal />))
    expect(useStore.getState().modals).toBe(1)

    press({ code: 'Space' })
    press({ code: 'Escape' })

    expect(go).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()

    act(() => root.render(<Host modal={false} />))
    expect(useStore.getState().modals).toBe(0)

    press({ code: 'Space' })
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('still leaves a field alone whatever else is going on', () => {
    act(() => root.render(<Host modal={false} />))
    const field = document.createElement('input')
    document.body.append(field)

    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))
    })
    field.remove()

    expect(go).not.toHaveBeenCalled()
  })
})
