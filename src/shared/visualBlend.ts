// How a picture is laid over what is behind it on its output: its blend mode.
//
// Fourteen modes — the separable ones the W3C compositing spec names (multiply through
// exclusion), the plain `normal`, and the two a video desk calls add and subtract. Every
// output's frame is opaque (it starts black and stays so), so a layer is always blended onto
// a backdrop whose alpha is one, and the result at one channel is
//
//   result = (1 − α) · Cb + α · B(Cb, Cs)
//
// where Cb is the backdrop, Cs the layer's own colour, α the layer's opacity times its own
// alpha, and B the mode's function. Add and subtract are light added and taken away rather
// than a function of the two colours — `Cb ± α · Cs`, held to the range — which is what a 2D
// canvas's `lighter` does, and what an operator laying a flare over a scene expects.
//
// This module is the executable statement of the modes: the GPU's shader (renderGl.ts) and the
// 2D fallback (render2d.ts) are both held to it by the tests, pixel for pixel.

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'add'
  | 'subtract'

/** Every mode, in the order the inspector offers them. */
export const BLEND_MODES: readonly BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'add', 'subtract'
]

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === 'string' && (BLEND_MODES as readonly string[]).includes(value)
}

/** The mode a picture is drawn with: the one it names, else normal. */
export function blendOf(value: unknown): BlendMode {
  return isBlendMode(value) ? value : 'normal'
}

/** The shader's number for a mode: its place in `BLEND_MODES`. */
export function blendIndex(mode: BlendMode): number {
  return BLEND_MODES.indexOf(mode)
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function softLightD(cb: number): number {
  return cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb)
}

function hardLight(cb: number, cs: number): number {
  return cs <= 0.5 ? cb * 2 * cs : 1 - (1 - cb) * (1 - (2 * cs - 1))
}

/**
 * B(Cb, Cs) at one channel, both 0–1, for the separable modes. Add and subtract are not of
 * this form (their opacity scales the light, not the mix) and are answered by `blendChannel`.
 */
export function separable(mode: Exclude<BlendMode, 'add' | 'subtract'>, cb: number, cs: number): number {
  switch (mode) {
    case 'normal':
      return cs
    case 'multiply':
      return cb * cs
    case 'screen':
      return cb + cs - cb * cs
    case 'overlay':
      return hardLight(cs, cb)
    case 'darken':
      return Math.min(cb, cs)
    case 'lighten':
      return Math.max(cb, cs)
    case 'color-dodge':
      if (cb <= 0) return 0
      if (cs >= 1) return 1
      return Math.min(1, cb / (1 - cs))
    case 'color-burn':
      if (cb >= 1) return 1
      if (cs <= 0) return 0
      return 1 - Math.min(1, (1 - cb) / cs)
    case 'hard-light':
      return hardLight(cb, cs)
    case 'soft-light':
      return cs <= 0.5
        ? cb - (1 - 2 * cs) * cb * (1 - cb)
        : cb + (2 * cs - 1) * (softLightD(cb) - cb)
    case 'difference':
      return Math.abs(cb - cs)
    case 'exclusion':
      return cb + cs - 2 * cb * cs
  }
}

/** One channel of the result, all 0–1: the backdrop, the layer's colour, and its opacity. */
export function blendChannel(mode: BlendMode, cb: number, cs: number, alpha: number): number {
  const a = clamp01(alpha)
  if (mode === 'add') return clamp01(cb + a * cs)
  if (mode === 'subtract') return clamp01(cb - a * cs)
  return clamp01((1 - a) * cb + a * separable(mode, cb, cs))
}

/**
 * The colour a layer of `source` (RGB, 0–255) at `alpha` leaves over `backdrop` (RGB, 0–255):
 * the reference both renderers' pixels are held to.
 */
export function blendPixel(mode: BlendMode, backdrop: readonly number[], source: readonly number[], alpha: number): number[] {
  return [0, 1, 2].map(i => blendChannel(mode, (backdrop[i] ?? 0) / 255, (source[i] ?? 0) / 255, alpha) * 255)
}

/** The names a 2D canvas's `globalCompositeOperation` takes for the modes, and subtract. */
export type CanvasBlendOperation = 'source-over' | 'lighter' | 'subtract' | Exclude<BlendMode, 'normal' | 'add' | 'subtract'>

/**
 * What the 2D fallback sets `globalCompositeOperation` to for a mode. Every separable mode is
 * the canvas's own, by the same name and the same formula; add is `lighter`. Subtract has no
 * operation of its own, and is drawn as add between two inversions of the frame
 * (`1 − ((1 − Cb) + α·Cs)` is `Cb − α·Cs`) — exact to the byte, at the cost of two passes.
 */
export function canvasOperation(mode: BlendMode): CanvasBlendOperation {
  switch (mode) {
    case 'normal':
      return 'source-over'
    case 'add':
      return 'lighter'
    case 'subtract':
      return 'subtract'
    default:
      return mode
  }
}

/** Rec. 709's weights: how bright a colour looks, as a mask reads its brightness. */
export const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const

/**
 * How much of the pictures a mask lets through at one pixel, 0–1, from the mask image's RGBA
 * (0–255, straight alpha): its brightness or its alpha, turned round if it is inverted. Read by
 * brightness, a clear part of the image is dark — what a mask drawn on a transparent canvas means.
 */
export function maskFactor(mode: 'luma' | 'alpha', invert: boolean, rgba: readonly number[]): number {
  const alpha = (rgba[3] ?? 255) / 255
  const k = mode === 'luma'
    ? (LUMA_WEIGHTS[0] * (rgba[0] ?? 0) + LUMA_WEIGHTS[1] * (rgba[1] ?? 0) + LUMA_WEIGHTS[2] * (rgba[2] ?? 0)) / 255 * alpha
    : alpha
  const clamped = clamp01(k)
  return invert ? 1 - clamped : clamped
}
