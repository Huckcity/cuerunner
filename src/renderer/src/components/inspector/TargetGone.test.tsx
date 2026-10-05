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

describe('the cues a fade can be aimed at', () => {
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

  /** What the target select offers: the first select on either tab. */
  const offered = (): string[] =>
    [...container.querySelector('select')!.querySelectorAll('option')].map(option => option.textContent ?? '')

  it('are the audio cues: a fade moves a sound, and nothing else has one', () => {
    const cues = [
      { ...createCue('audio', '1'), id: 'a1', name: 'Walk-in' },
      { ...createCue('wait', '2'), id: 'w1', name: 'Count 8' },
      { ...createCue('group', '3'), id: 'g1', name: 'Act 1' },
      { ...createCue('audio', '4'), id: 'a2', name: 'Underscore' }
    ] as Cue[]
    const fade = { ...createCue('fade', '5'), id: 'f1' } as FadeCue
    useStore.setState({ cues: [...cues, fade] })
    act(() => { root.render(<FadeInspector cue={fade} />) })

    expect(offered()).toEqual(['— select —', '1 Walk-in', '4 Underscore'])
  })

  it('still shows a cue of another kind that the fade already names', () => {
    const wait = { ...createCue('wait', '2'), id: 'w1', name: 'Count 8' } as Cue
    const fade = { ...createCue('fade', '5'), id: 'f1', targetCueId: 'w1' } as FadeCue
    useStore.setState({ cues: [wait, fade] })
    act(() => { root.render(<FadeInspector cue={fade} />) })

    expect(offered()).toEqual(['— select —', '2 Count 8'])
    expect(container.querySelector<HTMLSelectElement>('select')?.value).toBe('w1')
  })

  it('names each cue in full, so two long names are still two entries', () => {
    const long = [
      { ...createCue('audio', '12'), id: 'a1', name: 'Act 2 Scene 3 underscore (long)' },
      { ...createCue('audio', '13'), id: 'a2', name: 'Act 2 Scene 3 underscore (short)' }
    ] as Cue[]
    const stop = { ...createCue('stop', '14'), id: 's1' } as StopCue
    useStore.setState({ cues: [...long, stop] })
    act(() => { root.render(<StopInspector cue={stop} />) })

    expect(offered()).toEqual([
      'All cues',
      '12 Act 2 Scene 3 underscore (long)',
      '13 Act 2 Scene 3 underscore (short)'
    ])
  })
})
