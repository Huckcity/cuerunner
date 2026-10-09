// The cart: a tile per top-level cue, fired by a press or its number key, stopped by its own stop.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CartView, tileForKey, tileKey } from './CartView'
import { useStore } from '../../store'
import { cueEngine } from '../../engine/CueEngine'
import { createCue } from '../../utils/cueDefaults'
import type { Cue } from '../../../../shared/cue'

vi.mock('../../engine/audioEngineClient')

describe('the cart’s keys', () => {
  it('numbers the first ten tiles 1 to 9 and then 0', () => {
    expect([0, 1, 8, 9, 10].map(tileKey)).toEqual(['1', '2', '9', '0', null])
    expect(['1', '9', '0', 'a', 'F6'].map(tileForKey)).toEqual([0, 8, 9, null, null])
  })
})

describe('CartView', () => {
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
    vi.restoreAllMocks()
    useStore.setState({ cues: [], running: new Map() })
  })

  function cue(type: Cue['type'], id: string, patch: Partial<Cue> = {}): Cue {
    return { ...createCue(type, id), id, name: `Cue ${id}`, ...patch } as Cue
  }

  const tiles = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.cart-tile')]

  it('draws a tile per cue at the top of the list: a group is one tile, its children none', () => {
    useStore.setState({ cues: [cue('group', 'g'), cue('wait', 'c', { parentId: 'g' }), cue('audio', 'a')], running: new Map() })
    act(() => { root.render(<CartView onExit={() => {}} />) })
    expect(tiles().map(tile => tile.dataset.cueId)).toEqual(['g', 'a'])
    expect(tiles()[1].querySelector('.cart-tile-key')?.textContent).toBe('2')
  })

  it('plays a tile’s cue on a press and on its number key, wherever the show stands', () => {
    const goById = vi.spyOn(cueEngine, 'goById').mockImplementation(() => {})
    useStore.setState({ cues: [cue('wait', '1'), cue('wait', '2')], running: new Map(), selectedId: '1' })
    act(() => { root.render(<CartView onExit={() => {}} />) })
    act(() => { tiles()[1].querySelector<HTMLButtonElement>('.cart-tile-fire')!.click() })
    expect(goById).toHaveBeenLastCalledWith('2')
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' })) })
    expect(goById).toHaveBeenLastCalledWith('1')
  })

  it('does not offer a disarmed cue, and gives a running one a stop of its own', () => {
    const stop = vi.spyOn(cueEngine, 'stop').mockImplementation(() => {})
    useStore.setState({
      cues: [cue('wait', '1', { isArmed: false }), cue('wait', '2')],
      running: new Map([['2', { cueId: '2', state: 'playing', startedAt: Date.now(), progress: 0 }]])
    })
    act(() => { root.render(<CartView onExit={() => {}} />) })
    expect(tiles()[0].querySelector<HTMLButtonElement>('.cart-tile-fire')!.disabled).toBe(true)
    expect(tiles()[0].querySelector('.cart-tile-stop')).toBeNull()
    act(() => { tiles()[1].querySelector<HTMLButtonElement>('.cart-tile-stop')!.click() })
    expect(stop).toHaveBeenCalledWith('2')
  })
})
