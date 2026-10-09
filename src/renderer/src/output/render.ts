// What a renderer is handed each frame, and the two that take it: the GPU's (WebGL 2) and
// the 2D canvas a machine without WebGL falls back to. They draw the same plan — the same
// layers, in the same order, at the same places — so the fallback is a slower picture, not a
// different one; the one thing it cannot do is pin corners, which needs a projective map the
// 2D context has no way to draw, and the output says so on screen.
//
// Both draw every blend mode (src/shared/visualBlend.ts) and an output's mask, to the same
// numbers: the GPU blends a layer against the frame under it in a pass of its own, the 2D
// context with the composite operation of the same name.

import type { LayerPlacement } from '../../../shared/visualGeometry'
import type { OutputWarp } from '../../../shared/visual'
import type { BlendMode } from '../../../shared/visualBlend'
import type { Drawable } from './sources'

export interface DrawItem {
  /** The texture's key: a layer's cue id, or an overlay's own name. */
  key: string
  source: Drawable
  placement: LayerPlacement
  opacity: number
  /** How it is laid over what is drawn before it. */
  blend: BlendMode
}

/** An output's mask: an image stretched over the frame, saying how much of the pictures shows. */
export interface MaskItem {
  key: string
  source: Drawable
  mode: 'luma' | 'alpha'
  invert: boolean
  /** The file it was read from: the 2D fallback keeps its prepared mask by it. */
  filePath: string
}

export type FramePlan =
  | { kind: 'single'; draws: DrawItem[] }
  | { kind: 'dissolve'; before: DrawItem[]; after: DrawItem[]; progress: number }

export interface Frame {
  plan: FramePlan
  /** Drawn over everything, inside the warp: the timer, the test pattern. */
  overlays: DrawItem[]
  /** Laid over the pictures — after the plan, before the overlays — or null for none. */
  mask: MaskItem | null
  warp: OutputWarp
}

export interface Renderer {
  readonly kind: 'webgl' | 'canvas'
  /** Whether this renderer can pin corners. */
  readonly pins: boolean
  resize(width: number, height: number): void
  draw(frame: Frame): void
  /** A layer is gone: its texture can go too. */
  release(key: string): void
  /**
   * One pixel of the last frame drawn, RGBA, read straight from the renderer's own surface —
   * one pixel's worth of work, so reading it does not slow the output it is reading.
   */
  readPixel(x: number, y: number): number[]
}
