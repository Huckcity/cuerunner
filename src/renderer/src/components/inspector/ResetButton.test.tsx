// The reset arrow is the only affordance that says "this field no longer holds the
// value a new cue would have", so its two states are what the inspector e2e leans on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ResetButton } from './ResetButton'

describe('ResetButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(value: unknown, defaultValue: unknown): { button: HTMLButtonElement; onReset: ReturnType<typeof vi.fn> } {
    const onReset = vi.fn()
    act(() => root.render(
      <ResetButton label="Rate" value={value} defaultValue={defaultValue} onReset={onReset} />
    ))
    return { button: container.querySelector('button')!, onReset }
  }

  it('is inert while the field holds its default', () => {
    const { button, onReset } = render(1, 1)

    expect(button.disabled).toBe(true)
    expect(button.dataset.default).toBe('true')
    button.click()
    expect(onReset).not.toHaveBeenCalled()
  })

  it('arms itself once the field differs from the default, and says which field it resets', () => {
    const { button, onReset } = render(0.5, 1)

    expect(button.disabled).toBe(false)
    expect(button.dataset.default).toBe('false')
    expect(button.title).toBe('Reset Rate to default')

    act(() => { button.click() })
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('treats a null default as a value, not as unset', () => {
    const { button } = render(1.5, null)
    expect(button.disabled).toBe(false)
  })
})
