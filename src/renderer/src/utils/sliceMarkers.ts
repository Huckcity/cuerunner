// Slices on the waveform: where a marker is drawn at any zoom, what each piece between the
// markers says about itself in the width it has, where a dragged marker lands, what taking one
// out leaves behind, and which piece the music is in while the cue plays.
//
// Pure arithmetic, kept apart from the panel so every one of these answers is a unit test
// rather than a pixel somebody has to look at. Times are file milliseconds, as the slices
// themselves are (src/shared/slices.ts); x is CSS pixels from the left edge of the waveform.

import {
  playCountLabel,
  removeMarker,
  slicePieces,
  SLICE_MAX_PLAYS,
  SLICE_SKIP,
  SLICE_VAMP,
  type CueSlices
} from '../../../shared/slices'

/** The window of the file the panel is showing, and how wide it is drawn. */
export interface SliceView {
  /** File ms at the left edge. */
  startMs: number
  /** File ms across the whole width: the file at 1×, a part of it zoomed in. */
  spanMs: number
  /** CSS pixels. */
  width: number
}

/** Where a file time is drawn, in CSS px from the left edge; outside 0…width when it is off screen. */
export function msToX(ms: number, view: SliceView): number {
  if (view.spanMs <= 0) return 0
  return ((ms - view.startMs) / view.spanMs) * view.width
}

/** The file time under an x, clamped to the window on screen. */
export function xToMs(x: number, view: SliceView): number {
  if (view.width <= 0) return view.startMs
  const rel = Math.max(0, Math.min(1, x / view.width))
  return view.startMs + rel * view.spanMs
}

/** Whether a file time is inside the window on screen, edges included. */
export function inSliceView(ms: number, view: SliceView): boolean {
  return ms >= view.startMs && ms <= view.startMs + view.spanMs
}

/**
 * One piece of the file between two markers, as the panel draws it: the file-wide piece
 * `index` (the one `playCounts[index]` belongs to), clipped to the part of it the cue's
 * region plays. A piece the region does not reach is left out — its markers are still drawn,
 * dimmed, because a marker outside the region is kept and comes back when the region does.
 */
export interface DrawnPiece {
  index: number
  fromMs: number
  toMs: number
  count: number
}

/**
 * The pieces the region plays, each with its file-wide index. The counts are the ones the
 * engine is sent (`slicePieces`): a marker outside the region cuts nothing, and the count a
 * piece plays is the count of the file-wide piece the region's part of it belongs to.
 */
export function drawnPieces(slices: CueSlices, regionStartMs: number, regionEndMs: number): DrawnPiece[] {
  if (regionEndMs <= regionStartMs) return []
  return slicePieces(slices, regionStartMs, regionEndMs).map(piece => ({
    index: fileWidePiece(slices, piece.startTime),
    fromMs: piece.startTime,
    toMs: piece.endTime,
    count: piece.playCount
  }))
}

/** The file-wide piece a file time is in: how many markers are at or before it. */
export function fileWidePiece(slices: CueSlices, ms: number): number {
  let index = 0
  while (index < slices.markers.length && slices.markers[index] <= ms) index++
  return index
}

/** How much a piece's label can say in the width it is drawn at. */
export type LabelFit = 'full' | 'short' | 'none'

/** Widths, CSS px, below which a label says less: a count needs a glyph or two, a word more. */
export const LABEL_FULL_PX = 44
export const LABEL_SHORT_PX = 16

/**
 * What fits. A wide piece says its count and, while it plays, its pass; a narrow one says
 * only the count, as a glyph; a sliver says nothing, and its tint and its accessible name
 * carry it. Narrow is judged against the width a piece is drawn at, so zooming in is what
 * brings a label back.
 */
export function labelFit(widthPx: number): LabelFit {
  if (widthPx >= LABEL_FULL_PX) return 'full'
  if (widthPx >= LABEL_SHORT_PX) return 'short'
  return 'none'
}

/**
 * A piece's label for the room it has: "×2", "∞", "skip" in full; the same count without the
 * word in short — a skip is the struck "–", a count over 9 just its number.
 */
export function pieceLabel(count: number, fit: LabelFit): string {
  if (fit === 'none') return ''
  if (fit === 'full') return playCountLabel(count)
  if (count < 0) return '∞'
  if (count === SLICE_SKIP) return '–'
  return count > 9 ? String(count) : `×${count}`
}

/** A piece's pass as the panel writes it while the music is in it: "pass 3", "2/4", or nothing for a piece that plays once. */
export function passLabel(count: number, pass: number): string {
  if (count < 0) return `pass ${pass}`
  if (count <= 1) return ''
  return `${Math.min(pass, count)}/${count}`
}

/** A piece's count in words, for its accessible name and its tooltip. */
export function countInWords(count: number): string {
  if (count < 0) return 'vamps until a devamp'
  if (count === SLICE_SKIP) return 'skipped'
  return count === 1 ? 'plays once' : `plays ${count} times`
}

