import { describe, expect, it } from 'vitest'
import { compositePixel, dissolveTargets, mixPixel, planComposition, stackOrder, type PlanLayer } from './visualComposition'

const layer = (cueId: string, z: number, seq: number, opacity = 1): PlanLayer => ({ cueId, layer: z, seq, opacity })

describe('the order a frame is drawn in', () => {
  it('draws back to front by layer, and on one layer the later firing in front', () => {
    const ordered = stackOrder([layer('title', 5, 1), layer('b', 1, 3), layer('a', 1, 2)])
    expect(ordered.map(entry => entry.cueId)).toEqual(['a', 'b', 'title'])
  })

  it('leaves a picture faded to nothing out of the frame', () => {
    const plan = planComposition([layer('a', 1, 1, 0), layer('b', 1, 2, 1)], null)
    expect(plan).toEqual({ kind: 'single', draws: [layer('b', 1, 2, 1)] })
  })
})

describe('a dissolve', () => {
  const background = layer('bg', 1, 1)
  const incoming = layer('next', 1, 2)
  const title = layer('title', 9, 3)

  it('is the stack without the incoming picture and the stack without the outgoing one', () => {
    const plan = planComposition([background, incoming, title], { incoming: 'next', outgoing: ['bg'], progress: 0.25 })
    expect(plan).toEqual({ kind: 'dissolve', before: [background, title], after: [incoming, title], progress: 0.25 })
  })

  it('is the old frame alone before it starts and the new one alone once it lands', () => {
    expect(planComposition([background, incoming], { incoming: 'next', outgoing: ['bg'], progress: 0 }))
      .toEqual({ kind: 'single', draws: [background] })
    expect(planComposition([background, incoming], { incoming: 'next', outgoing: ['bg'], progress: 1 }))
      .toEqual({ kind: 'single', draws: [incoming] })
  })

  it('takes down what is at or below the incoming picture, and leaves what is in front', () => {
    const layers = [layer('bg', 1, 1), layer('lower', 0, 2), layer('title', 9, 3)]
    expect(dissolveTargets(layers, { cueId: 'next', layer: 1 })).toEqual(['bg', 'lower'])
  })

  it('never dips through black: half way, two opaque pictures are half each', () => {
    const red = [255, 0, 0]
    const magenta = [255, 0, 255]
    const exact = mixPixel(compositePixel([{ rgb: magenta, alpha: 1 }]), compositePixel([{ rgb: red, alpha: 1 }]), 0.5)
    expect(exact).toEqual([255, 0, 127.5])
    // The naive way — the new one fading up over the old one fading down — loses a quarter
    // of the channel both pictures share at the half-way point.
    const naive = compositePixel([{ rgb: magenta, alpha: 0.5 }, { rgb: red, alpha: 0.5 }])
    expect(naive[0]).toBeLessThan(200)
  })

  it('dissolves a letterboxed picture\'s bars to black, never to the picture it replaced', () => {
    // A pixel in the incoming picture's bars: nothing of it drawn there.
    const outgoingThere = compositePixel([{ rgb: [200, 200, 200], alpha: 1 }])
    const incomingThere = compositePixel([])
    expect(mixPixel(outgoingThere, incomingThere, 1)).toEqual([0, 0, 0])
  })
})
