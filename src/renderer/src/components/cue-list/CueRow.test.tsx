// A row says what its cue's last run did when that was a failure. GO moves the selection
// on as it fires, so by the time a cue fails the inspector is showing the next one: the
// row is the only part of the cue still on screen.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CueRow } from './CueRow'
import { createCue } from '../../utils/cueDefaults'
import { useStore, type RunningCue } from '../../store'

describe('CueRow — a failed run', () => {
  let container: HTMLDivElement
  let root: Root
  const cue = { ...createCue('network'), name: 'Trigger Video' }

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

  function draw(failure: string | null, runState: RunningCue | null = null): void {
    act(() => {
      root.render(
        <CueRow
          cue={cue}
          depth={0}
          isSelected={false}
          runState={runState}
          failure={failure}
          onClick={() => {}}
          onContextMenu={() => {}}
          renamingId={null}
        />
      )
    })
  }

  const pill = (): HTMLElement | null => container.querySelector('.failed-pill')
  const row = (): HTMLElement => container.querySelector('.cue-row')!

  it('marks the row, with the runner\'s reason a hover away', () => {
    draw('connect ECONNREFUSED 127.0.0.1:8080')
    expect(pill()?.textContent).toBe('failed')
    expect(pill()?.title).toBe('Last run failed: connect ECONNREFUSED 127.0.0.1:8080')
    expect(row().dataset.failed).toBe('true')
  })

  it('carries its whole number in a tooltip, for a number the column has to cut short', () => {
    draw(null)
    const number = container.querySelector<HTMLElement>('.cue-number')!
    expect(number.textContent).toBe(cue.number)
    expect(number.title).toBe(cue.number)
  })

  it('says nothing about a cue that has not failed', () => {
    draw(null)
    expect(pill()).toBeNull()
    expect(row().dataset.failed).toBe('false')
  })

  it('stands down while the cue is running again: the mark is about the last run', () => {
    draw('request failed', { cueId: cue.id, state: 'playing', startedAt: Date.now(), progress: 0 })
    expect(pill()).toBeNull()
    expect(row().dataset.failed).toBe('false')
  })
})

describe('CueRow — renaming', () => {
  let container: HTMLDivElement
  let root: Root
  const cue = { ...createCue('wait'), name: 'Count 8' }

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ cues: [cue], isDirty: false, past: [], future: [] })
    act(() => {
      root.render(
        <CueRow cue={cue} depth={0} isSelected runState={null}
          onClick={() => {}} onContextMenu={() => {}} renamingId={null} />
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  /** Opens the name field the way a double-click on a selected row does. */
  function openField(): HTMLInputElement {
    act(() => {
      container.querySelector('.cue-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    return container.querySelector<HTMLInputElement>('.name-edit')!
  }

  const leave = (field: HTMLInputElement): void => {
    act(() => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  }

  it('leaves the show clean when the field is opened and left as it was', () => {
    leave(openField())
    expect(useStore.getState().isDirty).toBe(false)
    expect(useStore.getState().past).toHaveLength(0)
  })

  it('writes a name that changed, as one edit', () => {
    const field = openField()
    field.value = 'Count 16'
    leave(field)
    expect(useStore.getState().cues[0].name).toBe('Count 16')
    expect(useStore.getState().isDirty).toBe(true)
    expect(useStore.getState().past).toHaveLength(1)
  })
})
