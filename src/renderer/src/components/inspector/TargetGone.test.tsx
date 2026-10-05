// A cue that names another cue says so when that cue has been deleted. A select whose value
// matches none of its options draws the first one — "All cues" on a stop, "— select —" on a
// fade — which reads as a choice nobody made, on a cue that will reach nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StopInspector } from './StopInspector'
import { FadeInspector } from './FadeInspector'
import { useStore } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import type { Cue, FadeCue, StopCue } from '../../../../shared/cue'

describe('a target that is no longer in the show', () => {
  let container: HTMLDivElement
  let root: Root
  const audio = { ...createCue('audio'), id: 'a1', name: 'Walk-in' } as Cue

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

  /** What the target select is showing, as the operator reads it. */
  const shown = (): string => {
    const select = container.querySelector<HTMLSelectElement>('select')!
    return select.options[select.selectedIndex].textContent ?? ''
  }

  it('is named as gone on a stop cue, rather than read as "All cues"', () => {
    const stop = { ...createCue('stop'), id: 's1', targetCueId: 'deleted' } as StopCue
    useStore.setState({ cues: [stop] })
    act(() => { root.render(<StopInspector cue={stop} />) })
    expect(shown()).toBe('— not in this show —')
  })

  it('is named as gone on a fade cue, rather than read as nothing chosen', () => {
    const fade = { ...createCue('fade'), id: 'f1', targetCueId: 'deleted' } as FadeCue
    useStore.setState({ cues: [fade] })
    act(() => { root.render(<FadeInspector cue={fade} />) })
    expect(shown()).toBe('— not in this show —')
  })

  it('offers no such entry while the target is there, or was never chosen', () => {
    const stopAll = { ...createCue('stop'), id: 's1' } as StopCue
    const stopOne = { ...createCue('stop'), id: 's2', targetCueId: 'a1' } as StopCue
    const fadeNone = { ...createCue('fade'), id: 'f1' } as FadeCue
    useStore.setState({ cues: [audio, stopAll, stopOne, fadeNone] })

    act(() => { root.render(<StopInspector cue={stopAll} />) })
    expect(shown()).toBe('All cues')
    expect(container.textContent).not.toContain('not in this show')

    act(() => { root.render(<StopInspector cue={stopOne} />) })
    expect(shown()).toContain('Walk-in')
    expect(container.textContent).not.toContain('not in this show')

    act(() => { root.render(<FadeInspector cue={fadeNone} />) })
    expect(shown()).toBe('— select —')
    expect(container.textContent).not.toContain('not in this show')
  })
})
