// Where a picture lands on its output, as numbers: the part of the source that is drawn and
// the transform that carries it onto the output. Both renderers read this — the GPU's and the
// 2D fallback's — so a cue lands in the same place whichever one a machine has, and the
// tests read the same numbers the pixels come from.
//
// Coordinates are the output's pixels, y down, origin top-left. The transform maps the unit
// square of the cropped source — (0,0) its top-left, (1,1) its bottom-right — onto the output
// as an affine `[a, b, c, d, e, f]`, the order a 2D canvas's `setTransform` takes:
//
//   x' = a·u + c·v + e
//   y' = b·u + d·v + f

import type { GridPosition, VisualCrop, VisualGeometry } from './visual'
import { GEOMETRY_LIMITS } from './visual'

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** An affine transform, canvas order: [a, b, c, d, e, f]. */
export type Affine = [number, number, number, number, number, number]

export interface LayerPlacement {
  /** The part of the source drawn, in source pixels. */
  source: Rect
  /** The unit square of that part onto the output. */
  transform: Affine
  /** Its size on the output before rotation, in output pixels. */
  size: Size
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * A crop the source can survive: each edge held to the declared range, and a pair of edges
 * that would cut away the whole of the source eased back so a sliver of it is still drawn.
 */
export function safeCrop(crop: VisualCrop): VisualCrop {
  const [min, max] = GEOMETRY_LIMITS.crop
  let { top, right, bottom, left } = {
    top: clamp(crop.top, min, max),
    right: clamp(crop.right, min, max),
    bottom: clamp(crop.bottom, min, max),
    left: clamp(crop.left, min, max)
  }
  if (left + right > max) {
    const scale = max / (left + right)
    left *= scale
    right *= scale
  }
  if (top + bottom > max) {
    const scale = max / (top + bottom)
    top *= scale
    bottom *= scale
  }
  return { top, right, bottom, left }
}

/** The source rectangle a crop leaves, in source pixels. */
export function cropRect(media: Size, crop: VisualCrop): Rect {
  const safe = safeCrop(crop)
  return {
    x: media.width * safe.left,
    y: media.height * safe.top,
    width: media.width * (1 - safe.left - safe.right),
    height: media.height * (1 - safe.top - safe.bottom)
  }
}

/** How much the fit multiplies the cropped source by, across and down. */
export function fitScale(fit: VisualGeometry['fit'], source: Size, output: Size): { x: number; y: number } {
  if (source.width <= 0 || source.height <= 0) return { x: 1, y: 1 }
  const across = output.width / source.width
  const down = output.height / source.height
  switch (fit) {
    case 'fit': {
      const k = Math.min(across, down)
      return { x: k, y: k }
    }
    case 'fill': {
      const k = Math.max(across, down)
      return { x: k, y: k }
    }
    case 'stretch':
      return { x: across, y: down }
    case 'native':
      return { x: 1, y: 1 }
  }
}

/**
 * Where a picture lands: its geometry, applied to a source of `media`'s size on an output of
 * `output`'s. `anchor` is the centre the geometry's offsets are measured from — the output's
 * own centre for a picture, a grid point for text.
 */
export function placeLayer(
  geometry: VisualGeometry,
  media: Size,
  output: Size,
  anchor: { x: number; y: number } = { x: output.width / 2, y: output.height / 2 }
): LayerPlacement {
  const source = cropRect(media, geometry.crop)
  const k = fitScale(geometry.fit, source, output)
  const scale = clamp(geometry.scale, GEOMETRY_LIMITS.scale[0], GEOMETRY_LIMITS.scale[1])
  const width = source.width * k.x * scale
  const height = source.height * k.y * scale
  const cx = anchor.x + clamp(geometry.x, GEOMETRY_LIMITS.offset[0], GEOMETRY_LIMITS.offset[1]) * output.width
  const cy = anchor.y + clamp(geometry.y, GEOMETRY_LIMITS.offset[0], GEOMETRY_LIMITS.offset[1]) * output.height
  const theta = (clamp(geometry.rotation, GEOMETRY_LIMITS.rotation[0], GEOMETRY_LIMITS.rotation[1]) * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  // The unit square's two edges, scaled to the picture's size and turned clockwise (y is
  // down, so the usual rotation reads clockwise on screen), then placed so the square's
  // centre lands on the picture's.
  const a = cos * width
  const b = sin * width
  const c = -sin * height
  const d = cos * height
  const e = cx - 0.5 * (a + c)
  const f = cy - 0.5 * (b + d)
  return { source, transform: [a, b, c, d, e, f], size: { width, height } }
}

/** A point of the unit square, through a transform. */
export function applyAffine(m: Affine, u: number, v: number): { x: number; y: number } {
  return { x: m[0] * u + m[2] * v + m[4], y: m[1] * u + m[3] * v + m[5] }
}

/** The four corners a placement covers on the output: top-left, top-right, bottom-right, bottom-left. */
export function placementCorners(placement: LayerPlacement): Array<{ x: number; y: number }> {
  const m = placement.transform
  return [applyAffine(m, 0, 0), applyAffine(m, 1, 0), applyAffine(m, 1, 1), applyAffine(m, 0, 1)]
}

/**
 * The centre of a block of `size` anchored at one of the nine grid points, `margin` in from
 * the output's edges.
 */
export function gridCentre(position: GridPosition, size: Size, output: Size, margin: number): { x: number; y: number } {
  const column = position.endsWith('left') ? 0 : position.endsWith('right') ? 2 : 1
  const row = position.startsWith('top') ? 0 : position.startsWith('bottom') ? 2 : 1
  const x = column === 0
    ? margin + size.width / 2
    : column === 2 ? output.width - margin - size.width / 2 : output.width / 2
  const y = row === 0
    ? margin + size.height / 2
    : row === 2 ? output.height - margin - size.height / 2 : output.height / 2
  return { x, y }
}

/** The geometry a text block is drawn with: its own size, never refitted to the output. */
export function textGeometry(geometry: VisualGeometry): VisualGeometry {
  return { ...geometry, fit: 'native', crop: { top: 0, right: 0, bottom: 0, left: 0 } }
}

/**
 * The size a composed output is drawn at: the display's own pixels when it is fullscreen on
 * one, else the size the show declares for it.
 */
export function compositionSize(
  declared: Size,
  display: { width: number; height: number; scaleFactor: number } | null
): Size {
  if (display === null) {
    return { width: Math.max(16, Math.round(declared.width)), height: Math.max(16, Math.round(declared.height)) }
  }
  return {
    width: Math.max(16, Math.round(display.width * display.scaleFactor)),
    height: Math.max(16, Math.round(display.height * display.scaleFactor))
  }
}
