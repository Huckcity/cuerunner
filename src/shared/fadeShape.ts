// The shape of a fade, drawn once and read everywhere a fade happens.
//
// A fade is a change from one value to another over a time; its shape is how much of the
// change is done at each moment of it — a share from 0 to 1 against the share of the time
// from 0 to 1. Three shapes have always had names here (`FadeCurve`: linear, S-curve,
// logarithmic). A `FadeShape` is that, two more presets an operator reaches for (exponential
// and equal power), or a cubic Bézier the curve editor draws by its two handles — the same
// curve CSS calls `cubic-bezier(x1, y1, x2, y2)`, from (0, 0) to (1, 1).
//
// One function evaluates every shape (`shapeValue`), and every fade reads it: the lighting
// engine and a picture's opacity call it directly, and the audio engine plays a table baked
// from it (`bakeShape`), because the audio thread reads a table between its points rather
// than solving a Bézier per sample. The table is fine enough that the two agree to within
// half a percent of the change even where a curve is steepest — a few hundredths of a dB —
// which `fadeShape.test.ts` holds, so a shape sounds the way it draws.
//
// A shape is a new optional field beside a fade's named curve, never in place of it: a show
// written before shapes existed carries none and fades exactly as it did, and a cue with a
// shape still carries the named curve an older build falls back to.

import type { FadeCurve } from './cue'
import { AUDIO_CURVE_POINTS } from './audio'

/** The shapes with names. The first three are `FadeCurve`'s, read the same way. */
export const FADE_SHAPE_PRESETS = ['linear', 'sCurve', 'logarithmic', 'exponential', 'equalPower'] as const
export type FadeShapePreset = (typeof FADE_SHAPE_PRESETS)[number]

/** What the window calls each preset. */
export const FADE_SHAPE_LABELS: Record<FadeShapePreset | 'bezier', string> = {
  linear: 'Linear',
  sCurve: 'S-curve',
  logarithmic: 'Logarithmic',
  exponential: 'Exponential',
  equalPower: 'Equal power',
  bezier: 'Custom (Bézier)'
}

export type FadeShape =
  | { kind: 'preset'; preset: FadeShapePreset }
  /**
   * A cubic Bézier from (0, 0) to (1, 1) through two handles. `x` is the share of the time
   * and is held to 0–1 so the curve is a function of time; `y` is the share of the change and
   * is held to 0–1 too, so a fade never overshoots the value it is going to.
   */
  | { kind: 'bezier'; x1: number; y1: number; x2: number; y2: number }

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/** A named preset's share of the change done at `t`. */
function presetValue(preset: FadeShapePreset, t: number): number {
  switch (preset) {
    case 'sCurve':
      return t * t * (3 - 2 * t)
    case 'logarithmic':
      // Fast at first, easing in: the engine's own logarithmic curve, the same constant.
      return (1 - Math.exp(-4 * t)) / (1 - Math.exp(-4))
    case 'exponential':
      return (Math.exp(4 * t) - 1) / (Math.exp(4) - 1)
    case 'equalPower':
      return Math.sin((t * Math.PI) / 2)
    default:
      return t
  }
}

/** One coordinate of a cubic Bézier from 0 to 1 through handles `a` and `b`, at parameter `s`. */
function bezierAt(a: number, b: number, s: number): number {
  const u = 1 - s
  return 3 * u * u * s * a + 3 * u * s * s * b + s * s * s
}

function bezierSlope(a: number, b: number, s: number): number {
  const u = 1 - s
  return 3 * u * u * a + 6 * u * s * (b - a) + 3 * s * s * (1 - b)
}

/**
 * A Bézier's share of the change at time share `t`: the parameter whose x is `t` (Newton's
 * method from a good first guess, then bisection where the slope is too flat to trust), and
 * that parameter's y. Monotone in x because both handles' x are inside 0–1.
 */
