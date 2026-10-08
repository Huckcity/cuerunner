import { describe, expect, it, vi } from 'vitest'
import { chooseRenderer } from './renderChoice'
import { GlRenderer } from './renderGl'
import type { Renderer } from './render'

const fake = (kind: 'webgl' | 'canvas'): Renderer => ({
  kind, pins: kind === 'webgl', resize: () => {}, draw: () => {}, release: () => {}
})

describe('which renderer an output draws with', () => {
  it('takes the GPU when a WebGL 2 context can be made', () => {
    const made = chooseRenderer(document.createElement('canvas'), null, { gl: () => fake('webgl'), canvas: () => fake('canvas') })
    expect(made.kind).toBe('webgl')
  })

  it('falls back to the 2D canvas when the WebGL context cannot be made', () => {
    // The real GPU renderer, on a canvas that will not give it a context: it says so with
    // null rather than throwing, and the choice takes the fallback.
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(null)
    expect(GlRenderer.create(canvas)).toBeNull()
    const canvasFactory = vi.fn(() => fake('canvas'))
    const made = chooseRenderer(canvas, null, { gl: target => GlRenderer.create(target), canvas: canvasFactory })
    expect(made.kind).toBe('canvas')
    expect(canvasFactory).toHaveBeenCalledOnce()
  })

  it('draws on the 2D canvas when asked, without trying the GPU', () => {
    const gl = vi.fn(() => fake('webgl'))
    const made = chooseRenderer(document.createElement('canvas'), 'canvas', { gl, canvas: () => fake('canvas') })
    expect(made.kind).toBe('canvas')
    expect(gl).not.toHaveBeenCalled()
  })
})
