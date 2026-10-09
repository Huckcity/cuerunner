// Slices on the waveform, as arithmetic: where a marker is drawn at every zoom, what a piece
// can say in the width it has, where a dragged marker lands, what taking one out keeps, how a
// count steps, and which piece the music is in while it plays.
import { describe, it, expect } from 'vitest'
import { SLICE_MAX_PLAYS, SLICE_SKIP, SLICE_VAMP, type CueSlices } from '../../../shared/slices'
import {
  canAddMarkerAt,
  clampMarker,
  cycleCount,
  drawnPieces,
  fileWidePiece,
  formatMarkerTime,
  inSliceView,
  isJump,
  labelFit,
  mergeOnDelete,
  msToX,
  nudgeCount,
  passLabel,
  pieceFromEngine,
  pieceLabel,
  placeFromPosition,
  placeMarker,
  removalSentence,
  roundMarkerMs,
  snapToOnset,
  xToMs,
  zeroCrossingNear,
  type SliceView
} from './sliceMarkers'

const ZOOMS = [1, 2, 4, 8, 16, 32]

/** The panel's window at a zoom level, centred where it was asked to be, on a 10-second file 800 px wide. */
function viewAt(zoom: number, centreMs = 5000, fileMs = 10_000, width = 800): SliceView {
  const spanMs = fileMs / zoom
  const startMs = Math.max(0, Math.min(centreMs - spanMs / 2, fileMs - spanMs))
  return { startMs, spanMs, width }
}

describe('marker ↔ x', () => {
  it('puts a marker at the same place in the window at every zoom, and reads it back', () => {
    for (const zoom of ZOOMS) {
      const view = viewAt(zoom, 4321)
      const x = msToX(4321, view)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(view.width)
      expect(xToMs(x, view)).toBeCloseTo(4321, 6)
      // One pixel is the zoom's share of the file: 12.5 ms at 1×, a 32nd of that at 32×.
      expect(xToMs(x + 1, view) - xToMs(x, view)).toBeCloseTo(10_000 / zoom / 800, 6)
    }
  })

  it('draws the whole file edge to edge at 1×', () => {
    const view = viewAt(1)
    expect(msToX(0, view)).toBe(0)
    expect(msToX(10_000, view)).toBe(800)
    expect(msToX(2500, view)).toBe(200)
  })

  it('places a marker outside a zoomed window off screen, and says it is not in view', () => {
    const view = viewAt(8, 1000) // 0–1250 ms
    expect(inSliceView(1200, view)).toBe(true)
    expect(inSliceView(4000, view)).toBe(false)
    expect(msToX(4000, view)).toBeGreaterThan(view.width)
  })

  it('holds an x outside the canvas to the window', () => {
    const view = viewAt(4, 5000)
    expect(xToMs(-50, view)).toBe(view.startMs)
    expect(xToMs(5000, view)).toBe(view.startMs + view.spanMs)
  })
})

describe('the pieces drawn', () => {
  const slices: CueSlices = { markers: [1000, 2000, 3000], playCounts: [1, SLICE_VAMP, SLICE_SKIP, 2] }

  it('are the region cut at the markers inside it, each with its file-wide index', () => {
    expect(drawnPieces(slices, 0, 4000)).toEqual([
      { index: 0, fromMs: 0, toMs: 1000, count: 1 },
      { index: 1, fromMs: 1000, toMs: 2000, count: SLICE_VAMP },
      { index: 2, fromMs: 2000, toMs: 3000, count: SLICE_SKIP },
      { index: 3, fromMs: 3000, toMs: 4000, count: 2 }
    ])
  })

  it('leave out what the region does not reach, and keep the count of the piece the region starts in', () => {
    expect(drawnPieces(slices, 1500, 2500)).toEqual([
      { index: 1, fromMs: 1500, toMs: 2000, count: SLICE_VAMP },
      { index: 2, fromMs: 2000, toMs: 2500, count: SLICE_SKIP }
    ])
  })

  it('count a marker at a time as the start of the piece after it', () => {
    expect(fileWidePiece(slices, 999)).toBe(0)
    expect(fileWidePiece(slices, 1000)).toBe(1)
    expect(fileWidePiece(slices, 3500)).toBe(3)
  })
})

