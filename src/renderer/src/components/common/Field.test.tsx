// The two things a field owes the operator: the value is written when it should be, and
// the field says when that write took. Held here for both behaviours it is used in — a
// field that writes as it is typed (the inspector) and one that waits to be left (a
// setting that would move a listener on the way to a number) — and for the case that
// matters most: nothing to say when nothing changed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NumberField, TextField, SAVED_MS } from './Field'

/** A parent that holds the value the way the app does: what the field writes comes back. */
function TextHarness({ initial, onWrite, when }: {
  initial: string
  onWrite?: (value: string) => void
  when?: 'typed' | 'leave'
}) {
  const [value, setValue] = useState(initial)
  return (
    <TextField
      value={value}
      when={when}
      onValue={next => { onWrite?.(next); setValue(next) }}
    />
  )
}

function NumberHarness({ initial, onWrite, min, max, step, when }: {
  initial: number | null
  onWrite?: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  when?: 'typed' | 'leave'
}) {
  const [value, setValue] = useState(initial)
  return (
    <NumberField
      value={value}
      min={min}
      max={max}
      step={step}
      when={when}
      onValue={next => { onWrite?.(next); setValue(next) }}
    />
  )
}

describe('Field', () => {
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
    vi.useRealTimers()
  })

  function input(): HTMLInputElement {
    return container.querySelector<HTMLInputElement>('input')!
  }

  // Controlled inputs: setting the value through the prototype setter is what gets past
  // React's own tracker, so the dispatched event looks like a real keystroke.
  async function type(el: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function focus(el: HTMLElement): Promise<void> {
    await act(async () => { el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
  }

  async function leave(el: HTMLElement): Promise<void> {
    await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  }

  async function enter(el: HTMLElement): Promise<void> {
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  }

  /** The flash clearing itself is part of what it is: a state, not a permanent mark. */
  async function runOutTheFlash(): Promise<void> {
    await vi.waitFor(
      () => expect(input().getAttribute('data-saved')).toBeNull(),
      { timeout: SAVED_MS + 500 }
    )
  }

  it('writes what was typed when the field is left, and says it took', async () => {
    act(() => { root.render(<TextHarness initial="Walk-in" />) })

    await focus(input())
    await type(input(), 'Walk-out')
    await leave(input())

    expect(input().value).toBe('Walk-out')
    expect(input().getAttribute('data-saved')).toBe('true')

    await runOutTheFlash()
    expect(input().getAttribute('data-saved')).toBeNull()
  })

  it('says nothing when the value typed is the one it already had', async () => {
    act(() => { root.render(<TextHarness initial="Walk-in" />) })

    await focus(input())
    await type(input(), 'Walk-in')
    await leave(input())

    expect(input().getAttribute('data-saved')).toBeNull()
  })

  it('says nothing when a value typed away is typed back', async () => {
    const onWrite = vi.fn()
    act(() => { root.render(<TextHarness initial="2.5" onWrite={onWrite} />) })

    await focus(input())
    await type(input(), '3')
    await type(input(), '2.5')
    await leave(input())

    // The write happened — that is the inspector's business — and there is nothing to
    // confirm, because the field ends the session saying what it started saying.
    expect(onWrite).not.toHaveBeenCalled()
    expect(input().getAttribute('data-saved')).toBeNull()
  })

  it('writes as it is typed, and confirms on the way out', async () => {
    const onWrite = vi.fn()
    act(() => { root.render(<NumberHarness initial={2.5} step={0.1} when="typed" onWrite={onWrite} />) })

    await focus(input())
    await type(input(), '2.7')
    expect(onWrite).toHaveBeenLastCalledWith(2.7)

    await leave(input())
    expect(input().getAttribute('data-saved')).toBe('true')
  })

  it('takes Enter as leaving, flash and all', async () => {
    act(() => { root.render(<TextHarness initial="Act One" />) })

    await focus(input())
    await type(input(), 'Act Two')
    await enter(input())

    expect(input().value).toBe('Act Two')
    expect(input().getAttribute('data-saved')).toBe('true')
  })

  it('drops a number the field will not take, and puts the real value back', async () => {
    const onWrite = vi.fn()
    act(() => { root.render(<NumberHarness initial={30} min={5} max={3600} onWrite={onWrite} />) })

    await focus(input())
    await type(input(), '3')
    await leave(input())

    // Nothing was written, so there is nothing to confirm either.
    expect(onWrite).not.toHaveBeenCalled()
    expect(input().value).toBe('30')
    expect(input().getAttribute('data-saved')).toBeNull()
  })

  it('writes an integer field as a whole number', async () => {
    const onWrite = vi.fn()
    act(() => { root.render(<NumberHarness initial={2} when="typed" onWrite={onWrite} />) })

    await focus(input())
    await type(input(), '2.6')
    expect(onWrite).toHaveBeenLastCalledWith(3)
  })

  it('treats an emptied field as no value, and an empty one as empty', async () => {
    const onWrite = vi.fn()
    act(() => { root.render(<NumberHarness initial={2500} onWrite={onWrite} />) })

    await focus(input())
    await type(input(), '')
    await leave(input())
    expect(onWrite).toHaveBeenCalledWith(null)
    expect(input().value).toBe('')

    act(() => { root.render(<NumberHarness initial={null} />) })
    expect(input().value).toBe('')
  })

  it('says nothing when the value changed under it while nobody was typing', async () => {
    // Another cue selected, a reset pressed: the field is showing something else now, and
    // that is not this field's operator being told anything.
    act(() => { root.render(<TextField value="1" onValue={vi.fn()} />) })
    act(() => { root.render(<TextField value="2" onValue={vi.fn()} />) })

    await focus(input())
    await leave(input())

    expect(input().getAttribute('data-saved')).toBeNull()
  })
})