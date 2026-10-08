import { describe, expect, it } from 'vitest'
import { applyAffine, compositionSize, cropRect, fitScale, gridCentre, placeLayer, placementCorners, safeCrop, textGeometry } from './visualGeometry'
import { defaultGeometry, type VisualGeometry } from './visual'

const HD = { width: 1920, height: 1080 }

function geometry(patch: Partial<VisualGeometry> = {}): VisualGeometry {
  return { ...defaultGeometry(), ...patch }
}

function close(a: number, b: number, tolerance = 1e-6): boolean {
  return Math.abs(a - b) <= tolerance
}

describe('where a picture lands', () => {
  it('fits a 4:3 picture into a 16:9 output with bars at the sides, centred', () => {
    const placement = placeLayer(geometry(), { width: 640, height: 480 }, HD)
    expect(placement.size).toEqual({ width: 1440, height: 1080 })
    const [topLeft, , bottomRight] = placementCorners(placement)
    expect(topLeft).toEqual({ x: 240, y: 0 })
    expect(bottomRight).toEqual({ x: 1680, y: 1080 })
  })

  it('fills the output, spilling the long side over its edges', () => {
    const placement = placeLayer(geometry({ fit: 'fill' }), { width: 640, height: 480 }, HD)
    expect(placement.size.width).toBe(1920)
    expect(placement.size.height).toBe(1440)
  })

  it('stretches to the output\'s shape, and sizes native one pixel per pixel', () => {
    expect(placeLayer(geometry({ fit: 'stretch' }), { width: 640, height: 480 }, HD).size).toEqual(HD)
    expect(placeLayer(geometry({ fit: 'native' }), { width: 640, height: 480 }, HD).size).toEqual({ width: 640, height: 480 })
  })

  it('moves by fractions of the output and scales about the picture\'s own centre', () => {
    const placement = placeLayer(geometry({ x: 0.25, y: -0.1, scale: 0.5 }), HD, HD)
    const centre = applyAffine(placement.transform, 0.5, 0.5)
    expect(centre.x).toBeCloseTo(960 + 480)
    expect(centre.y).toBeCloseTo(540 - 108)
    expect(placement.size).toEqual({ width: 960, height: 540 })
  })

  it('turns clockwise on screen, about the centre, keeping its size', () => {
    const placement = placeLayer(geometry({ rotation: 90 }), { width: 200, height: 100 }, { width: 1000, height: 1000 })
    const [topLeft, topRight] = placementCorners(placement)
    // The top edge, turned a quarter clockwise with y down, runs downwards on screen.
    expect(close(topLeft.x, topRight.x, 1e-6)).toBe(true)
    expect(topRight.y).toBeGreaterThan(topLeft.y)
    const centre = applyAffine(placement.transform, 0.5, 0.5)
    expect(centre.x).toBeCloseTo(500)
    expect(centre.y).toBeCloseTo(500)
  })

  it('draws only the part a crop leaves, fitted as that part', () => {
    const crop = { top: 0, right: 0.5, bottom: 0, left: 0 }
    const placement = placeLayer(geometry({ crop }), { width: 1920, height: 1080 }, HD)
    expect(placement.source).toEqual({ x: 0, y: 0, width: 960, height: 1080 })
    // A half-width picture fitted into a 16:9 output is as tall as the output.
    expect(placement.size.height).toBe(1080)
    expect(placement.size.width).toBe(960)
  })

  it('never crops a picture away entirely', () => {
    const safe = safeCrop({ top: 0.9, right: 0.9, bottom: 0.9, left: 0.9 })
    expect(safe.left + safe.right).toBeLessThan(1)
    expect(safe.top + safe.bottom).toBeLessThan(1)
    expect(cropRect({ width: 100, height: 100 }, safe).width).toBeGreaterThan(0)
    expect(safeCrop({ top: Number.NaN, right: -1, bottom: 2, left: 0.1 })).toEqual({ top: 0, right: 0, bottom: 0.95, left: 0.1 })
  })

  it('treats a source with no size yet as nothing to fit', () => {
    expect(fitScale('fit', { width: 0, height: 0 }, HD)).toEqual({ x: 1, y: 1 })
  })
})

describe('text and the grid', () => {
  it('anchors a block at the nine points, a margin in from the edges', () => {
    const block = { width: 200, height: 100 }
    expect(gridCentre('top-left', block, HD, 50)).toEqual({ x: 150, y: 100 })
    expect(gridCentre('center', block, HD, 50)).toEqual({ x: 960, y: 540 })
    expect(gridCentre('bottom-right', block, HD, 50)).toEqual({ x: 1920 - 150, y: 1080 - 100 })
    expect(gridCentre('top', block, HD, 50)).toEqual({ x: 960, y: 100 })
    expect(gridCentre('left', block, HD, 50)).toEqual({ x: 150, y: 540 })
  })

  it('draws text at its own size, never refitted or cropped', () => {
    const text = textGeometry(geometry({ fit: 'fill', crop: { top: 0.2, right: 0, bottom: 0, left: 0 } }))
    expect(text.fit).toBe('native')
    expect(text.crop).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })
})

describe('the size an output composes at', () => {
  it('is the display\'s pixels fullscreen, and the declared size otherwise', () => {
    expect(compositionSize({ width: 1280, height: 720 }, { width: 1920, height: 1080, scaleFactor: 2 })).toEqual({ width: 3840, height: 2160 })
    expect(compositionSize({ width: 1280, height: 720 }, null)).toEqual({ width: 1280, height: 720 })
    expect(compositionSize({ width: 2, height: 2 }, null)).toEqual({ width: 16, height: 16 })
  })
})
