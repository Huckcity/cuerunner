import { describe, expect, it } from 'vitest'
import {
  bakeShape,
  DEFAULT_BEZIER,
  engineShapeOf,
  fadeShareAt,
  FADE_SHAPE_PRESETS,
  nearestCurve,
  normalizeFadeShape,
  shapeValue,
  type FadeShape
} from './fadeShape'
import { curveShape } from './dmx'
import { AUDIO_CURVE_POINTS } from './audio'

/** The engine's own reading of a table (native/audio/src/wsaudio.h: curveTableValue). */
function engineRead(table: number[], t: number): number {
  const x = t * (table.length - 1)
  const i = Math.min(table.length - 2, Math.floor(x))
  return table[i] + (table[i + 1] - table[i]) * (x - i)
}

describe('fade shapes', () => {
  it('start at nothing done and end at all of it, every one of them', () => {
    const shapes: FadeShape[] = [
      ...FADE_SHAPE_PRESETS.map(preset => ({ kind: 'preset' as const, preset })),
      DEFAULT_BEZIER,
      { kind: 'bezier', x1: 0.9, y1: 0, x2: 1, y2: 0.1 }
    ]
    for (const shape of shapes) {
      expect(shapeValue(shape, 0)).toBe(0)
      expect(shapeValue(shape, 1)).toBe(1)
      expect(shapeValue(shape, -1)).toBe(0)
      expect(shapeValue(shape, 2)).toBe(1)
    }
  })

  it('reads the three named curves the way the lighting and the engine always have', () => {
    for (const curve of ['linear', 'sCurve', 'logarithmic'] as const) {
      for (const t of [0.1, 0.25, 0.5, 0.8]) {
        expect(fadeShareAt(t, curve)).toBeCloseTo(curveShape(t, curve), 10)
      }
    }
  })

  it('reads a drawn shape in place of the curve it was given with', () => {
    const equalPower: FadeShape = { kind: 'preset', preset: 'equalPower' }
    expect(fadeShareAt(0.5, 'linear', equalPower)).toBeCloseTo(Math.SQRT1_2, 10)
    expect(fadeShareAt(0.5, 'linear', null)).toBe(0.5)
  })

  it('draws a Bézier with handles on the line as the line itself', () => {
    for (const t of [0.1, 0.33, 0.5, 0.9]) expect(shapeValue(DEFAULT_BEZIER, t)).toBeCloseTo(t, 5)
  })

  it('draws a Bézier the way CSS does: ease-in-out passes through its middle', () => {
    const easeInOut: FadeShape = { kind: 'bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 }
    expect(shapeValue(easeInOut, 0.5)).toBeCloseTo(0.5, 5)
    expect(shapeValue(easeInOut, 0.25)).toBeLessThan(0.25)
    expect(shapeValue(easeInOut, 0.75)).toBeGreaterThan(0.75)
  })

  it('is monotone however hard its handles are pulled', () => {
    const shape: FadeShape = { kind: 'bezier', x1: 1, y1: 0, x2: 0, y2: 1 }
    let last = 0
    for (let i = 1; i <= 200; i++) {
      const value = shapeValue(shape, i / 200)
      expect(value).toBeGreaterThanOrEqual(last - 1e-9)
      last = value
    }
  })

  it('bakes into a table the engine reads to within half a percent of the curve, at its steepest', () => {
    const shapes: FadeShape[] = [
      { kind: 'preset', preset: 'exponential' },
      { kind: 'preset', preset: 'equalPower' },
      { kind: 'bezier', x1: 0.1, y1: 0.9, x2: 0.3, y2: 1 }
    ]
    for (const shape of shapes) {
      const table = bakeShape(shape)
      expect(table).toHaveLength(AUDIO_CURVE_POINTS)
      let worst = 0
      for (let i = 0; i <= 1000; i++) worst = Math.max(worst, Math.abs(engineRead(table, i / 1000) - shapeValue(shape, i / 1000)))
      expect(worst).toBeLessThan(5e-3)
    }
    expect(engineShapeOf(null)).toBeNull()
    expect(engineShapeOf(undefined)).toBeNull()
  })

  it('falls back to the nearest named curve for a build that has none', () => {
    expect(nearestCurve({ kind: 'preset', preset: 'sCurve' })).toBe('sCurve')
    expect(nearestCurve({ kind: 'bezier', x1: 0, y1: 0.9, x2: 0.2, y2: 1 })).toBe('logarithmic')
    expect(nearestCurve({ kind: 'bezier', x1: 0.9, y1: 0, x2: 1, y2: 0.2 })).toBe('sCurve')
    expect(nearestCurve(DEFAULT_BEZIER)).toBe('linear')
  })

  it('reads what a file carries, and nothing it cannot', () => {
    expect(normalizeFadeShape({ kind: 'preset', preset: 'equalPower' })).toEqual({ kind: 'preset', preset: 'equalPower' })
    expect(normalizeFadeShape({ kind: 'preset', preset: 'wobble' })).toBeNull()
    expect(normalizeFadeShape({ kind: 'bezier', x1: 2, y1: -1, x2: 0.5, y2: 0.5 }))
      .toEqual({ kind: 'bezier', x1: 1, y1: 0, x2: 0.5, y2: 0.5 })
    expect(normalizeFadeShape({ kind: 'bezier', x1: 'a', y1: 0, x2: 0, y2: 0 })).toBeNull()
    expect(normalizeFadeShape(null)).toBeNull()
    expect(normalizeFadeShape(7)).toBeNull()
  })
})
