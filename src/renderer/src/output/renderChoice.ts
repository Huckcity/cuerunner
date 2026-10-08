// Which renderer an output draws with: the GPU's when the machine gives the window WebGL 2,
// the 2D fallback when it does not — and the fallback on request, which only a development
// build can make (main passes `renderer=canvas` on the page's URL from a test-only switch;
// see `outputRendererOverride` in src/main/output/OutputManager.ts).

import type { Renderer } from './render'

export interface RendererFactories {
  /** The GPU renderer, or null where a WebGL 2 context could not be made. */
  gl(canvas: HTMLCanvasElement): Renderer | null
  canvas(canvas: HTMLCanvasElement): Renderer
}

export function chooseRenderer(
  canvas: HTMLCanvasElement,
  requested: string | null,
  make: RendererFactories
): Renderer {
  if (requested === 'canvas') return make.canvas(canvas)
  return make.gl(canvas) ?? make.canvas(canvas)
}
