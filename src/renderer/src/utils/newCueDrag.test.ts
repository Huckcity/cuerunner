// A cue type dragged off the toolbar: what the drag carries, and what the list may read off it.
import { describe, it, expect, beforeEach } from 'vitest'
import { NEW_CUE_DRAG_TYPE, droppedCueType, isNewCueDrag, startNewCueDrag } from './newCueDrag'
import { useStore } from '../store'
import { createCue } from './cueDefaults'
import type { Cue } from '../../../shared/cue'

/** jsdom has no DataTransfer; the slice the helpers use is a map and its keys. */
function transfer(): DataTransfer {
  const data = new Map<string, string>()
  return {
    effectAllowed: 'none',
    get types() { return [...data.keys()] },
    setData: (type: string, value: string) => { data.set(type, value) },
    getData: (type: string) => data.get(type) ?? ''
  } as unknown as DataTransfer
}

describe('the new-cue drag', () => {
  it('carries the type under its own media type, as a copy', () => {
    const dt = transfer()
    startNewCueDrag(dt, 'memo')
    expect(dt.effectAllowed).toBe('copy')
    expect(dt.types).toEqual([NEW_CUE_DRAG_TYPE])
    expect(isNewCueDrag(dt)).toBe(true)
    expect(droppedCueType(dt)).toBe('memo')
  })

  it('is not a row being moved, nor files off the desktop', () => {
    const row = transfer()
    row.setData('application/x-cue-render-index', '3')
    expect(isNewCueDrag(row)).toBe(false)
  })

  it('reads a type this build does not have as nothing to drop', () => {
    const dt = transfer()
    dt.setData(NEW_CUE_DRAG_TYPE, 'hologram')
    expect(droppedCueType(dt)).toBeNull()
  })
})

describe('insertCues at a flat index', () => {
  beforeEach(() => useStore.setState({ cues: [], past: [], future: [] }))

  const cue = (id: string, patch: Partial<Cue> = {}): Cue => ({ ...createCue('wait', id), id, ...patch } as Cue)

  it('puts the cue in front of the one at that index, as one edit, and selects it', () => {
    useStore.setState({ cues: [cue('a'), cue('b'), cue('c')] })
    const fresh = cue('new')
    useStore.getState().insertCues([fresh], { beforeIndex: 1 })
    expect(useStore.getState().cues.map(c => c.id)).toEqual(['a', 'new', 'b', 'c'])
    expect(useStore.getState().selectedId).toBe('new')
    expect(useStore.getState().past).toHaveLength(1)
  })

  it('reads an index past the end as the end, and one before the start as the start', () => {
    useStore.setState({ cues: [cue('a')] })
    useStore.getState().insertCues([cue('z')], { beforeIndex: 99 })
    useStore.getState().insertCues([cue('first')], { beforeIndex: -4 })
    expect(useStore.getState().cues.map(c => c.id)).toEqual(['first', 'a', 'z'])
  })
})