describe('labels in the width they have', () => {
  it('say the count, then a glyph, then nothing as a piece narrows', () => {
    expect(labelFit(120)).toBe('full')
    expect(labelFit(30)).toBe('short')
    expect(labelFit(8)).toBe('none')
    expect(pieceLabel(2, 'full')).toBe('×2')
    expect(pieceLabel(SLICE_VAMP, 'full')).toBe('∞')
    expect(pieceLabel(SLICE_SKIP, 'full')).toBe('skip')
    expect(pieceLabel(SLICE_SKIP, 'short')).toBe('–')
    expect(pieceLabel(12, 'short')).toBe('12')
    expect(pieceLabel(SLICE_VAMP, 'none')).toBe('')
  })

  it('bring a label back as the zoom widens its piece', () => {
    // A 100 ms piece of a ten-second file: a sliver at 1×, a count at 4×, the full label at 8×.
    const width = (zoom: number) => msToX(1100, viewAt(zoom, 1000)) - msToX(1000, viewAt(zoom, 1000))
    expect(labelFit(width(1))).toBe('none')
    expect(labelFit(width(4))).toBe('short')
    expect(labelFit(width(8))).toBe('full')
  })

  it('count passes as "pass n" for a vamp and "n/m" for a count', () => {
    expect(passLabel(SLICE_VAMP, 3)).toBe('pass 3')
    expect(passLabel(4, 2)).toBe('2/4')
    expect(passLabel(1, 1)).toBe('')
  })

  it('write a marker to the hundredth', () => {
    expect(formatMarkerTime(62_345)).toBe('1:02.35')
    expect(formatMarkerTime(500)).toBe('0:00.50')
  })
})

describe('snapping', () => {
  const onsets = [500, 1000, 1500, 2000]

  it('lands on an onset within reach in the hand and in the music', () => {
    const view = viewAt(1, 5000, 3000, 900) // 0.3 px per ms
    expect(snapToOnset(960, onsets, view)).toBe(1000)
  })

  it('leaves a marker where it was dropped when the nearest onset is too far in pixels', () => {
    // At 32× the reach of a hand is two milliseconds of music: 40 ms away is a different place.
    const view = viewAt(32, 1000, 3000, 900)
    expect(snapToOnset(960, onsets, view)).toBe(960)
  })

  it('leaves it when the onset is too far in the music, however near it is on screen', () => {
    // A 20-minute file at 1×: 32 px is over 40 s, and a jump of that much is the panel moving the work.
    const view: SliceView = { startMs: 0, spanMs: 1_200_000, width: 900 }
    expect(snapToOnset(30_000, [60_000], view)).toBe(30_000)
  })

  it('finds the zero crossing nearest the marker, between two samples of opposite sign', () => {
    // A sine at 1 kHz read at 48 kHz, one bucket a sample: crossings every 0.5 ms from 0.
    const rate = 48
    const buckets = 192 // 4 ms
    const values: number[] = []
    for (let i = 0; i < buckets; i++) {
      const v = Math.sin((2 * Math.PI * i) / rate)
      values.push(v, v)
    }
    const near = zeroCrossingNear(values, buckets, 0, 4, 1.62)
    expect(near).not.toBeNull()
    expect(Math.abs((near as number) - 1.5)).toBeLessThan(0.03)
  })

  it('says there is no crossing in a run of one sign', () => {
    expect(zeroCrossingNear([0.2, 0.2, 0.3, 0.3, 0.1, 0.1], 3, 0, 1, 0.5)).toBeNull()
  })

  it('keeps a marker between its neighbours and inside the file, so markers cannot cross', () => {
    const slices: CueSlices = { markers: [1000, 2000, 3000], playCounts: [1, 1, 1, 1] }
    expect(clampMarker(slices, 1, 5000, 10_000)).toBe(2999)
    expect(clampMarker(slices, 1, 10, 10_000)).toBe(1001)
    expect(clampMarker(slices, 0, -40, 10_000)).toBe(1)
    expect(clampMarker(slices, 2, 20_000, 10_000)).toBe(9999)
    expect(placeMarker(slices, 1, 2500.12345, 10_000).markers).toEqual([1000, 2500.123, 3000])
    expect(roundMarkerMs(1.23456)).toBe(1.235)
  })

  it('adds a marker only where there is room for one', () => {
    const slices: CueSlices = { markers: [1000], playCounts: [1, 1] }
    expect(canAddMarkerAt(slices, 1500, 4000, 127)).toBe(true)
    expect(canAddMarkerAt(slices, 1000.5, 4000, 127)).toBe(false)
    expect(canAddMarkerAt(slices, 0, 4000, 127)).toBe(false)
    expect(canAddMarkerAt(slices, 4000, 4000, 127)).toBe(false)
    expect(canAddMarkerAt(slices, 1500, 4000, 1)).toBe(false)
    expect(canAddMarkerAt(null, 1500, 4000, 127)).toBe(true)
  })
})

