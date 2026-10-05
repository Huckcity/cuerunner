// A wait's length is typed in seconds, like every other length in the inspector. It was
// the one field in milliseconds: a 5 typed there, by somebody who had just set a
// five-second pre-wait one tab over, was a wait of five thousandths of a second.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WaitInspector } from './WaitInspector'
import { useStore } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import type { WaitCue } from '../../../../shared/cue'

describe('WaitInspector', () => {
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

  function show(duration: number): HTMLInputElement {
    const cue = { ...createCue('wait'), id: 'w1', duration } as WaitCue
    useStore.setState({ cues: [cue] })
    act(() => { root.render(<WaitInspector cue={cue} />) })
    return container.querySelector<HTMLInputElement>('input[type="number"]')!
  }

  /** Types into the field the way React hears it. */
  function type(field: HTMLInputElement, text: string): void {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(field, text)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('shows the length in seconds, and says so', () => {
    const field = show(2000)
    expect(field.value).toBe('2')
    expect(container.querySelector('label')?.textContent).toBe('Duration (s)')
  })

  it('writes what is typed as seconds: 5 is five seconds', () => {
    type(show(2000), '5')
    expect(useStore.getState().cues[0].duration).toBe(5000)
  })

  it('keeps a wait exact to the hundredth of a second', () => {
    type(show(2000), '0.15')
    expect(useStore.getState().cues[0].duration).toBe(150)
  })

  it('shows a length an older show holds to the millisecond as it is', () => {
    expect(show(1234).value).toBe('1.234')
  })
})
