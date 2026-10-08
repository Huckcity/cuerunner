import { describe, expect, it } from 'vitest'
import {
  addMarker,
  moveMarker,
  normalizeSlices,
  playCountLabel,
  removeMarker,
  setPlayCount,
  slicedLengthMs,
  slicePieces,
  slicesInUse,
  SLICE_VAMP
} from './slices'

describe('slices', () => {
  const slices = { markers: [1000, 2000], playCounts: [2, SLICE_VAMP, 1] }

  it('cut the region at the markers inside it, each piece with its count', () => {
    expect(slicePieces(slices, 0, 3000)).toEqual([
      { startTime: 0, endTime: 1000, playCount: 2 },
      { startTime: 1000, endTime: 2000, playCount: -1 },
      { startTime: 2000, endTime: 3000, playCount: 1 }
    ])
  })

  it('keep a marker outside the region and cut nothing with it, its count staying on its music', () => {
    // The region starts after the first marker: the piece that holds the region's start is
    // the second, which vamps.
    expect(slicePieces(slices, 1500, 2500)).toEqual([
      { startTime: 1500, endTime: 2000, playCount: -1 },
      { startTime: 2000, endTime: 2500, playCount: 1 }
    ])
    expect(slicePieces(slices, 0, 800)).toEqual([{ startTime: 0, endTime: 800, playCount: 2 }])
  })

  it('know how long a counted run is, and that a vamp has no length', () => {
    expect(slicedLengthMs(slicePieces({ markers: [1000], playCounts: [2, 1] }, 0, 3000))).toBe(4000)
    expect(slicedLengthMs(slicePieces({ markers: [1000], playCounts: [2, 1] }, 0, 3000), 2)).toBe(2000)
    expect(slicedLengthMs(slicePieces(slices, 0, 3000))).toBeNull()
  })

  it('are not in use with no marker and a count of one: the cue is its region', () => {
    expect(slicesInUse(null)).toBe(false)
    expect(slicesInUse({ markers: [], playCounts: [1] })).toBe(false)
    expect(slicesInUse({ markers: [], playCounts: [SLICE_VAMP] })).toBe(true)
    expect(slicesInUse(slices)).toBe(true)
  })

  it('split a piece where a marker is added, both halves keeping its count', () => {
    expect(addMarker({ markers: [1000], playCounts: [1, 3] }, 1500)).toEqual({ markers: [1000, 1500], playCounts: [1, 3, 3] })
    expect(addMarker(null, 500)).toEqual({ markers: [500], playCounts: [1, 1] })
  })

  it('join two pieces where a marker is taken out, keeping the first one\'s count', () => {
    expect(removeMarker(slices, 0)).toEqual({ markers: [2000], playCounts: [2, 1] })
  })

  it('move a marker no further than its neighbours', () => {
    expect(moveMarker(slices, 0, 5000).markers).toEqual([1999, 2000])
    expect(moveMarker(slices, 1, 100).markers).toEqual([1000, 1001])
  })

  it('count passes from one, or until released', () => {
    expect(setPlayCount(slices, 2, 0).playCounts[2]).toBe(1)
    expect(setPlayCount(slices, 2, -5).playCounts[2]).toBe(SLICE_VAMP)
    expect(setPlayCount(slices, 2, 4.4).playCounts[2]).toBe(4)
    expect(playCountLabel(SLICE_VAMP)).toBe('∞')
    expect(playCountLabel(3)).toBe('×3')
  })

  it('read what a file carries, sorted, deduplicated and with a count per piece', () => {
    expect(normalizeSlices({ markers: [2000, 1000, 1000, -4, 'x'], playCounts: [3] }))
      .toEqual({ markers: [1000, 2000], playCounts: [3, 1, 1] })
    expect(normalizeSlices({ markers: 'no' })).toBeNull()
    expect(normalizeSlices(null)).toBeNull()
  })
})
