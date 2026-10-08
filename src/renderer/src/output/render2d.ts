// The 2D fallback, for a machine whose GPU Chromium will not give WebGL to.
//
// The same plan as the GPU's: layers back to front at their affine placements, a dissolve
// as the two stacks summed — the old one at one minus the progress on black, the new one
// added at the progress, which is the GPU's mix to the rounding of a byte — and soft edges as
// gradients laid over the finished frame. A corner pin is the one thing it cannot draw: the
// 2D context has affine transforms only, and the output says so rather than drawing it wrong.

import type { Frame, DrawItem, Renderer } from './render'

/** Steps a soft edge's curve is drawn in. */
const BLEND_STOPS = 16

export class CanvasRenderer implements Renderer {
  readonly kind = 'canvas' as const
  readonly pins = false
  private readonly context: CanvasRenderingContext2D
  private readonly before = document.createElement('canvas')
  private readonly after = document.createElement('canvas')
  private width = 1
  private height = 1

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false })
    if (context === null) throw new Error('this window can draw neither WebGL nor a 2D canvas')
    this.context = context
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    for (const canvas of [this.canvas, this.before, this.after]) {
      if (canvas.width !== this.width) canvas.width = this.width
      if (canvas.height !== this.height) canvas.height = this.height
    }
  }

  readPixel(x: number, y: number): number[] {
    return Array.from(this.context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data)
  }

  release(): void {
    // Nothing is uploaded: the 2D context draws from the element itself.
  }

  draw(frame: Frame): void {
    const context = this.context
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
    context.fillStyle = '#000000'
    context.fillRect(0, 0, this.width, this.height)
    if (frame.plan.kind === 'dissolve') {
      this.stackInto(this.before, frame.plan.before)
      this.stackInto(this.after, frame.plan.after)
      context.globalAlpha = 1 - frame.plan.progress
      context.drawImage(this.before, 0, 0)
      context.globalCompositeOperation = 'lighter'
      context.globalAlpha = frame.plan.progress
      context.drawImage(this.after, 0, 0)
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
    } else {
      drawItems(context, frame.plan.draws)
    }
    drawItems(context, frame.overlays)
    this.softEdges(frame)
  }

  private stackInto(canvas: HTMLCanvasElement, items: DrawItem[]): void {
    const context = canvas.getContext('2d')
    if (context === null) return
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalAlpha = 1
    context.fillStyle = '#000000'
    context.fillRect(0, 0, canvas.width, canvas.height)
    drawItems(context, items)
  }

  private softEdges(frame: Frame): void {
    const { blend, gamma } = frame.warp
    const context = this.context
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalAlpha = 1
    const edge = (x0: number, y0: number, x1: number, y1: number, rect: [number, number, number, number]): void => {
      const gradient = context.createLinearGradient(x0, y0, x1, y1)
      for (let i = 0; i <= BLEND_STOPS; i++) {
        const t = i / BLEND_STOPS
        // Multiplying by the ramp is laying black over the frame at one minus it.
        gradient.addColorStop(t, `rgba(0,0,0,${1 - Math.pow(t, Math.max(gamma, 0.1))})`)
      }
      context.fillStyle = gradient
      context.fillRect(...rect)
    }
    const w = this.width
    const h = this.height
    if (blend.left > 0) edge(0, 0, blend.left * w, 0, [0, 0, blend.left * w, h])
    if (blend.right > 0) edge(w, 0, w - blend.right * w, 0, [w - blend.right * w, 0, blend.right * w, h])
    if (blend.top > 0) edge(0, 0, 0, blend.top * h, [0, 0, w, blend.top * h])
    if (blend.bottom > 0) edge(0, h, 0, h - blend.bottom * h, [0, h - blend.bottom * h, w, blend.bottom * h])
  }
}

function drawItems(context: CanvasRenderingContext2D, items: DrawItem[]): void {
  for (const item of items) {
    if (!item.source.ready || item.source.width <= 0 || item.source.height <= 0) continue
    const [a, b, c, d, e, f] = item.placement.transform
    const s = item.placement.source
    context.setTransform(a, b, c, d, e, f)
    context.globalAlpha = Math.min(Math.max(item.opacity, 0), 1)
    try {
      context.drawImage(item.source.element, s.x, s.y, s.width, s.height, 0, 0, 1, 1)
    } catch {
      // A video with no frame to give yet: nothing is drawn for it this time.
    }
  }
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
}
