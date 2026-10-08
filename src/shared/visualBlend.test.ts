// The blend modes as numbers: each mode's formula at the points that tell it from the others,
// the opacity mixing them over the backdrop, the 2D canvas's operation for each, and the mask.
import { describe, expect, it } from 'vitest'
import {
  BLEND_MODES,
  blendChannel,
  blendIndex,
  blendOf,
  blendPixel,
  canvasOperation,
  maskFactor,
  separable
} from './visualBlend'

const close = (value: number, expected: number): void => expect(value).toBeCloseTo(expected, 6)

describe('the blend modes', () => {
  it('has the fourteen modes, numbered for the shader in the order they are listed', () => {
    expect(BLEND_MODES).toHaveLength(14)
    expect(new Set(BLEND_MODES).size).toBe(14)
    expect(blendIndex('normal')).toBe(0)
    expect(blendIndex('add')).toBe(12)
    expect(blendIndex('subtract')).toBe(13)
    expect(blendOf('screen')).toBe('screen')
    expect(blendOf('glow')).toBe('normal')
    expect(blendOf(undefined)).toBe('normal')
  })

  it('computes each separable mode the way the compositing spec defines it', () => {
    const cb = 0.6
    const cs = 0.3
    close(separable('normal', cb, cs), 0.3)
    close(separable('multiply', cb, cs), 0.18)
    close(separable('screen', cb, cs), 0.72)
    // Overlay is hard light with the two swapped: the backdrop is above a half, so screen.
    close(separable('overlay', cb, cs), 1 - (1 - 0.3) * (1 - (2 * 0.6 - 1)))
    close(separable('darken', cb, cs), 0.3)
    close(separable('lighten', cb, cs), 0.6)
    close(separable('color-dodge', cb, cs), 0.6 / 0.7)
    close(separable('color-burn', cb, cs), 1 - Math.min(1, 0.4 / 0.3))
    // Hard light: the source is below a half, so multiply by twice it.
    close(separable('hard-light', cb, cs), 0.6 * 0.6)
    close(separable('soft-light', cb, cs), 0.6 - (1 - 0.6) * 0.6 * 0.4)
    close(separable('difference', cb, cs), 0.3)
    close(separable('exclusion', cb, cs), 0.6 + 0.3 - 2 * 0.18)
  })

  it('takes soft light\'s other branches: a bright source over a dark and over a light backdrop', () => {
    const dark = 0.2
    const d = ((16 * dark - 12) * dark + 4) * dark
    close(separable('soft-light', dark, 0.8), dark + 0.6 * (d - dark))
    close(separable('soft-light', 0.64, 0.8), 0.64 + 0.6 * (Math.sqrt(0.64) - 0.64))
  })

  it('holds the dodge and burn edges where a division would run away', () => {
    close(separable('color-dodge', 0, 1), 0)
    close(separable('color-dodge', 0.5, 1), 1)
    close(separable('color-burn', 1, 0), 1)
    close(separable('color-burn', 0.5, 0), 0)
  })

  it('mixes a mode over the backdrop by the layer\'s opacity, and adds or takes away light by it', () => {
    close(blendChannel('multiply', 0.6, 0.3, 0.5), 0.5 * 0.6 + 0.5 * 0.18)
    close(blendChannel('normal', 0.6, 0.3, 0), 0.6)
    close(blendChannel('add', 0.6, 0.3, 0.5), 0.75)
    close(blendChannel('add', 0.9, 0.5, 1), 1)
    close(blendChannel('subtract', 0.6, 0.3, 0.5), 0.45)
    close(blendChannel('subtract', 0.2, 0.5, 1), 0)
  })

  it('answers a whole pixel in bytes: the reference the renderers are held to', () => {
    expect(blendPixel('screen', [255, 0, 128], [0, 255, 128], 1).map(Math.round)).toEqual([255, 255, 192])
    expect(blendPixel('difference', [200, 100, 50], [50, 100, 200], 1).map(Math.round)).toEqual([150, 0, 150])
  })

  it('names the 2D canvas\'s own operation for each mode, and subtract as the one it draws itself', () => {
    expect(canvasOperation('normal')).toBe('source-over')
    expect(canvasOperation('add')).toBe('lighter')
    expect(canvasOperation('subtract')).toBe('subtract')
    for (const mode of BLEND_MODES.filter(mode => mode !== 'normal' && mode !== 'add' && mode !== 'subtract')) {
      expect(canvasOperation(mode)).toBe(mode)
    }
  })
})

describe('a mask', () => {
  it('lets through as much as the image is bright, or opaque, and the other way round inverted', () => {
    expect(maskFactor('luma', false, [255, 255, 255, 255])).toBeCloseTo(1)
    expect(maskFactor('luma', false, [0, 0, 0, 255])).toBe(0)
    expect(maskFactor('luma', true, [0, 0, 0, 255])).toBe(1)
    expect(maskFactor('luma', false, [255, 0, 0, 255])).toBeCloseTo(0.2126)
    // Read by brightness, a clear part of the image is dark.
    expect(maskFactor('luma', false, [255, 255, 255, 0])).toBe(0)
    expect(maskFactor('alpha', false, [0, 0, 0, 128])).toBeCloseTo(128 / 255)
    expect(maskFactor('alpha', true, [0, 0, 0, 255])).toBe(0)
  })
})
