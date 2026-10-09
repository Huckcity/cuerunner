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
  slicesRefusal,
  SLICE_SKIP,
  SLICE_VAMP
} from './slices'
import { AUDIO_MAX_SLICES } from './audio'

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

  it('count passes from none, which skips the piece, or until released', () => {
    expect(setPlayCount(slices, 2, 0).playCounts[2]).toBe(SLICE_SKIP)
    expect(setPlayCount(slices, 2, -5).playCounts[2]).toBe(SLICE_VAMP)
    expect(setPlayCount(slices, 2, 4.4).playCounts[2]).toBe(4)
    expect(setPlayCount(slices, 2, 0.4).playCounts[2]).toBe(SLICE_SKIP)
    expect(playCountLabel(SLICE_VAMP)).toBe('∞')
    expect(playCountLabel(SLICE_SKIP)).toBe('skip')
    expect(playCountLabel(3)).toBe('×3')
  })

  it('send a skipped piece to the engine as it is, and count no time for it', () => {
    // The engine passes over a piece that plays no times (native/audio/tests/slices.mjs); the
    // window only has to say so, and leave it out of how long the cue runs.
    const cut = { markers: [1000, 2000], playCounts: [1, SLICE_SKIP, 1] }
    expect(slicePieces(cut, 0, 3000)).toEqual([
      { startTime: 0, endTime: 1000, playCount: 1 },
      { startTime: 1000, endTime: 2000, playCount: 0 },
      { startTime: 2000, endTime: 3000, playCount: 1 }
    ])
    expect(slicedLengthMs(slicePieces(cut, 0, 3000))).toBe(2000)
    expect(slicesInUse({ markers: [], playCounts: [SLICE_SKIP] })).toBe(true)
  })

  it('hold a file’s slices to what this build writes, bounded by what a start carries', () => {
    expect(slicesRefusal(undefined)).toBeNull()
    expect(slicesRefusal(null)).toBeNull()
    expect(slicesRefusal({ markers: [52.0194, 1477.135], playCounts: [0, -1, 999] })).toBeNull()
    expect(slicesRefusal({ markers: [], playCounts: [] })).toBe('a slice play count missing or to spare')
    expect(slicesRefusal({ markers: [1, 2], playCounts: [1, 1000, 1] })).toBe('a slice play count of 1000')
    expect(slicesRefusal({ markers: [2, 2], playCounts: [1, 1, 1] })).toBe('slice markers out of order')
    expect(slicesRefusal({ markers: [-1], playCounts: [1, 1] })).toBe('a slice marker that is not a time in the file')
    expect(slicesRefusal([1, 2])).toBe('slices that are not markers and counts')
    const many = Array.from({ length: AUDIO_MAX_SLICES }, (_, i) => i + 1)
    expect(slicesRefusal({ markers: many, playCounts: [...many, 1].map(() => 1) }))
      .toBe(`${AUDIO_MAX_SLICES} slice markers, and a cue has at most ${AUDIO_MAX_SLICES - 1}`)
  })

  it('read what a file carries, sorted, deduplicated and with a count per piece', () => {
    expect(normalizeSlices({ markers: [2000, 1000, 1000, -4, 'x'], playCounts: [3] }))
      .toEqual({ markers: [1000, 2000], playCounts: [3, 1, 1] })
    expect(normalizeSlices({ markers: 'no' })).toBeNull()
    expect(normalizeSlices(null)).toBeNull()
  })
})
