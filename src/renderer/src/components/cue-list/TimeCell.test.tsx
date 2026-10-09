// A list time cell edited where it stands: what it reads as a time, and what a press does.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TimeCell, parseCellTime } from './TimeCell'

describe('parseCellTime', () => {
  it('reads seconds, and minutes and seconds', () => {
    expect(parseCellTime('1.5')).toBe(1500)
    expect(parseCellTime(' 12 ')).toBe(12_000)
    expect(parseCellTime('1:30')).toBe(90_000)
    expect(parseCellTime('1:02.5')).toBe(62_500)
  })

  it('reads empty as no time at all', () => {
    expect(parseCellTime('')).toBe(0)
  })

  it('reads anything else as nothing to write', () => {
    expect(parseCellTime('soon')).toBeNull()
    expect(parseCellTime('-2')).toBeNull()
    expect(parseCellTime('1:75')).toBeNull()
    expect(parseCellTime('1.2.3')).toBeNull()
  })
})

describe('TimeCell', () => {
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

  function draw(editable: boolean, onCommit = vi.fn()) {
    act(() => {
      root.render(
        <TimeCell className="col-pre" ms={1500} editable={editable} label="Pre-wait" onCommit={onCommit}>1.5s</TimeCell>
      )
    })
    return onCommit
  }

  const cell = (): HTMLElement => container.querySelector('.col-pre')!
  const input = (): HTMLInputElement | null => container.querySelector('input')
  const doubleClick = (): void => {
    act(() => { cell().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
  }
  const key = (name: string): void => {
    act(() => { input()!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })) })
  }
  const type = (value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input(), value)
  }

  it('opens on a double-click with the time in seconds, and writes what Enter takes', () => {
    const onCommit = draw(true)
    doubleClick()
    expect(input()?.value).toBe('1.5')
    type('2:00')
    key('Enter')
    expect(onCommit).toHaveBeenCalledWith(120_000)
    expect(input()).toBeNull()
  })

  it('puts the time back on Escape, and writes nothing it cannot read or that did not change', () => {
    const onCommit = draw(true)
    doubleClick()
    type('9')
    key('Escape')
    expect(onCommit).not.toHaveBeenCalled()
    doubleClick()
    type('nonsense')
    key('Enter')
    doubleClick()
    key('Enter')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('does not open where the time is not the cue’s own to change', () => {
    draw(false)
    doubleClick()
    expect(input()).toBeNull()
  })
})
