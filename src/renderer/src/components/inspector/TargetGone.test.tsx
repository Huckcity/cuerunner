// A cue that names other cues says so when one of them has been deleted: the target stays in
// its list as "— not in this show —", rather than vanishing from it or being read as a choice
// nobody made — "All cues" on a stop, nothing on a fade — on a cue that will reach nothing.
// And a show saved before a fade or a stop could name several reads its one target as a list
// of one, and is only rewritten in the list's spelling when the targets are edited.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StopInspector } from './StopInspector'
import { FadeInspector } from './FadeInspector'
import { useStore } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import type { Cue, FadeCue, StopCue } from '../../../../shared/cue'

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

/** The targets the list shows, as the operator reads them. */
const rows = (): string[] =>
  [...container.querySelectorAll('.target-row .target-text')].map(row => row.textContent ?? '')

/** What the picker that adds a target offers, after its own prompt. */
const offered = (): string[] =>
  [...container.querySelectorAll<HTMLOptionElement>('.target-list select option')]
    .map(option => option.textContent ?? '')
    .slice(1)

/** The stop's mode select: all cues, or the cues it names. */
const mode = (): string => {
  const select = container.querySelector<HTMLSelectElement>('#stop-target-mode')!
  return select.options[select.selectedIndex].textContent ?? ''
}

/** Picks a cue in the add picker, the way the operator does. */
function pick(id: string): void {
  const select = container.querySelector<HTMLSelectElement>('.target-list select')!
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, id)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('a target that is no longer in the show', () => {
  const audio = { ...createCue('audio'), id: 'a1', name: 'Walk-in' } as Cue

  it('is named as gone on a stop cue saved before lists, rather than read as "All cues"', () => {
    const stop = { ...createCue('stop'), id: 's1', targetCueId: 'deleted' } as StopCue
    useStore.setState({ cues: [stop] })
    act(() => { root.render(<StopInspector cue={stop} />) })
    expect(mode()).toBe('These cues')
    expect(rows()).toEqual(['— not in this show —'])
  })

  it('is named as gone on a fade cue saved before lists, rather than read as nothing chosen', () => {
    const fade = { ...createCue('fade'), id: 'f1', targetCueIds: undefined, targetCueId: 'deleted' } as FadeCue
    useStore.setState({ cues: [fade] })
    act(() => { root.render(<FadeInspector cue={fade} />) })
    expect(rows()).toEqual(['— not in this show —'])
  })

  it('is named as gone among the targets that are still there', () => {
    const fade = { ...createCue('fade'), id: 'f1', targetCueIds: ['a1', 'deleted'] } as FadeCue
    useStore.setState({ cues: [audio, fade] })
    act(() => { root.render(<FadeInspector cue={fade} />) })
    expect(rows()).toEqual(['1 Walk-in', '— not in this show —'])
  })

  it('offers no such entry while the target is there, or was never chosen', () => {
    const stopAll = { ...createCue('stop'), id: 's1' } as StopCue
    const stopOne = { ...createCue('stop'), id: 's2', targetCueId: 'a1' } as StopCue
    const fadeNone = { ...createCue('fade'), id: 'f1' } as FadeCue
    useStore.setState({ cues: [audio, stopAll, stopOne, fadeNone] })

    act(() => { root.render(<StopInspector cue={stopAll} />) })
    expect(mode()).toBe('All cues')
    expect(rows()).toEqual([])
    expect(container.textContent).not.toContain('not in this show')

    act(() => { root.render(<StopInspector cue={stopOne} />) })
    expect(mode()).toBe('These cues')
    expect(rows()).toEqual(['1 Walk-in'])
    expect(container.textContent).not.toContain('not in this show')

    act(() => { root.render(<FadeInspector cue={fadeNone} />) })
    expect(rows()).toEqual([])
    expect(container.textContent).toContain('No cue chosen')
    expect(container.textContent).not.toContain('not in this show')
  })
})

