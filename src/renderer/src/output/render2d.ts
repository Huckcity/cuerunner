// The 2D fallback, for a machine whose GPU Chromium will not give WebGL to.
//
// The same plan as the GPU's: layers back to front at their affine placements, a dissolve
// as the two stacks summed — the old one at one minus the progress on black, the new one
// added at the progress, which is the GPU's mix to the rounding of a byte — and soft edges as
// gradients laid over the finished frame. A corner pin is the one thing it cannot draw: the
// 2D context has affine transforms only, and the output says so rather than drawing it wrong.
//
// Every blend mode is the context's own composite operation by the same name, which is the
// formula the GPU's shader draws (visualBlend.ts); add is `lighter`, and subtract — which the
// context has no operation for — is add between two inversions of the frame. A mask is laid
// over the pictures as black, as clear as the mask lets them show, prepared once per image and
// size rather than every frame.

import type { Frame, DrawItem, MaskItem, Renderer } from './render'
import { canvasOperation, maskFactor } from '../../../shared/visualBlend'

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
  /** The mask, as black laid over the frame, and what it was made from. */
  private maskOverlay: { key: string; canvas: HTMLCanvasElement } | null = null

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
    this.applyMask(frame.mask)
    drawItems(context, frame.overlays)
    this.softEdges(frame)
  }

  private applyMask(mask: MaskItem | null): void {
    if (mask === null || !mask.source.ready || mask.source.width <= 0 || mask.source.height <= 0) return
    const key = `${mask.filePath}|${mask.mode}|${mask.invert}|${mask.source.version}|${this.width}x${this.height}`
    if (this.maskOverlay?.key !== key) {
      const canvas = this.maskOverlay?.canvas ?? document.createElement('canvas')
      canvas.width = this.width
      canvas.height = this.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) return
      context.clearRect(0, 0, this.width, this.height)
      context.drawImage(mask.source.element, 0, 0, this.width, this.height)
      const pixels = context.getImageData(0, 0, this.width, this.height)
      const data = pixels.data
      for (let i = 0; i < data.length; i += 4) {
        // Black, as opaque as the mask hides: laid over the frame, it leaves `k` of each pixel.
        const k = maskFactor(mask.mode, mask.invert, [data[i], data[i + 1], data[i + 2], data[i + 3]])
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = Math.round((1 - k) * 255)
      }
      context.putImageData(pixels, 0, 0)
      this.maskOverlay = { key, canvas }
    }
    const context = this.context
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
    context.drawImage(this.maskOverlay.canvas, 0, 0)
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
    const operation = canvasOperation(item.blend)
    // Subtract is add between two inversions of the frame: 1 − ((1 − Cb) + α·Cs) = Cb − α·Cs.
    if (operation === 'subtract') invert(context)
    const [a, b, c, d, e, f] = item.placement.transform
    const s = item.placement.source
    context.setTransform(a, b, c, d, e, f)
    context.globalAlpha = Math.min(Math.max(item.opacity, 0), 1)
    context.globalCompositeOperation = operation === 'subtract' ? 'lighter' : operation
    try {
      context.drawImage(item.source.element, s.x, s.y, s.width, s.height, 0, 0, 1, 1)
    } catch {
      // A video with no frame to give yet: nothing is drawn for it this time.
    }
    context.globalCompositeOperation = 'source-over'
    if (operation === 'subtract') invert(context)
  }
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
}

/** Every pixel of the frame turned to its opposite: white, by difference. */
function invert(context: CanvasRenderingContext2D): void {
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'difference'
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, context.canvas.width, context.canvas.height)
  context.globalCompositeOperation = 'source-over'
}
