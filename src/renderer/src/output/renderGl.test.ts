// The one piece of the GPU's blend pass that is arithmetic rather than a shader: the affine that
// placed a layer, turned round, which takes an output pixel back to the layer's own square.
import { describe, expect, it } from 'vitest'
import { inverseAffine } from './renderGl'
import { applyAffine, placeLayer } from '../../../shared/visualGeometry'
import { defaultGeometry } from '../../../shared/visual'

/** A point through a column-major 3×3, as the shader multiplies it. */
function through(m: number[], x: number, y: number): { u: number; v: number } {
  return { u: m[0] * x + m[3] * y + m[6], v: m[1] * x + m[4] * y + m[7] }
}

describe('the blend pass\'s inverse', () => {
  it('takes each corner of a placed, turned, cropped layer back to its own square', () => {
    const placement = placeLayer({ ...defaultGeometry(), x: 0.1, y: -0.2, scale: 0.6, rotation: 33, crop: { top: 0.1, right: 0, bottom: 0.2, left: 0.05 } },
      { width: 640, height: 360 }, { width: 1920, height: 1080 })
    const inverse = inverseAffine(placement.transform)!
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.25]]) {
      const point = applyAffine(placement.transform, u, v)
      const back = through(inverse, point.x, point.y)
      expect(back.u).toBeCloseTo(u, 6)
      expect(back.v).toBeCloseTo(v, 6)
    }
  })

  it('has no inverse for a layer squashed to nothing', () => {
    expect(inverseAffine([0, 0, 0, 0, 10, 10])).toBeNull()
  })
})