describe('merge on delete', () => {
  const slices: CueSlices = { markers: [1000, 2000, 3000], playCounts: [1, 2, SLICE_VAMP, SLICE_SKIP] }

  it('joins the two pieces and keeps the earlier one\'s count', () => {
    const removal = mergeOnDelete(slices, 1)!
    expect(removal.slices).toEqual({ markers: [1000, 3000], playCounts: [1, 2, SLICE_SKIP] })
    expect(removal.kept).toBe(2)
    expect(removal.dropped).toBe(SLICE_VAMP)
    expect(removalSentence(removal)).toBe('Marker removed: slices 2 and 3 joined, ×2 kept over ∞')
  })

  it('says only the count when both pieces had it', () => {
    const removal = mergeOnDelete({ markers: [1000], playCounts: [3, 3] }, 0)!
    expect(removal.slices).toEqual({ markers: [], playCounts: [3] })
    expect(removalSentence(removal)).toBe('Marker removed: slices 1 and 2 joined, both ×3')
  })

  it('refuses a marker that is not there', () => {
    expect(mergeOnDelete(slices, 3)).toBeNull()
    expect(mergeOnDelete(slices, -1)).toBeNull()
  })
})

describe('counts', () => {
  it('step up the ladder from skip to ×999 and then a vamp, and back down', () => {
    expect(nudgeCount(SLICE_SKIP, 1)).toBe(1)
    expect(nudgeCount(1, 1)).toBe(2)
    expect(nudgeCount(SLICE_MAX_PLAYS, 1)).toBe(SLICE_VAMP)
    expect(nudgeCount(SLICE_VAMP, 1)).toBe(SLICE_VAMP)
    expect(nudgeCount(SLICE_VAMP, -1)).toBe(SLICE_MAX_PLAYS)
    expect(nudgeCount(2, -1)).toBe(1)
    expect(nudgeCount(1, -1)).toBe(SLICE_SKIP)
    expect(nudgeCount(SLICE_SKIP, -1)).toBe(SLICE_SKIP)
  })

  it('cycle ×1 → ×2 → ×3 → ×4 → ∞ → skip → ×1', () => {
    const seen = [1]
    for (let i = 0; i < 6; i++) seen.push(cycleCount(seen[seen.length - 1]))
    expect(seen).toEqual([1, 2, 3, 4, SLICE_VAMP, SLICE_SKIP, 1])
    expect(cycleCount(17)).toBe(1)
  })
})

describe('while it plays', () => {
  const slices: CueSlices = { markers: [1000, 2000, 3000], playCounts: [1, SLICE_VAMP, SLICE_SKIP, 1] }

  it('reads the engine\'s slice index, skipped pieces counted, as the piece the panel draws', () => {
    expect(pieceFromEngine(slices, 0, 4000, 0)).toBe(0)
    expect(pieceFromEngine(slices, 0, 4000, 2)).toBe(2)
    expect(pieceFromEngine(slices, 0, 4000, 3)).toBe(3)
    // A region that starts inside the second piece: the engine's first piece is that one.
    expect(pieceFromEngine(slices, 1500, 4000, 0)).toBe(1)
    expect(pieceFromEngine(slices, 0, 4000, 9)).toBeNull()
  })

  it('works the piece and the pass out from the position when the engine does not say', () => {
    let previous: { place: { piece: number; pass: number }; positionMs: number } | null = null
    const read = (ms: number) => {
      const place = placeFromPosition(slices, ms, previous)
      previous = { place, positionMs: ms }
      return place
    }
    expect(read(500)).toEqual({ piece: 0, pass: 1 })
    expect(read(1200)).toEqual({ piece: 1, pass: 1 })
    expect(read(1900)).toEqual({ piece: 1, pass: 1 })
    expect(read(1050)).toEqual({ piece: 1, pass: 2 })
    expect(read(1990)).toEqual({ piece: 1, pass: 2 })
    expect(read(1010)).toEqual({ piece: 1, pass: 3 })
    expect(read(1015)).toEqual({ piece: 1, pass: 3 })
    // The devamp: on past the skipped piece, into the last.
    expect(read(3010)).toEqual({ piece: 3, pass: 1 })
  })

  it('calls a wrap and a skip jumps, and the music moving on not one', () => {
    expect(isJump(1990, 1010, 25)).toBe(true)
    expect(isJump(1990, 3010, 25)).toBe(true)
    expect(isJump(1000, 1025, 25)).toBe(false)
    expect(isJump(1000, 1100, 100, 1)).toBe(false)
    expect(isJump(1000, 1010, 25)).toBe(false)
  })
})
