// The toolbar carries two trays of presses — the ones that add a cue, and the ones that
// open and shut groups — and both are about a cue list. In the scenes view there is no
// cue list on screen for them to act on.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

  it('names the show by its own name, which is the one the window title carries', () => {
    // A show kept in a file called something else: the toolbar used to draw the file's
    // name while the title bar drew the show's, and a rename moved only the title.
    useStore.setState({ workspaceName: 'Macbeth', workspacePath: '/shows/Macbeth v2.cuerunner', isDirty: false })
    render('cues')
    const name = (): HTMLElement => container.querySelector<HTMLElement>('.workspace-name-text')!
    expect(name().textContent).toBe('Macbeth')
    expect(document.title).toBe('Macbeth — Cuerunner')
    // The file is a hover away.
    expect(name().title).toContain('/shows/Macbeth v2.cuerunner')

    act(() => { useStore.getState().setWorkspaceName('The Scottish Play') })
    expect(name().textContent).toBe('The Scottish Play ●')
    expect(document.title).toBe('The Scottish Play ● — Cuerunner')
  })

  it('renames the show from the toolbar, and shows the new name there', () => {
    useStore.setState({ workspaceName: 'Macbeth', workspacePath: '/shows/Macbeth.cuerunner', isDirty: false })
    render('cues')
    act(() => {
      container.querySelector('.workspace-name-text')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    const field = container.querySelector<HTMLInputElement>('.workspace-name-input')!
    field.value = 'Hamlet'
    act(() => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })

    expect(useStore.getState().workspaceName).toBe('Hamlet')
    expect(container.querySelector('.workspace-name-text')?.textContent).toBe('Hamlet ●')
  })

  it('closes an open menu on Escape, and keeps the press from the transport', () => {
    render('cues')
    // The transport's binding, standing in: a window listener that would stop the show.
    const reachedWindow = vi.fn()
    window.addEventListener('keydown', reachedWindow)
    const press = (key: string): void => {
      act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
    }

    for (const [button, menu] of [['.toolbar-brand', '.file-menu'], ['.toolbar-more-btn', '.toolbar-more-menu']]) {
      act(() => container.querySelector<HTMLButtonElement>(button)!.click())
      expect(container.querySelector(menu), `${menu} did not open`).not.toBeNull()

      press('Escape')
      expect(container.querySelector(menu), `${menu} stayed open`).toBeNull()
      expect(reachedWindow, `Escape reached the transport behind ${menu}`).not.toHaveBeenCalled()
    }

    // With nothing open the press is the transport's again.
    press('Escape')
    expect(reachedWindow).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', reachedWindow)
  })

  it('lets every other key through an open menu: GO is pressed without looking', () => {
    render('cues')
    const reachedWindow = vi.fn()
    window.addEventListener('keydown', reachedWindow)
    act(() => container.querySelector<HTMLButtonElement>('.toolbar-brand')!.click())
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })) })

    expect(reachedWindow).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.file-menu')).not.toBeNull()
    window.removeEventListener('keydown', reachedWindow)
  })

  it('does not mark the show unsaved when its name field is opened and left as it was', () => {
    useStore.setState({ workspaceName: 'Macbeth', workspacePath: '/shows/Macbeth.cuerunner', isDirty: false })
    render('cues')
    act(() => {
      container.querySelector('.workspace-name-text')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    const field = container.querySelector<HTMLInputElement>('.workspace-name-input')!
    act(() => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })

    expect(useStore.getState().isDirty).toBe(false)
    expect(container.querySelector('.workspace-name-text')?.textContent).toBe('Macbeth')
  })

  it('adds a fade aimed at the selected cue as one edit, so one undo takes it away', () => {
    useStore.setState({ cues: [], selectedId: null, selectedIds: [], past: [], future: [] })
    act(() => { useStore.getState().addCue('audio') })
    const audio = useStore.getState().cues[0]
    act(() => { useStore.getState().updateCue(audio.id, { name: 'Walk-in' }) })
    const edits = useStore.getState().past.length
    render('cues')

    const fadeButton = [...container.querySelectorAll<HTMLButtonElement>('.toolbar-cue-btn')]
      .find(button => button.textContent === 'Fade')!
    act(() => fadeButton.click())

    const fade = useStore.getState().cues[1]
    expect(fade).toMatchObject({ type: 'fade', name: 'Fade Walk-in', targetCueId: audio.id })
    expect(useStore.getState().past.length).toBe(edits + 1)

    act(() => { useStore.getState().undo() })
    expect(useStore.getState().cues.map(cue => cue.type)).toEqual(['audio'])
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