/**
 * A marker's time as the panel writes it, to a hundredth of a second: "1:02.35". Finer than
 * the panel's other times, because a marker is placed on a note and a tenth of a second is a
 * different note at any tempo.
 */
export function formatMarkerTime(ms: number): string {
  const hundredths = Math.round(Math.max(0, ms) / 10)
  const min = Math.floor(hundredths / 6000)
  const sec = (hundredths % 6000) / 100
  return `${min}:${sec.toFixed(2).padStart(5, '0')}`
}

// ── Snapping ──────────────────────────────────────────────────────────────

/**
 * How near an onset has to be for a dragged marker to land on it: near enough in the hand
 * and near enough in the music, the same two reaches the region grips use (WaveformPanel).
 */
export const SNAP_PX = 32
export const SNAP_MS = 100

/**
 * The time a marker dropped at `ms` lands on: the nearest onset when one is within both
 * reaches, or `ms` itself. The pixel reach is read through the window on screen, so a
 * zoomed-in panel snaps across a smaller part of the file.
 */
export function snapToOnset(ms: number, onsets: readonly number[], view: SliceView, reachPx = SNAP_PX, reachMs = SNAP_MS): number {
  if (onsets.length === 0 || view.spanMs <= 0 || view.width <= 0) return ms
  const pxPerMs = view.width / view.spanMs
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const onset of onsets) {
    const distance = Math.abs(onset - ms)
    if (distance < bestDistance) {
      bestDistance = distance
      best = onset
    }
  }
  if (best === null) return ms
  if (bestDistance * pxPerMs > reachPx || bestDistance > reachMs) return ms
  return best
}

/** How far either side of a marker a zero crossing is looked for, ms: inaudible as a move, enough to miss a click. */
export const ZERO_CROSSING_REACH_MS = 4

/**
 * The zero crossing nearest `targetMs` in a run of per-sample readings, or null when the
 * window has none. `values` is the engine's envelope, interleaved min/max, read with one
 * bucket a sample — so each bucket's middle is the sample (both channels' mean, for stereo). A crossing is between
 * two readings of opposite sign, placed where the line between them meets zero; a reading
 * of exactly zero is a crossing of its own.
 */
export function zeroCrossingNear(
  values: ArrayLike<number>, buckets: number, fromMs: number, toMs: number, targetMs: number
): number | null {
  if (buckets < 2 || toMs <= fromMs) return null
  const step = (toMs - fromMs) / buckets
  const sample = (i: number): number => (values[i * 2] + values[i * 2 + 1]) / 2
  // Bucket i holds the sample at frame `from + i`, which is at the start of its slot.
  const timeOf = (i: number): number => fromMs + i * step
  let best: number | null = null
  for (let i = 0; i < buckets; i++) {
    const a = sample(i)
    let at: number | null = null
    if (a === 0) at = timeOf(i)
    else if (i + 1 < buckets) {
      const b = sample(i + 1)
      if ((a < 0 && b > 0) || (a > 0 && b < 0)) at = timeOf(i) + step * (a / (a - b))
    }
    if (at !== null && (best === null || Math.abs(at - targetMs) < Math.abs(best - targetMs))) best = at
  }
  return best
}

/** A marker time as it is kept: a thousandth of a millisecond, finer than a sample at any rate the engine plays. */
export function roundMarkerMs(ms: number): number {
  return Math.round(ms * 1000) / 1000
}

/** The gap kept between neighbouring markers, ms: two markers on one sample would be a piece of nothing. */
export const MARKER_GAP_MS = 1

/**
 * Where marker `index` can go: between its neighbours, a gap clear of each, and inside the
 * file. Markers cannot cross, so a drag past a neighbour stops against it.
 */
export function clampMarker(slices: CueSlices, index: number, ms: number, fileMs: number): number {
  const low = index > 0 ? slices.markers[index - 1] + MARKER_GAP_MS : MARKER_GAP_MS
  const high = index < slices.markers.length - 1
    ? slices.markers[index + 1] - MARKER_GAP_MS
    : fileMs > 0 ? fileMs - MARKER_GAP_MS : Number.POSITIVE_INFINITY
  if (high < low) return slices.markers[index]
  return roundMarkerMs(Math.min(high, Math.max(low, ms)))
}

/** Marker `index` moved to `ms`, held between its neighbours. The counts stay with the pieces. */
export function placeMarker(slices: CueSlices, index: number, ms: number, fileMs: number): CueSlices {
  if (index < 0 || index >= slices.markers.length) return slices
  const markers = [...slices.markers]
  markers[index] = clampMarker(slices, index, ms, fileMs)
  return { markers, playCounts: slices.playCounts }
}

/**
 * Whether a marker can be added at `ms`: inside the file, not on top of one already there,
 * and with room left under the engine's slice count.
 */