function bezierValue(shape: { x1: number; y1: number; x2: number; y2: number }, t: number): number {
  const x1 = clamp01(shape.x1)
  const x2 = clamp01(shape.x2)
  const y1 = clamp01(shape.y1)
  const y2 = clamp01(shape.y2)
  let s = t
  for (let i = 0; i < 8; i++) {
    const error = bezierAt(x1, x2, s) - t
    if (Math.abs(error) < 1e-7) return bezierAt(y1, y2, s)
    const slope = bezierSlope(x1, x2, s)
    if (Math.abs(slope) < 1e-6) break
    s = Math.min(1, Math.max(0, s - error / slope))
  }
  let low = 0
  let high = 1
  s = t
  for (let i = 0; i < 40; i++) {
    const x = bezierAt(x1, x2, s)
    if (Math.abs(x - t) < 1e-7) break
    if (x < t) low = s
    else high = s
    s = (low + high) / 2
  }
  return bezierAt(y1, y2, s)
}

/** The share of a fade's change done at time share `t` (0–1), on a shape. */
export function shapeValue(shape: FadeShape, t: number): number {
  const time = clamp01(t)
  if (time <= 0) return 0
  if (time >= 1) return 1
  return shape.kind === 'bezier' ? clamp01(bezierValue(shape, time)) : presetValue(shape.preset, time)
}

/**
 * The share of a fade done at `t` for a fade that names a curve and may carry a shape: the
 * shape when there is one, the named curve otherwise. What the lighting engine, a picture's
 * opacity and anything else that fades on the main thread reads.
 */
export function fadeShareAt(t: number, curve: FadeCurve, shape?: FadeShape | null): number {
  return shapeValue(shape ?? { kind: 'preset', preset: curve }, t)
}

/** A shape as the table the audio engine reads: `AUDIO_CURVE_POINTS` evenly spaced shares. */
export function bakeShape(shape: FadeShape): number[] {
  const table: number[] = []
  for (let i = 0; i < AUDIO_CURVE_POINTS; i++) {
    table.push(Number(shapeValue(shape, i / (AUDIO_CURVE_POINTS - 1)).toFixed(6)))
  }
  table[0] = 0
  table[AUDIO_CURVE_POINTS - 1] = 1
  return table
}

/** The table an audio fade should carry for a shape, or null when the named curve says it all. */
export function engineShapeOf(shape: FadeShape | null | undefined): number[] | null {
  if (!shape) return null
  return bakeShape(shape)
}

/** The named curve a shape falls back to on a build that has no shapes: the nearest name. */
export function nearestCurve(shape: FadeShape): FadeCurve {
  if (shape.kind === 'preset') {
    if (shape.preset === 'exponential') return 'linear'
    if (shape.preset === 'equalPower') return 'logarithmic'
    return shape.preset
  }
  // A curve that is ahead of the line at the middle reads as logarithmic, one behind it as
  // an S-curve's slow start; one on it is a line.
  const middle = shapeValue(shape, 0.5)
  if (middle > 0.6) return 'logarithmic'
  if (middle < 0.4) return 'sCurve'
  return 'linear'
}

/** The default Bézier the editor starts from: the straight line, handles on it. */
export const DEFAULT_BEZIER: FadeShape = { kind: 'bezier', x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 }

/**
 * A shape as a show file may carry it: a known preset, or a Bézier whose handles are numbers,
 * held to their ranges. Anything else is no shape at all — the named curve stands — rather
 * than a fade the engine would refuse in the middle of a show.
 */
export function normalizeFadeShape(value: unknown): FadeShape | null {
  if (typeof value !== 'object' || value === null) return null
  const shape = value as Record<string, unknown>
  if (shape.kind === 'preset') {
    return FADE_SHAPE_PRESETS.includes(shape.preset as FadeShapePreset)
      ? { kind: 'preset', preset: shape.preset as FadeShapePreset }
      : null
  }
  if (shape.kind === 'bezier') {
    const numbers = [shape.x1, shape.y1, shape.x2, shape.y2]
    if (!numbers.every(n => typeof n === 'number' && Number.isFinite(n))) return null
    return {
      kind: 'bezier',
      x1: clamp01(shape.x1 as number),
      y1: clamp01(shape.y1 as number),
      x2: clamp01(shape.x2 as number),
      y2: clamp01(shape.y2 as number)
    }
  }
  return null
}

/** The SVG path of a shape in a box of `width` × `height`, rising left to right. */
export function shapePath(shape: FadeShape, width: number, height: number, steps = 48): string {
  const points: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = t * width
    const y = height - shapeValue(shape, t) * height
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return points.join(' ')
}
