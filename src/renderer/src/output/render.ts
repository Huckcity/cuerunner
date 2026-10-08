// What a renderer is handed each frame, and the two that take it: the GPU's (WebGL 2) and
// the 2D canvas a machine without WebGL falls back to. They draw the same plan — the same
// layers, in the same order, at the same places — so the fallback is a slower picture, not a
// different one; the one thing it cannot do is pin corners, which needs a projective map the
// 2D context has no way to draw, and the output says so on screen.

import type { LayerPlacement } from '../../../shared/visualGeometry'
import type { OutputWarp } from '../../../shared/visual'
import type { Drawable } from './sources'

export interface DrawItem {
  /** The texture's key: a layer's cue id, or an overlay's own name. */
  key: string
  source: Drawable
  placement: LayerPlacement
  opacity: number
}

export type FramePlan =
  | { kind: 'single'; draws: DrawItem[] }
  | { kind: 'dissolve'; before: DrawItem[]; after: DrawItem[]; progress: number }

export interface Frame {
  plan: FramePlan
  /** Drawn over everything, inside the warp: the timer, the test pattern. */
  overlays: DrawItem[]
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
}
