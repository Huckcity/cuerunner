// Show mode: what each card says about where its cue stands, and that the view reads the
// show without offering anything that edits it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ShowModeView, cardState } from './ShowModeView'
import { useStore, type RunningCue } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import type { Cue } from '../../../../shared/cue'

vi.mock('../../engine/audioEngineClient')

const run = (cueId: string, state: RunningCue['state']): RunningCue => ({ cueId, state, startedAt: Date.now(), progress: 0 })

describe('cardState', () => {
  it('reads cues before the one GO fires as done, it as next, and those after as ready', () => {
    expect(cardState(0, 1, undefined)).toBe('done')
    expect(cardState(1, 1, undefined)).toBe('next')
    expect(cardState(2, 1, undefined)).toBe('ready')
  })

  it('says a cue is running, or in a wait, wherever it stands', () => {
    expect(cardState(0, 2, run('x', 'playing'))).toBe('running')
    expect(cardState(3, 2, run('x', 'pre-wait'))).toBe('pre-wait')
    expect(cardState(3, 2, run('x', 'post-wait'))).toBe('post-wait')
  })

  it('reads everything as done once the show has run off its end', () => {
    expect(cardState(0, -1, undefined)).toBe('done')
    expect(cardState(4, -1, undefined)).toBe('done')
  })
})

describe('ShowModeView', () => {
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
    useStore.setState({ cues: [], running: new Map(), selectedId: null })
  })

  function cue(type: Cue['type'], id: string, patch: Partial<Cue> = {}): Cue {
    return { ...createCue(type, id), id, name: `Cue ${id}`, ...patch } as Cue
  }

  it('draws a card per cue in large type, with the note’s first line and its state', () => {
    useStore.setState({
      cues: [cue('wait', '1'), cue('memo', '2', { notes: '\nHold for the bow\nthen house' }), cue('wait', '3')],
      selectedId: '2',
      running: new Map([['1', run('1', 'playing')]])
    })
    act(() => { root.render(<ShowModeView onExit={() => {}} />) })
    const cards = [...container.querySelectorAll<HTMLElement>('.show-card')]
    expect(cards.map(card => card.dataset.state)).toEqual(['running', 'next', 'ready'])
    expect(cards[1].querySelector('.show-card-note')?.textContent).toBe('Hold for the bow')
    expect(cards[1].querySelector('.show-card-state')?.textContent).toBe('Next')
  })

  it('says a disarmed cue is disarmed rather than ready', () => {
    useStore.setState({ cues: [cue('wait', '1'), cue('wait', '2', { isArmed: false })], selectedId: '1', running: new Map() })
    act(() => { root.render(<ShowModeView onExit={() => {}} />) })
    const second = container.querySelectorAll<HTMLElement>('.show-card')[1]
    expect(second.querySelector('.show-card-state')?.textContent).toBe('Disarmed')
  })

  it('offers nothing that edits the show: no field, no row menu, only the way out', () => {
    const onExit = vi.fn()
    useStore.setState({ cues: [cue('wait', '1')], selectedId: '1', running: new Map() })
    act(() => { root.render(<ShowModeView onExit={onExit} />) })
    expect(container.querySelectorAll('input, textarea, select')).toHaveLength(0)
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons).toHaveLength(1)
    act(() => { buttons[0].click() })
    expect(onExit).toHaveBeenCalled()
  })
})
