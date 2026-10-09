// A picture's geometry over time: keyframes on its own timeline, and the moves fade cues lay
// over them — held to the numbers each frame is drawn from.
import { describe, expect, it } from 'vitest'
import { defaultGeometry, type VisualGeometry } from './visual'
import {
  MAX_KEYFRAMES,
  easeAt,
  keyframeAt,
  keyframedGeometry,
  keyframesEndMs,
  moveGeometry,
  movesAfterEdit,
  movesGeometry,
  normalizeKeyframes,
  shiftMoves,
  targetFields,
  withMoves,
  type GeometryKeyframe
} from './visualKeyframes'

const base: VisualGeometry = { ...defaultGeometry(), fit: 'fill' }

function key(atMs: number, patch: Partial<GeometryKeyframe> = {}): GeometryKeyframe {
  return { atMs, x: 0, y: 0, scale: 1, rotation: 0, crop: { top: 0, right: 0, bottom: 0, left: 0 }, easing: 'linear', ...patch }
}

describe('easing', () => {
  it('starts at nought and lands on one, each the way it says', () => {
    for (const easing of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
      expect(easeAt(easing, 0)).toBe(0)
      expect(easeAt(easing, 1)).toBe(1)
    }
    expect(easeAt('linear', 0.25)).toBe(0.25)
    expect(easeAt('ease-in', 0.5)).toBeCloseTo(0.125)
    expect(easeAt('ease-out', 0.5)).toBeCloseTo(0.875)
    expect(easeAt('ease-in-out', 0.5)).toBeCloseTo(0.5)
    expect(easeAt('ease-in-out', 0.25)).toBeCloseTo(0.0625)
    // A jump holds the value before it until its moment.
    expect(easeAt('hold', 0.99)).toBe(0)
    expect(easeAt('hold', 1)).toBe(1)
  })
})

describe('keyframes on a picture\'s own timeline', () => {
  const keyframes = [key(1000, { x: 0.4, scale: 0.5 }), key(3000, { x: -0.2, rotation: 90, easing: 'ease-in' })]

  it('starts from the cue\'s own geometry and moves to each keyframe in turn', () => {
    expect(keyframedGeometry(base, keyframes, 0)).toEqual(base)
    const quarter = keyframedGeometry(base, keyframes, 250)
    expect(quarter.x).toBeCloseTo(0.1)
    expect(quarter.scale).toBeCloseTo(0.875)
    expect(keyframedGeometry(base, keyframes, 1000).x).toBeCloseTo(0.4)
    // Half way to the second keyframe, eased in: an eighth of the way there.
    const eased = keyframedGeometry(base, keyframes, 2000)
    expect(eased.x).toBeCloseTo(0.4 + (-0.2 - 0.4) * 0.125)
    expect(eased.rotation).toBeCloseTo(90 * 0.125)
    // And it stays at the last.
    expect(keyframedGeometry(base, keyframes, 10_000)).toEqual({ ...base, x: -0.2, rotation: 90, scale: 1, y: 0, crop: { top: 0, right: 0, bottom: 0, left: 0 } })
  })

  it('keeps the cue\'s fit through every keyframe', () => {
    expect(keyframedGeometry(base, keyframes, 1500).fit).toBe('fill')
  })

  it('is the cue\'s geometry unmoved when it has none', () => {
    expect(keyframedGeometry(base, undefined, 5000)).toBe(base)
    expect(keyframedGeometry(base, [], 5000)).toBe(base)
    expect(keyframesEndMs([])).toBe(0)
    expect(keyframesEndMs(keyframes)).toBe(3000)
  })

  it('reads a list off disk in order, one per moment, held to the ranges, and no longer than the most', () => {
    const read = normalizeKeyframes([
      key(2000, { x: 9 }),
      { atMs: 'soon' },
      null,
      key(500, { easing: 'bounce' as never }),
      key(2000, { x: 0.5 })
    ], base)
    expect(read.map(keyframe => keyframe.atMs)).toEqual([500, 2000])
    expect(read[0].easing).toBe('linear')
    expect(read[1].x).toBe(0.5)
    expect(normalizeKeyframes([key(0, { x: 9 })], base)[0].x).toBe(2)
    expect(normalizeKeyframes(Array.from({ length: MAX_KEYFRAMES + 10 }, (_, i) => key(i * 100)), base)).toHaveLength(MAX_KEYFRAMES)
    expect(normalizeKeyframes('nope', base)).toEqual([])
  })

  it('adds a keyframe where the picture would be at that moment', () => {
    expect(keyframeAt(base, keyframes, 500)).toEqual(expect.objectContaining({ atMs: 500, x: expect.closeTo(0.2, 6), scale: expect.closeTo(0.75, 6) }))
  })
})

describe('a fade cue\'s moves', () => {
  it('names what a target moves: the crop as four edges at once', () => {
    expect(targetFields({ x: 0.1, crop: { top: 0.1, right: 0, bottom: 0, left: 0.2 } }).map(([field]) => field))
      .toEqual(['x', 'cropTop', 'cropRight', 'cropBottom', 'cropLeft'])
    expect(movesGeometry({})).toBe(false)
    expect(movesGeometry(null)).toBe(false)
    expect(movesGeometry({ scale: 0.5 })).toBe(true)
  })

  it('ramps each named property from where the picture is to the target, on the fade\'s curve', () => {
    const moves = moveGeometry({}, base, { x: 0.5, scale: 2 }, 1000, 1000, 'linear')
    expect(withMoves(base, moves, 1000)).toEqual(base)
    const half = withMoves(base, moves, 1500)
    expect(half.x).toBeCloseTo(0.25)
    expect(half.scale).toBeCloseTo(1.5)
    expect(half.rotation).toBe(0)
    const landed = withMoves(base, moves, 5000)
    expect(landed.x).toBe(0.5)
    expect(landed.scale).toBe(2)
  })

  it('carries a move that lands on one still running on from where the eye sees it', () => {
    const first = moveGeometry({}, base, { x: 1 }, 0, 1000, 'linear')
    const second = moveGeometry(first, withMoves(base, first, 500), { x: 0 }, 500, 1000, 'linear')
    expect(withMoves(base, second, 500).x).toBeCloseTo(0.5)
    expect(withMoves(base, second, 1000).x).toBeCloseTo(0.25)
  })

  it('keeps a moved property where the fade left it, whatever the keyframes say after', () => {
    const keyframes = [key(4000, { x: -1, y: 0.5 })]
    const moves = moveGeometry({}, keyframedGeometry(base, keyframes, 0), { x: 0.3 }, 0, 0, 'linear')
    const later = withMoves(keyframedGeometry(base, keyframes, 4000), moves, 4000)
    expect(later.x).toBe(0.3)
    // A property the fade did not name is still the keyframes'.
    expect(later.y).toBe(0.5)
  })

  it('gives a property back to the operator who edits it, and keeps the rest of the moves', () => {
    const moves = moveGeometry({}, base, { x: 0.5, scale: 2 }, 0, 1000, 'linear')
    const kept = movesAfterEdit(moves, base, { ...base, x: 0.1 })
    expect(kept.x).toBeUndefined()
    expect(kept.scale).toBeDefined()
  })

  it('moves every ramp\'s time with a clock that is rebased or held', () => {
    const moves = moveGeometry({}, base, { x: 1 }, 1000, 1000, 'linear')
    expect(shiftMoves(moves, 500).x?.startMs).toBe(1500)
  })
})
