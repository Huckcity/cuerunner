// The toolbar carries two trays of presses — the ones that add a cue, and the ones that
// open and shut groups — and both are about a cue list. In the scenes view there is no
// cue list on screen for them to act on.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Toolbar } from './Toolbar'
import { useStore } from '../../store'

let container: HTMLDivElement
let root: Root

function render(view: 'cues' | 'scenes'): void {
  act(() => {
    root.render(<Toolbar onOpenSettings={() => {}} view={view} onSwitchView={() => {}} />)
  })
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useStore.setState({ cues: [], selectedId: null })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Toolbar', () => {
  it('offers the cue presses and the list presses in the cue view', () => {
    render('cues')
    expect(container.querySelector('.toolbar-actions')?.hasAttribute('hidden')).toBe(false)
    expect(container.querySelector('.toolbar-list-actions')?.hasAttribute('hidden')).toBe(false)
    expect(container.querySelectorAll('.toolbar-cue-btn').length).toBeGreaterThan(0)
  })

  it('takes both trays away in the scenes view, where there is no list to act on', () => {
    render('scenes')
    // `hidden` is a UA `display: none`, and a class setting `display: flex` beats it —
    // which is how the list presses stayed on screen in the scenes view. The attribute is
    // the contract; Toolbar.css honours it for both trays.
    expect(container.querySelector('.toolbar-actions')?.hasAttribute('hidden')).toBe(true)
    expect(container.querySelector('.toolbar-list-actions')?.hasAttribute('hidden')).toBe(true)
  })

  it('draws a cue icon on every press that adds one, rather than a glyph', () => {
    render('cues')
    const buttons = [...container.querySelectorAll('.toolbar-cue-btn')]
    for (const button of buttons) {
      const icon = button.querySelector('.toolbar-cue-icon')
      expect(icon, `${button.textContent} has no icon`).not.toBeNull()
      expect(icon?.getAttribute('data-type')).toBeTruthy()
    }
  })

  it('marks the Pro cue types in the add menu, read from the declaration', () => {
    useStore.setState({ license: { state: 'unlicensed' } })
    render('cues')
    act(() => container.querySelector<HTMLButtonElement>('.toolbar-more-btn')!.click())

    const item = (label: string): HTMLButtonElement =>
      [...container.querySelectorAll<HTMLButtonElement>('.toolbar-more-menu-item')]
        .find(candidate => candidate.textContent?.startsWith(label))!

    // The class is `isProCueType`'s answer, so a type added to `PRO_CUE_TYPES` is locked
    // and marked here without the menu being edited.
    expect(item('Scene').getAttribute('data-locked')).toBe('true')
    expect(item('Scene').querySelector('.pro-mark')).not.toBeNull()
    expect(item('MIDI').getAttribute('data-locked')).not.toBe('true')
    expect(item('MIDI').querySelector('.pro-mark')).toBeNull()
  })

  it('marks which view the window is showing', () => {
    render('scenes')
    // Unlicensed, the Scenes press also carries its Pro mark, so the check is on the
    // name rather than on everything inside the button.
    const active = [...container.querySelectorAll('.toolbar-view-btn')]
      .filter(button => button.getAttribute('data-active') === 'true')
    expect(active.length).toBe(1)
    expect(active[0].textContent).toContain('Scenes')
  })
})
