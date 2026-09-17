import { describe, it, expect } from 'vitest'
import { createCue } from './cueDefaults'
import { groupDurationMs } from './cueDuration'
import type { Cue, CueType, GroupMode } from '../../../shared/cue'

function cue(type: CueType, patch: Partial<Cue> = {}): Cue {
  return { ...createCue(type), ...patch } as Cue
}

function group(mode: GroupMode, patch: Partial<Cue> = {}): Cue {
  return cue('group', { mode, ...patch } as Partial<Cue>)
}

describe('groupDurationMs', () => {
  it('sums the children of a sequence group', () => {
    const g = group('sequence')
    const cues = [
      g,
      cue('wait', { parentId: g.id, duration: 1500 }),
      cue('audio', { parentId: g.id, duration: 2500 }),
    ]
    expect(groupDurationMs(cues, g.id)).toBe(4000)
  })

  it('ends a timeline group at its furthest child', () => {
    const g = group('timeline')
    const cues = [
      g,
      cue('wait', { parentId: g.id, duration: 1000, timelineOffset: 0 }),
      cue('wait', { parentId: g.id, duration: 2000, timelineOffset: 500 }),
    ]
    // 500 + 2000 beats 0 + 1000
    expect(groupDurationMs(cues, g.id)).toBe(2500)
  })

  it('counts a nested timeline group as one entry at its own offset', () => {
    const outer = group('timeline')
    const inner = group('timeline', { parentId: outer.id, timelineOffset: 2000 })
    const cues = [
      outer,
      inner,
      // outer's own earliest child, well before the nested group starts
      cue('wait', { parentId: outer.id, duration: 1000, timelineOffset: 0 }),
      // inner runs 1000ms at 0 and 500ms at 1000 → 1500ms long
      cue('wait', { parentId: inner.id, duration: 1000, timelineOffset: 0 }),
      cue('wait', { parentId: inner.id, duration: 500, timelineOffset: 1000 }),
    ]
    expect(groupDurationMs(cues, outer.id)).toBe(3500)
    expect(groupDurationMs(cues, inner.id)).toBe(1500)
  })

  it('adds a nested group length into a sequence parent', () => {
    const outer = group('sequence')
    const inner = group('sequence', { parentId: outer.id })
    const cues = [
      outer,
      inner,
      cue('wait', { parentId: inner.id, duration: 700 }),
      cue('wait', { parentId: inner.id, duration: 300 }),
      cue('wait', { parentId: outer.id, duration: 1000 }),
    ]
    expect(groupDurationMs(cues, outer.id)).toBe(2000)
  })

  it('reports an unknown length for a playlist group', () => {
    const g = group('playlist')
    const cues = [g, cue('wait', { parentId: g.id, duration: 1000 })]
    expect(groupDurationMs(cues, g.id)).toBe(0)
  })

  it('reports an unknown length for a random group', () => {
    const g = group('random')
    const cues = [g, cue('wait', { parentId: g.id, duration: 1000 })]
    expect(groupDurationMs(cues, g.id)).toBe(0)
  })

  it('reports an unknown length for a group with no children', () => {
    const g = group('sequence')
    expect(groupDurationMs([g], g.id)).toBe(0)
  })

  it('reports an unknown length when every child length is unknown', () => {
    const g = group('sequence')
    const cues = [g, cue('midi', { parentId: g.id }), cue('osc', { parentId: g.id })]
    expect(groupDurationMs(cues, g.id)).toBe(0)
  })

  it('reports zero for an id that is not a group', () => {
    const w = cue('wait', { duration: 1000 })
    expect(groupDurationMs([w], w.id)).toBe(0)
    expect(groupDurationMs([w], 'missing')).toBe(0)
  })

  it('terminates on a malformed mutual parent chain', () => {
    const a = group('sequence', { id: 'a' })
    const b = group('sequence', { id: 'b' })
    // each group claims the other as its parent
    const cues = [{ ...a, parentId: 'b' } as Cue, { ...b, parentId: 'a' } as Cue]
    expect(groupDurationMs(cues, 'a')).toBe(0)
    expect(groupDurationMs(cues, 'b')).toBe(0)
  })
})
