// Laying a finished output onto a projector's throw: corner pin and soft edges.
//
// A corner pin is a projective map from the unit square — the whole composed output — onto
// the quadrilateral its four pinned corners make. It is solved here once per change, as a
// 3×3 matrix, and the GPU pass samples the composed frame through its inverse: for each pixel
// of the window, where in the frame did it come from. A pixel that came from outside the
// frame is black. The algebra is the textbook square-to-quadrilateral solution (Heckbert,
// "Fundamentals of Texture Mapping and Image Warping", 1989).
//
// Matrices are row-major `[m0..m8]`, mapping (u, v, 1) to (x·w, y·w, w).

import type { CornerOffset, OutputWarp } from './visual'

export type Mat3 = [number, number, number, number, number, number, number, number, number]

export interface Point {
  x: number
  y: number
}

/** The four corners the warp pins, in unit space: top-left, top-right, bottom-right, bottom-left. */
export function warpQuad(corners: readonly CornerOffset[]): [Point, Point, Point, Point] {
  const base: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  return base.map((point, i) => ({ x: point.x + (corners[i]?.x ?? 0), y: point.y + (corners[i]?.y ?? 0) })) as [Point, Point, Point, Point]
}

/** The projective map from the unit square onto a quadrilateral, or null for one that folds. */
export function squareToQuad(quad: readonly [Point, Point, Point, Point]): Mat3 | null {
  const [p0, p1, p2, p3] = quad
  const sx = p0.x - p1.x + p2.x - p3.x
  const sy = p0.y - p1.y + p2.y - p3.y
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    // A parallelogram: the map is affine.
    return [
      p1.x - p0.x, p2.x - p1.x, p0.x,
      p1.y - p0.y, p2.y - p1.y, p0.y,
      0, 0, 1
    ]
  }
  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const det = dx1 * dy2 - dx2 * dy1
  if (Math.abs(det) < 1e-12) return null
  const g = (sx * dy2 - dx2 * sy) / det
  const h = (dx1 * sy - sx * dy1) / det
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1
  ]
}

export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return null
  const inv = 1 / det
  return [
    A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv,
    C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv
  ]
}

/** A unit-space point through a projective map. */
export function project(m: Mat3, x: number, y: number): Point {
  const w = m[6] * x + m[7] * y + m[8]
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w }
}

/**
 * Whether a quadrilateral is one a picture can be pinned to: its corners in order around it,
 * all turning the same way. A pin dragged across another corner folds the picture over
 * itself, and that is refused rather than drawn.
 */
export function isConvexQuad(quad: readonly Point[]): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const c = quad[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-9) return false
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * The matrix the warp pass samples through: window unit space back to frame unit space. Null
 * for no pin — or one that would fold — which draws the frame as it is.
 */
export function warpSampler(warp: OutputWarp): Mat3 | null {
  if (warp.corners.every(c => c.x === 0 && c.y === 0)) return null
  const quad = warpQuad(warp.corners)
  if (!isConvexQuad(quad)) return null
  const forward = squareToQuad(quad)
  return forward === null ? null : invert3(forward)
}

/**
 * How bright a point of the frame is drawn under the soft edges, 0–1: each edge ramps from
 * nothing at the frame's border to full at the blend's width, bent by the gamma. The GPU pass
 * computes the same expression.
 */
export function blendFactor(warp: OutputWarp, u: number, v: number): number {
  const ramp = (distance: number, width: number): number => {
    if (width <= 0) return 1
    const t = Math.min(Math.max(distance / width, 0), 1)
    return Math.pow(t, Math.max(warp.gamma, 0.1))
  }
  return ramp(u, warp.blend.left) * ramp(1 - u, warp.blend.right) * ramp(v, warp.blend.top) * ramp(1 - v, warp.blend.bottom)
}
