// The toolbar carries two trays of presses — the ones that add a cue, and the ones that
// open and shut groups — and both are about a cue list. In the scenes view there is no
// cue list on screen for them to act on.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Toolbar } from './Toolbar'
import { useStore } from '../../store'

let container: HTMLDivElement
let root: Root
/** Stable across renders: a new function each time would itself be a reason to redraw. */
const noop = (): void => {}

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

  it('keeps the unsaved dot outside the name, so a name cut short does not take it', () => {
    // The name is the one part of the toolbar that gives when the window is narrow or the
    // name is long, and it gives by ellipsis. The dot is not part of what may be cut.
    useStore.setState({ workspaceName: 'The Complete Works (Abridged)', workspacePath: null, isDirty: true })
    render('cues')
    const label = container.querySelector<HTMLElement>('.workspace-name-label')!
    const dot = container.querySelector<HTMLElement>('.dirty-dot')!
    expect(label.textContent).toBe('The Complete Works (Abridged)')
    expect(label.contains(dot)).toBe(false)
    expect(dot.parentElement).toBe(label.parentElement)
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
    expect(fade).toMatchObject({ type: 'fade', name: 'Fade Walk-in', targetCueIds: [audio.id] })
    expect(useStore.getState().past.length).toBe(edits + 1)

    act(() => { useStore.getState().undo() })
    expect(useStore.getState().cues.map(cue => cue.type)).toEqual(['audio'])
  })

  it('aims a fade at a selected Light cue too: its intensity is a level', () => {
    useStore.setState({ cues: [], selectedId: null, selectedIds: [], past: [], future: [] })
    act(() => { useStore.getState().addCue('light') })
    const light = useStore.getState().cues[0]
    render('cues')

    const fadeButton = [...container.querySelectorAll<HTMLButtonElement>('.toolbar-cue-btn')]
      .find(button => button.textContent === 'Fade')!
    act(() => fadeButton.click())

    expect(useStore.getState().cues[1]).toMatchObject({ type: 'fade', name: 'Fade Light Cue', targetCueIds: [light.id] })
  })

  it('leaves a fade un-aimed when the selected cue has no sound to fade', () => {
    useStore.setState({ cues: [], selectedId: null, selectedIds: [], past: [], future: [] })
    act(() => { useStore.getState().addCue('wait') })
    render('cues')

    const fadeButton = [...container.querySelectorAll<HTMLButtonElement>('.toolbar-cue-btn')]
      .find(button => button.textContent === 'Fade')!
    act(() => fadeButton.click())

    expect(useStore.getState().cues[1]).toMatchObject({ type: 'fade', name: 'Fade Cue', targetCueIds: [] })
  })

  it('is not redrawn for a write to the store that is not its own', () => {
    // The toolbar read the store whole, so every log line, show event and row lighting up
    // drew it again — at the rate a busy show writes.
    let commits = 0
    useStore.setState({ workspaceName: 'Untitled', workspacePath: null, isDirty: false })
    act(() => {
      root.render(
        <Profiler id="toolbar" onRender={() => { commits++ }}>
          <Toolbar onOpenSettings={noop} view="cues" onSwitchView={noop} />
        </Profiler>
      )
    })
    const drawn = commits

    act(() => {
      for (let i = 0; i < 20; i++) useStore.getState().appendLog([{ level: 'info', message: `line ${i}` }])
      useStore.getState().setRunning('c1', { cueId: 'c1', state: 'playing', startedAt: 0, progress: 0 })
      useStore.getState().setNotice('nothing to do with the toolbar')
    })
    expect(commits).toBe(drawn)

    // And it still follows what it does show.
    act(() => { useStore.getState().setWorkspaceName('Twelfth Night') })
    expect(commits).toBeGreaterThan(drawn)
    expect(container.querySelector('.workspace-name-text')?.textContent).toContain('Twelfth Night')
  })

  it('marks which view the window is showing', () => {
    render('scenes')
    const active = [...container.querySelectorAll('.toolbar-view-btn')]
      .filter(button => button.getAttribute('data-active') === 'true')
    expect(active.length).toBe(1)
    expect(active[0].textContent).toContain('Scenes')
  })
})
