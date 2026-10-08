// A picture's geometry over time: the keyframes a cue carries on its own timeline, and the
// moves a fade cue lays over them.
//
// A keyframe says where the picture is at a moment of its own play — so many ms after its first
// frame is on screen, pauses taken out — and how it got there from the one before (its easing).
// The cue's own geometry is where it starts, at nought; after the last keyframe it stays where
// that one left it. Fit is the cue's and is never keyframed: a picture does not change how it is
// sized to its output half way through a move.
//
// A fade cue moves a running picture's position, scale, rotation and crop as it moves its
// opacity: each property it names ramps from wherever the picture is when the fade begins — the
// keyframes' value then, or a fade still running — to the target, over the fade's time and
// curve. A property a fade has moved is the fade's from then on: the keyframes no longer move
// it, so a picture a fade has put somewhere stays there. An edit to that property in the
// inspector is the operator's own hand and takes it back.
//
// Every value here is a pure function of time, like the rest of an output's clocks
// (visualClock.ts), so a window that reloads and replays its commands draws the same frame.

import type { FadeCurve } from './cue'
import type { VisualCrop, VisualGeometry } from './visual'
import { GEOMETRY_LIMITS } from './visual'
import { rampAt, retarget, steady, type Ramp } from './visualClock'

/** How a keyframe is reached from the one before it. `hold` jumps on the keyframe's moment. */
export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold'

export const KEYFRAME_EASINGS: readonly KeyframeEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']

/** Where a picture is at one moment of its own play. */
export interface GeometryKeyframe {
  /** ms after the picture's first frame, pauses taken out. */
  atMs: number
  x: number
  y: number
  scale: number
  rotation: number
  crop: VisualCrop
  easing: KeyframeEasing
}

/** The most keyframes a cue carries: a small list, not an animation timeline. */
export const MAX_KEYFRAMES = 32

/** The longest a keyframe can sit from the first frame: a day, past any show. */
export const MAX_KEYFRAME_MS = 24 * 60 * 60 * 1000

/** The four numbers of a picture's place, and the crop's four edges: what can be moved. */
export type GeometryField = 'x' | 'y' | 'scale' | 'rotation' | 'cropTop' | 'cropRight' | 'cropBottom' | 'cropLeft'

export const GEOMETRY_FIELDS: readonly GeometryField[] = ['x', 'y', 'scale', 'rotation', 'cropTop', 'cropRight', 'cropBottom', 'cropLeft']

/**
 * Where a fade cue moves a picture to. A property it does not name is left where it is; the
 * crop is moved as a whole — its four edges together — because a crop is set as one.
 */
export interface GeometryTarget {
  x?: number
  y?: number
  scale?: number
  rotation?: number
  crop?: VisualCrop
}

/** The moves a picture is under, one ramp per property a fade has taken. */
export type GeometryRamps = Partial<Record<GeometryField, Ramp>>

/** Where the easing has got at `t` (0–1). */
export function easeAt(easing: KeyframeEasing, t: number): number {
  const x = Math.min(Math.max(t, 0), 1)
  switch (easing) {
    case 'linear':
      return x
    case 'ease-in':
      return x * x * x
    case 'ease-out':
      return 1 - Math.pow(1 - x, 3)
    case 'ease-in-out':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
    case 'hold':
      return x >= 1 ? 1 : 0
  }
}

/** One property's value in a geometry. */
export function fieldOf(geometry: Pick<VisualGeometry, 'x' | 'y' | 'scale' | 'rotation' | 'crop'>, field: GeometryField): number {
  switch (field) {
    case 'x': return geometry.x
    case 'y': return geometry.y
    case 'scale': return geometry.scale
    case 'rotation': return geometry.rotation
    case 'cropTop': return geometry.crop.top
    case 'cropRight': return geometry.crop.right
    case 'cropBottom': return geometry.crop.bottom
    case 'cropLeft': return geometry.crop.left
  }
}

