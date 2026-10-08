// What an output draws this frame, and in what order: the plan both renderers carry out.
//
// A frame is the visible layers, back to front — by layer number, and on one layer by the
// order they were fired in, the newest in front. A dissolve is the one frame that is two:
// the stack as it was without the incoming picture, and the stack as it will be without the
// outgoing ones, mixed by the dissolve's progress. That mix is what makes it exact — at the
// half-way point the output is half the old frame and half the new, so a picture never dips
// through black (as two layers fading against each other do), and a letterboxed incoming
// video does not show the outgoing one through its bars at the end. Layers in front of the
// dissolve, and behind it, are in both stacks, so the mix leaves them exactly as they were.

export interface PlanLayer {
  cueId: string
  layer: number
  /** Firing order: on one layer the later firing is in front. */
  seq: number
  /** What the layer is drawn at this frame, after every fade. */
  opacity: number
}

export interface PlannedDissolve {
  incoming: string
  outgoing: readonly string[]
  /** 0–1. */
  progress: number
}

export type CompositionPlan =
  | { kind: 'single'; draws: PlanLayer[] }
  | { kind: 'dissolve'; before: PlanLayer[]; after: PlanLayer[]; progress: number }

/** Back to front: layer, then firing order. */
export function stackOrder(layers: readonly PlanLayer[]): PlanLayer[] {
  return [...layers].sort((a, b) => a.layer - b.layer || a.seq - b.seq)
}

/** A layer at nothing draws nothing: it is left out of the plan rather than drawn transparent. */
function visible(layer: PlanLayer): boolean {
  return layer.opacity > 0.0005
}

export function planComposition(
  layers: readonly PlanLayer[],
  dissolve: PlannedDissolve | null
): CompositionPlan {
  const ordered = stackOrder(layers)
  if (dissolve === null || dissolve.progress >= 1 || !ordered.some(layer => layer.cueId === dissolve.incoming)) {
    const outgoing = dissolve !== null && dissolve.progress >= 1 ? new Set(dissolve.outgoing) : new Set<string>()
    return { kind: 'single', draws: ordered.filter(layer => visible(layer) && !outgoing.has(layer.cueId)) }
  }
  const outgoing = new Set(dissolve.outgoing)
  const before = ordered.filter(layer => layer.cueId !== dissolve.incoming && visible(layer))
  const after = ordered.filter(layer => !outgoing.has(layer.cueId) && visible(layer))
  if (dissolve.progress <= 0) return { kind: 'single', draws: before }
  return { kind: 'dissolve', before, after, progress: dissolve.progress }
}

/**
 * The cues a crossfade into `incoming` takes down: what is on the output at or below the
 * incoming picture's layer, the incoming one aside. A layer in front of it is the show's to
 * keep — a title over a dissolving background stays where it is.
 */
export function dissolveTargets(
  layers: ReadonlyArray<Pick<PlanLayer, 'cueId' | 'layer'>>,
  incoming: { cueId: string; layer: number }
): string[] {
  return layers
    .filter(layer => layer.cueId !== incoming.cueId && layer.layer <= incoming.layer)
    .map(layer => layer.cueId)
}

/**
 * The colour a dissolve produces from the two stacks' colours at one pixel: the reference the
 * renderers are held to (the GPU's shader, the 2D fallback's additive pair).
 */
export function mixPixel(before: readonly number[], after: readonly number[], progress: number): number[] {
  const t = Math.min(Math.max(progress, 0), 1)
  return before.map((value, i) => value * (1 - t) + (after[i] ?? 0) * t)
}

/**
 * The colour of a stack at one pixel, each layer's colour over what is behind it at its
 * opacity, starting from black: the reference a frame is held to.
 */
export function compositePixel(stack: ReadonlyArray<{ rgb: readonly number[]; alpha: number }>): number[] {
  let out = [0, 0, 0]
  for (const { rgb, alpha } of stack) {
    const a = Math.min(Math.max(alpha, 0), 1)
    out = out.map((value, i) => value * (1 - a) + (rgb[i] ?? 0) * a)
  }
  return out
}