describe('the cues a fade can be aimed at', () => {
  it('are the cues with a level, and the groups that hold them', () => {
    const cues = [
      { ...createCue('audio', '1'), id: 'a1', name: 'Walk-in' },
      { ...createCue('wait', '2'), id: 'w1', name: 'Count 8' },
      { ...createCue('group', '3'), id: 'g1', name: 'Act 1' },
      { ...createCue('audio', '4'), id: 'a2', name: 'Underscore' },
      { ...createCue('light', '5'), id: 'l1', name: 'Warm wash' }
    ] as Cue[]
    const fade = { ...createCue('fade', '6'), id: 'f1' } as FadeCue
    useStore.setState({ cues: [...cues, fade] })
    act(() => { root.render(<FadeInspector cue={fade} />) })

    expect(offered()).toEqual(['1 Walk-in', '3 Act 1', '4 Underscore', '5 Warm wash'])
  })

  it('still shows a cue of another kind that the fade already names, and says it has no level', () => {
    const wait = { ...createCue('wait', '2'), id: 'w1', name: 'Count 8' } as Cue
    const fade = { ...createCue('fade', '5'), id: 'f1', targetCueIds: undefined, targetCueId: 'w1' } as FadeCue
    useStore.setState({ cues: [wait, fade] })
    act(() => { root.render(<FadeInspector cue={fade} />) })

    expect(rows()).toEqual(['2 Count 8'])
    expect(container.textContent).toContain('Nothing it names has a level to fade.')
  })

  it('does not offer a cue it already names, or itself', () => {
    const cues = [
      { ...createCue('audio', '1'), id: 'a1', name: 'Walk-in' },
      { ...createCue('audio', '2'), id: 'a2', name: 'Storm' }
    ] as Cue[]
    const fade = { ...createCue('fade', '3'), id: 'f1', targetCueIds: ['a1'] } as FadeCue
    useStore.setState({ cues: [...cues, fade] })
    act(() => { root.render(<FadeInspector cue={fade} />) })
    expect(offered()).toEqual(['2 Storm'])
  })

  it('names each cue in full, so two long names are still two entries', () => {
    const long = [
      { ...createCue('audio', '12'), id: 'a1', name: 'Act 2 Scene 3 underscore (long)' },
      { ...createCue('audio', '13'), id: 'a2', name: 'Act 2 Scene 3 underscore (short)' }
    ] as Cue[]
    const stop = { ...createCue('stop', '14'), id: 's1', targetCueId: undefined, targetCueIds: [] } as StopCue
    useStore.setState({ cues: [...long, stop] })
    act(() => { root.render(<StopInspector cue={stop} />) })

    expect(offered()).toEqual([
      '12 Act 2 Scene 3 underscore (long)',
      '13 Act 2 Scene 3 underscore (short)'
    ])
  })
})

describe('a show saved before a cue could name several', () => {
  it('is rewritten in the list’s spelling only when its targets are edited, with the old field taken away', () => {
    const audio = [
      { ...createCue('audio', '1'), id: 'a1', name: 'Walk-in' },
      { ...createCue('audio', '2'), id: 'a2', name: 'Storm' }
    ] as Cue[]
    const legacy = { ...createCue('fade', '3'), id: 'f1', targetCueIds: undefined, targetCueId: 'a1' } as FadeCue
    delete (legacy as Partial<FadeCue>).targetCueIds
    useStore.setState({ cues: [...audio, legacy] })
    act(() => { root.render(<FadeInspector cue={legacy} />) })

    // Shown as a list of one, and not touched by being shown.
    expect(rows()).toEqual(['1 Walk-in'])
    expect(useStore.getState().cues[2]).toBe(legacy)

    pick('a2')

    const edited = useStore.getState().cues[2] as FadeCue
    expect(edited.targetCueIds).toEqual(['a1', 'a2'])
    expect('targetCueId' in edited).toBe(false)
  })

  it('goes back to the single spelling every build reads when a stop is set to all cues', () => {
    const stop = { ...createCue('stop', '1'), id: 's1', targetCueId: undefined, targetCueIds: ['x'] } as StopCue
    delete (stop as Partial<StopCue>).targetCueId
    useStore.setState({ cues: [stop] })
    act(() => { root.render(<StopInspector cue={stop} />) })

    const select = container.querySelector<HTMLSelectElement>('#stop-target-mode')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, 'all')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const edited = useStore.getState().cues[0] as StopCue
    expect(edited.targetCueId).toBe('all')
    expect('targetCueIds' in edited).toBe(false)
  })
})
