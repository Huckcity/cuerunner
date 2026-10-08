import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CueList, refusedDropNotice } from './CueList'
import { useStore } from '../../store'

describe('what the window says about dropped files it did not take', () => {
  it('names the files and the formats that do play', () => {
    expect(refusedDropNotice(['voice.opus', 'jingle.wma']))
      .toBe('Not added — Cuerunner plays WAV, AIFF, FLAC, MP3, M4A and OGG audio, and MIDI files: voice.opus, jingle.wma')
  })

  it('counts the rest of a long drop rather than listing a folder', () => {
    const names = ['a.opus', 'b.opus', 'c.opus', 'd.opus', 'e.opus', 'f.opus', 'g.opus']
    expect(refusedDropNotice(names)).toMatch(/: a\.opus, b\.opus, c\.opus, d\.opus and 3 more$/)
  })
})

// The hint over the list is up while a file is being dragged across it, and the list keeps
// count of the enters and leaves to know when that is. A cue being reordered crosses the
// same rows and its drop never reaches the container, so counting it left the count one
// high for good — and the next file dragged over and away could not bring the hint down.
describe('the drop hint over the list', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => useStore.getState().loadWorkspace([], 'Untitled', null))
    act(() => root.render(<CueList />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const list = (): HTMLElement => container.querySelector('.cue-list-container')!
  const hint = (): HTMLElement | null => container.querySelector('.cue-list-drop-hint')

  /** One drag event over the list, carrying what the drag says it carries. */
  function drag(type: 'dragenter' | 'dragleave', types: string[]): void {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types, files: [] } })
    act(() => { list().dispatchEvent(event) })
  }

  const FILES = ['Files']
  const CUE = ['application/x-cue-render-index']

  it('is up while a file is over the list and gone when it leaves', () => {
    drag('dragenter', FILES)
    expect(hint()).not.toBeNull()
    expect(list().dataset.dragOver).toBe('true')

    drag('dragleave', FILES)
    expect(hint()).toBeNull()
    expect(list().dataset.dragOver).toBe('false')
  })

  it('still comes down after a cue was dragged across the list and dropped in it', () => {
    // A reorder as the container sees it: the rows it crossed, and no leave for the one it
    // was dropped on — the drop is taken by the list before it gets here.
    drag('dragenter', CUE)
    drag('dragenter', CUE)
    drag('dragleave', CUE)
    expect(hint()).toBeNull()

    drag('dragenter', FILES)
    expect(hint()).not.toBeNull()
    drag('dragleave', FILES)
    expect(hint()).toBeNull()
    expect(list().dataset.dragOver).toBe('false')
  })

  it('counts the rows a file crosses, so the hint holds until the last of them is left', () => {
    drag('dragenter', FILES)
    drag('dragenter', FILES)
    drag('dragleave', FILES)
    expect(hint()).not.toBeNull()
    drag('dragleave', FILES)
    expect(hint()).toBeNull()
  })
})