export function canAddMarkerAt(slices: CueSlices | null | undefined, ms: number, fileMs: number, maxMarkers: number): boolean {
  if (!Number.isFinite(ms) || ms < MARKER_GAP_MS || (fileMs > 0 && ms > fileMs - MARKER_GAP_MS)) return false
  const markers = slices?.markers ?? []
  if (markers.length >= maxMarkers) return false
  return markers.every(marker => Math.abs(marker - ms) >= MARKER_GAP_MS)
}

// ── Taking a marker out ───────────────────────────────────────────────────

/** What deleting a marker does: the slices after, and which count the joined piece keeps. */
export interface MarkerRemoval {
  slices: CueSlices
  /** The file-wide index of the joined piece. */
  piece: number
  /** The count the joined piece plays: the earlier piece's. */
  kept: number
  /** The later piece's count, which is gone. */
  dropped: number
}

/**
 * Takes marker `index` out. The two pieces it divided become one, and the earlier piece's
 * count is the one that survives — the music before the marker is what the operator was
 * already playing that way, and the piece after it joins it.
 */
export function mergeOnDelete(slices: CueSlices, index: number): MarkerRemoval | null {
  if (index < 0 || index >= slices.markers.length) return null
  return {
    slices: removeMarker(slices, index),
    piece: index,
    kept: slices.playCounts[index] ?? 1,
    dropped: slices.playCounts[index + 1] ?? 1
  }
}

/** The sentence a removal is announced with: which pieces joined and which count they kept. */
export function removalSentence(removal: MarkerRemoval): string {
  const kept = playCountLabel(removal.kept)
  if (removal.kept === removal.dropped) return `Marker removed: slices ${removal.piece + 1} and ${removal.piece + 2} joined, both ${kept}`
  return `Marker removed: slices ${removal.piece + 1} and ${removal.piece + 2} joined, ${kept} kept over ${playCountLabel(removal.dropped)}`
}

// ── Counts ────────────────────────────────────────────────────────────────

/** The counts the popover offers as presses of their own; anything else is typed. */
export const COUNT_CHOICES: readonly number[] = [1, 2, 3, 4, SLICE_VAMP, SLICE_SKIP]

/**
 * A count one step up or down the ladder a nudge walks: skip, ×1, ×2 … ×999, ∞. A vamp sits
 * at the top because more passes than the maximum is a vamp in all but name; skip at the
 * bottom because it is fewer passes than one. The ends hold.
 */
export function nudgeCount(count: number, step: 1 | -1): number {
  if (count < 0) return step > 0 ? SLICE_VAMP : SLICE_MAX_PLAYS
  if (step > 0) return count >= SLICE_MAX_PLAYS ? SLICE_VAMP : count + 1
  return Math.max(SLICE_SKIP, count - 1)
}

/**
 * The next count a cycle press gives: ×1 → ×2 → ×3 → ×4 → ∞ → skip → ×1. Counts the popover
 * does not offer as a press of their own go back to ×1.
 */
export function cycleCount(count: number): number {
  const at = COUNT_CHOICES.indexOf(count)
  if (at < 0) return 1
  return COUNT_CHOICES[(at + 1) % COUNT_CHOICES.length]
}

// ── While it plays ────────────────────────────────────────────────────────

/** Which piece the music is in, file-wide, and which pass of it. */
export interface SlicePlace {
  piece: number
  pass: number
}

/**
 * The engine's report of where it is — `slice.index` counts the region's pieces from 0,
 * skipped ones included — as the file-wide piece the panel draws. Null when the index is
 * not one of this region's pieces.
 */
export function pieceFromEngine(slices: CueSlices, regionStartMs: number, regionEndMs: number, index: number): number | null {
  const pieces = slicePieces(slices, regionStartMs, regionEndMs)
  const piece = pieces[index]
  if (piece === undefined) return null
  return fileWidePiece(slices, piece.startTime)
}

/** How far back the position has to move, ms, before it counts as a wrap rather than a jittery reading. */
export const WRAP_BACK_MS = 20

/**
 * The place a position reading puts the music, from the readings before it, for an engine that
 * does not report its slice: the piece is the one the position is in, and a move backwards
 * inside the same piece is the start of its next pass.
 */
export function placeFromPosition(slices: CueSlices, positionMs: number, previous: { place: SlicePlace; positionMs: number } | null): SlicePlace {
  const piece = fileWidePiece(slices, positionMs)
  if (previous === null || previous.place.piece !== piece) return { piece, pass: 1 }
  if (positionMs < previous.positionMs - WRAP_BACK_MS) return { piece, pass: previous.place.pass + 1 }
  return previous.place
}

/**
 * Whether two readings of the position are a jump rather than the music moving on: back by
 * more than a jitter (a wrap), or forward by more than the time between them could carry it
 * (a skipped piece). `elapsedMs` is the wall time between the readings, `rate` the cue's.
 */
export function isJump(fromMs: number, toMs: number, elapsedMs: number, rate = 1): boolean {
  if (toMs < fromMs - WRAP_BACK_MS) return true
  const expected = Math.max(0, elapsedMs) * (rate > 0 ? rate : 1)
  return toMs - fromMs > expected + 150
}
