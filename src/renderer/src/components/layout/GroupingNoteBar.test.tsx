// The grouping-repair bar is the only place an operator finds out that the grouping on
// screen is not what they saved. What matters is that it says how many repairs were
// made, that the list names each one against its cue, that a new load closes the list
// rather than leaving the last show's rows up, and that the bar goes away with the
// repairs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { GroupingNoteBar } from './GroupingNoteBar'
import { useStore } from '../../store'
import type { Cue } from '../../../../shared/cue'
import type { LoadNote } from '../../../../shared/workspace'

const notes: LoadNote[] = [
  {
    cueId: 'o1',
    kind: 'missing-group',
    detail: 'it has no group in this file: still fires with the show, at the top level'
  },
  {
    cueId: 'g1',
    kind: 'reordered',
    detail: 'its children were gathered into one block behind it'
  }
]

function waitCue(id: string, number: string, name: string): Cue {
  return {
    id, number, name, type: 'wait', colorLabel: 'none', parentId: null,
    preWait: 0, postWait: 0, timelineOffset: 0, duration: 1000,
    advance: 'none', isArmed: true, notes: ''
  }
}

describe('GroupingNoteBar', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({
      cues: [waitCue('o1', '3', 'Walk-in'), waitCue('g1', '4', 'Band')],
      loadNotes: notes
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(): Promise<void> {
    await act(async () => { root.render(<GroupingNoteBar />) })
  }

  async function openList(): Promise<void> {
    await act(async () => {
      ;(container.querySelector('.grouping-note-review') as HTMLButtonElement).click()
    })
  }

  it('states how many repairs were made, and lists each against its cue', async () => {
    await render()

    const bar = container.querySelector('.grouping-note-bar')
    expect(bar?.textContent).toContain(
      'The cue grouping in this show was repaired on load (2 changes).'
    )
    expect(bar?.getAttribute('data-count')).toBe('2')

    await openList()

    const rows = [...container.querySelectorAll('.grouping-note-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('3 Walk-in')
    expect(rows[0].textContent).toContain('still fires with the show, at the top level')
    expect(rows[1].textContent).toContain('4 Band')
    expect(rows[1].textContent).toContain('one block behind it')
    // The blurb describes the state the repair is really in: in the session, not the file.
    expect(container.querySelector('.grouping-note-blurb')?.textContent)
      .toContain('The file on disk is unchanged')

    await act(async () => {
      ;(container.querySelector('.grouping-note-close') as HTMLButtonElement).click()
    })
    expect(container.querySelector('.grouping-note-dialog')).toBeNull()
    // The bar stays until a save writes the repair; only the list was dismissed.
    expect(container.querySelector('.grouping-note-bar')).not.toBeNull()
  })

  it('closes from Escape, its ✕ and the backdrop', async () => {
    await render()

    await openList()
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(container.querySelector('.grouping-note-dialog')).toBeNull()

    await openList()
    await act(async () => {
      ;(container.querySelector('.grouping-note-dismiss') as HTMLButtonElement).click()
    })
    expect(container.querySelector('.grouping-note-dialog')).toBeNull()

    // The list is read-only, so a press on the backdrop outside it is a dismissal — the
    // same way the missing-media list behaves.
    await openList()
    await act(async () => {
      container.querySelector<HTMLElement>('.grouping-note-overlay')!.click()
    })
    expect(container.querySelector('.grouping-note-dialog')).toBeNull()
  })

  it('closes the list on any new load, not only when the repairs become none', async () => {
    await render()
    await openList()
    expect(container.querySelector('.grouping-note-dialog')).not.toBeNull()

    // A second damaged show arrives with a different report: the first show's rows must
    // not stay up over it.
    await act(async () => {
      useStore.getState().setLoadNotes([notes[0]])
    })

    expect(container.querySelector('.grouping-note-dialog')).toBeNull()
    expect(container.querySelector('.grouping-note-bar')?.textContent).toContain('(1 change)')
  })

  it('shows nothing when the load had nothing to repair', async () => {
    useStore.setState({ loadNotes: [] })
    await render()

    expect(container.querySelector('.grouping-note-bar')).toBeNull()
  })

  it('falls back to the cue id when the cue is no longer in the show', async () => {
    useStore.setState({
      cues: [],
      loadNotes: [{
        cueId: 'gone',
        kind: 'cycle',
        detail: 'in a loop of groups: returned to the top level'
      }]
    })
    await render()
    await openList()

    expect(container.querySelector('.grouping-note-row')?.textContent).toContain('gone')
  })
})
