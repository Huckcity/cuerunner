import { describe, it, expect } from 'vitest'
import { createCue } from './cueDefaults'
import { snapOffset, snapTargetsFor } from './timelineSnap'
import type { Cue, CueType } from '../../../shared/cue'

function cue(type: CueType, patch: Partial<Cue> = {}): Cue {
  return { ...createCue(type), ...patch } as Cue
}

// 0.1 px/ms puts the 8px snap threshold at 80ms — easy to reason about in tests.
const ZOOM = 0.1

describe('snapTargetsFor', () => {
  it('offers the group start and both edges of every sibling', () => {
    const dragged = cue('wait', { id: 'dragged', duration: 500 })
    const other = cue('wait', { id: 'other', duration: 2500, timelineOffset: 1000 })
    expect(snapTargetsFor([dragged, other], dragged.id)).toEqual([0, 1000, 3500])
  })

  it('offers only the group start when the group has one child', () => {
    const only = cue('wait', { id: 'only', duration: 500 })
    expect(snapTargetsFor([only], only.id)).toEqual([0])
  })
})

describe('snapOffset', () => {
  it('leaves the offset alone when no edge is in range', () => {
    expect(snapOffset(300, 500, [0, 1000], ZOOM)).toEqual({ offset: 300, guideMs: null })
  })

  it('snaps the leading edge onto the end of the block before it', () => {
    // 1050 is 50ms past the 1000ms end of the previous block
    expect(snapOffset(1050, 500, [0, 1000], ZOOM)).toEqual({ offset: 1000, guideMs: 1000 })
  })

  it('snaps the trailing edge onto the start of the block after it', () => {
    // the block ends at 920ms, 80ms short of the block that starts at 1000ms
    expect(snapOffset(420, 500, [0, 1000], ZOOM)).toEqual({ offset: 500, guideMs: 1000 })
  })

  it('picks the nearest edge when several are in range', () => {
    const result = snapOffset(1040, 10, [0, 1000, 1020], ZOOM)
    expect(result).toEqual({ offset: 1020, guideMs: 1020 })
  })

  it('rounds an unsnapped offset to whole milliseconds', () => {
    expect(snapOffset(1234.6, 10, [0, 5000], ZOOM)).toEqual({ offset: 1235, guideMs: null })
  })

  it('holds a block dragged past the group start at the start', () => {
    expect(snapOffset(-50, 500, [0, 1000], ZOOM)).toEqual({ offset: 0, guideMs: 0 })
  })

  it('never snaps a long block to a negative offset', () => {
    // 200ms in, with a target at 1900ms: pulling the trailing edge onto that target
    // would put the 2000ms block at -100ms, so the leading edge wins at the start.
    expect(snapOffset(200, 2000, [0, 1900], 0.02)).toEqual({ offset: 0, guideMs: 0 })
  })

  it('measures the threshold in pixels, so zoom decides the pull', () => {
    // the same 60ms gap snaps at 100 px/s and is left alone at 500 px/s
    expect(snapOffset(1060, 500, [0, 1000], 0.1)).toEqual({ offset: 1000, guideMs: 1000 })
    expect(snapOffset(1060, 500, [0, 1000], 0.5)).toEqual({ offset: 1060, guideMs: null })
  })
})
