import { describe, expect, it } from 'vitest'
import { blendFactor, invert3, isConvexQuad, project, squareToQuad, warpQuad, warpSampler } from './visualWarp'
import { identityWarp, isIdentityWarp, type OutputWarp } from './visual'

function warp(patch: Partial<OutputWarp>): OutputWarp {
  return { ...identityWarp(), ...patch }
}

describe('corner pin', () => {
  it('maps the unit square\'s corners onto the four pinned corners', () => {
    const quad = warpQuad([{ x: 0.1, y: 0.05 }, { x: -0.1, y: 0 }, { x: 0, y: -0.2 }, { x: 0.05, y: 0 }])
    const forward = squareToQuad(quad)!
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]]
    corners.forEach(([u, v], i) => {
      const point = project(forward, u, v)
      expect(point.x).toBeCloseTo(quad[i].x, 9)
      expect(point.y).toBeCloseTo(quad[i].y, 9)
    })
  })

  it('samples back through the inverse: a window point lands where the frame put it', () => {
    const pinned = warp({ corners: [{ x: 0.1, y: 0.1 }, { x: 0, y: 0 }, { x: -0.15, y: 0 }, { x: 0, y: -0.05 }] })
    const forward = squareToQuad(warpQuad(pinned.corners))!
    const sampler = warpSampler(pinned)!
    for (const [u, v] of [[0.5, 0.5], [0.2, 0.8], [0.9, 0.1]]) {
      const onWindow = project(forward, u, v)
      const back = project(sampler, onWindow.x, onWindow.y)
      expect(back.x).toBeCloseTo(u, 9)
      expect(back.y).toBeCloseTo(v, 9)
    }
  })

  it('is affine for a parallelogram, and inverts exactly', () => {
    const forward = squareToQuad(warpQuad([{ x: 0.1, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0 }]))!
    expect(forward.slice(6)).toEqual([0, 0, 1])
    const round = project(invert3(forward)!, ...Object.values(project(forward, 0.3, 0.7)) as [number, number])
    expect(round.x).toBeCloseTo(0.3)
    expect(round.y).toBeCloseTo(0.7)
  })

  it('draws an unpinned frame as it is, and refuses a pin that folds the picture over itself', () => {
    expect(warpSampler(identityWarp())).toBeNull()
    // The top-left corner dragged past the bottom-right: the quad crosses itself.
    const folded = warp({ corners: [{ x: 1.2, y: 1.2 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] })
    expect(isConvexQuad(warpQuad(folded.corners))).toBe(false)
    expect(warpSampler(folded)).toBeNull()
  })

  it('knows a warp that changes nothing, so its pass can be skipped', () => {
    expect(isIdentityWarp(identityWarp())).toBe(true)
    expect(isIdentityWarp(warp({ blend: { left: 0.1, right: 0, top: 0, bottom: 0 } }))).toBe(false)
  })
})

describe('soft edges', () => {
  it('ramps an edge from nothing at the border to full at the blend\'s width', () => {
    const edged = warp({ blend: { left: 0.2, right: 0, top: 0, bottom: 0 } })
    expect(blendFactor(edged, 0, 0.5)).toBe(0)
    expect(blendFactor(edged, 0.1, 0.5)).toBeCloseTo(0.5)
    expect(blendFactor(edged, 0.2, 0.5)).toBe(1)
    expect(blendFactor(edged, 0.9, 0.5)).toBe(1)
  })

  it('bends the ramp by the gamma, and multiplies two edges in a corner', () => {
    const curved = warp({ blend: { left: 0.2, right: 0, top: 0.2, bottom: 0 }, gamma: 2 })
    expect(blendFactor(curved, 0.1, 0.5)).toBeCloseTo(0.25)
    expect(blendFactor(curved, 0.1, 0.1)).toBeCloseTo(0.0625)
  })
})