/** A geometry with one property set. */
export function withField(geometry: VisualGeometry, field: GeometryField, value: number): VisualGeometry {
  switch (field) {
    case 'x': return { ...geometry, x: value }
    case 'y': return { ...geometry, y: value }
    case 'scale': return { ...geometry, scale: value }
    case 'rotation': return { ...geometry, rotation: value }
    case 'cropTop': return { ...geometry, crop: { ...geometry.crop, top: value } }
    case 'cropRight': return { ...geometry, crop: { ...geometry.crop, right: value } }
    case 'cropBottom': return { ...geometry, crop: { ...geometry.crop, bottom: value } }
    case 'cropLeft': return { ...geometry, crop: { ...geometry.crop, left: value } }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * The geometry a keyframed picture is at, `elapsedMs` into its own play. Before the first
 * keyframe it moves from the cue's own geometry to that one; after the last it stays put.
 */
export function keyframedGeometry(base: VisualGeometry, keyframes: readonly GeometryKeyframe[] | null | undefined, elapsedMs: number): VisualGeometry {
  if (keyframes === null || keyframes === undefined || keyframes.length === 0) return base
  const t = Math.max(0, elapsedMs)
  let from: { atMs: number; geometry: VisualGeometry } = { atMs: 0, geometry: base }
  for (const keyframe of keyframes) {
    const geometry = { ...base, x: keyframe.x, y: keyframe.y, scale: keyframe.scale, rotation: keyframe.rotation, crop: { ...keyframe.crop } }
    if (t < keyframe.atMs) {
      const span = keyframe.atMs - from.atMs
      const k = span <= 0 ? 1 : easeAt(keyframe.easing, (t - from.atMs) / span)
      let out = from.geometry
      for (const field of GEOMETRY_FIELDS) out = withField(out, field, lerp(fieldOf(from.geometry, field), fieldOf(geometry, field), k))
      return out
    }
    from = { atMs: keyframe.atMs, geometry }
  }
  return from.geometry
}

/** When a keyframed picture stops moving: its last keyframe's moment, or nought for none. */
export function keyframesEndMs(keyframes: readonly GeometryKeyframe[] | null | undefined): number {
  return keyframes === null || keyframes === undefined || keyframes.length === 0 ? 0 : keyframes[keyframes.length - 1].atMs
}

/** The properties a fade's target names, with the value each is moving to. */
export function targetFields(target: GeometryTarget | null | undefined): Array<[GeometryField, number]> {
  if (target === null || target === undefined) return []
  const fields: Array<[GeometryField, number]> = []
  if (typeof target.x === 'number') fields.push(['x', target.x])
  if (typeof target.y === 'number') fields.push(['y', target.y])
  if (typeof target.scale === 'number') fields.push(['scale', target.scale])
  if (typeof target.rotation === 'number') fields.push(['rotation', target.rotation])
  if (target.crop !== undefined && target.crop !== null) {
    fields.push(['cropTop', target.crop.top], ['cropRight', target.crop.right], ['cropBottom', target.crop.bottom], ['cropLeft', target.crop.left])
  }
  return fields.filter(([, value]) => Number.isFinite(value))
}

/** Whether a fade's target moves anything at all. */
export function movesGeometry(target: GeometryTarget | null | undefined): boolean {
  return targetFields(target).length > 0
}

/**
 * The moves after a fade cue lands on a picture: each property it names ramps from where it
 * is at `startMs` — `current` is the picture's geometry then, keyframes and earlier moves
 * included — to its target over `durationMs`. A property already under a move carries on
 * from wherever that move had got, never from where it was headed.
 */
export function moveGeometry(
  ramps: GeometryRamps,
  current: VisualGeometry,
  target: GeometryTarget,
  startMs: number,
  durationMs: number,
  curve: FadeCurve
): GeometryRamps {
  const next: GeometryRamps = { ...ramps }
  for (const [field, to] of targetFields(target)) {
    const running = ramps[field] ?? steady(fieldOf(current, field))
    next[field] = retarget(running, to, startMs, durationMs, curve)
  }
  return next
}

/** A geometry with the moves laid over it at `now`. */
export function withMoves(geometry: VisualGeometry, ramps: GeometryRamps, now: number): VisualGeometry {
  let out = geometry
  for (const field of GEOMETRY_FIELDS) {
    const ramp = ramps[field]
    if (ramp !== undefined) out = withField(out, field, rampAt(ramp, now))
  }
  return out
}

/**
 * The moves that survive an edit in the inspector: a property whose own value the operator
 * changed is theirs again, and every other move stands.
 */
export function movesAfterEdit(ramps: GeometryRamps, before: VisualGeometry, after: VisualGeometry): GeometryRamps {
  const next: GeometryRamps = {}
  for (const field of GEOMETRY_FIELDS) {
    const ramp = ramps[field]
    if (ramp !== undefined && fieldOf(before, field) === fieldOf(after, field)) next[field] = ramp
  }
  return next
}

/** A ramp's every time moved by `deltaMs`: the clock it is on was rebased, or held. */
export function shiftMoves(ramps: GeometryRamps, deltaMs: number): GeometryRamps {
  const next: GeometryRamps = {}
  for (const field of GEOMETRY_FIELDS) {
    const ramp = ramps[field]
    if (ramp !== undefined) next[field] = { ...ramp, startMs: ramp.startMs + deltaMs }
  }
  return next
}

// ─── Reading keyframes off disk ───────────────────────────────────────────────

function finiteIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback
}

/**
 * A cue's keyframes as the output draws them: each held to the ranges a geometry is, sorted by
 * their moment, one per moment (the later in the list wins), and no more than `MAX_KEYFRAMES`.
 * Anything that is not a keyframe is left out rather than refused: a keyframe is decoration on
 * a cue that still plays without it.
 */
export function normalizeKeyframes(value: unknown, base: VisualGeometry): GeometryKeyframe[] {
  if (!Array.isArray(value)) return []
  const byMoment = new Map<number, GeometryKeyframe>()
  for (const raw of value.slice(0, MAX_KEYFRAMES * 2)) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Partial<GeometryKeyframe>
    if (typeof entry.atMs !== 'number' || !Number.isFinite(entry.atMs)) continue
    const crop: Partial<VisualCrop> = typeof entry.crop === 'object' && entry.crop !== null ? entry.crop : {}
    const [cropMin, cropMax] = GEOMETRY_LIMITS.crop
    const atMs = Math.round(finiteIn(entry.atMs, 0, MAX_KEYFRAME_MS, 0))
    byMoment.set(atMs, {
      atMs,
      x: finiteIn(entry.x, GEOMETRY_LIMITS.offset[0], GEOMETRY_LIMITS.offset[1], base.x),
      y: finiteIn(entry.y, GEOMETRY_LIMITS.offset[0], GEOMETRY_LIMITS.offset[1], base.y),
      scale: finiteIn(entry.scale, GEOMETRY_LIMITS.scale[0], GEOMETRY_LIMITS.scale[1], base.scale),
      rotation: finiteIn(entry.rotation, GEOMETRY_LIMITS.rotation[0], GEOMETRY_LIMITS.rotation[1], base.rotation),
      crop: {
        top: finiteIn(crop.top, cropMin, cropMax, base.crop.top),
        right: finiteIn(crop.right, cropMin, cropMax, base.crop.right),
        bottom: finiteIn(crop.bottom, cropMin, cropMax, base.crop.bottom),
        left: finiteIn(crop.left, cropMin, cropMax, base.crop.left)
      },
      easing: KEYFRAME_EASINGS.includes(entry.easing as KeyframeEasing) ? entry.easing as KeyframeEasing : 'linear'
    })
  }
  return [...byMoment.values()].sort((a, b) => a.atMs - b.atMs).slice(0, MAX_KEYFRAMES)
}

/** A new keyframe at `atMs`, where the picture would be then: what "Add keyframe" puts in. */
export function keyframeAt(base: VisualGeometry, keyframes: readonly GeometryKeyframe[], atMs: number): GeometryKeyframe {
  const geometry = keyframedGeometry(base, keyframes, atMs)
  return {
    atMs: Math.max(0, Math.round(atMs)),
    x: geometry.x,
    y: geometry.y,
    scale: geometry.scale,
    rotation: geometry.rotation,
    crop: { ...geometry.crop },
    easing: 'linear'
  }
}
