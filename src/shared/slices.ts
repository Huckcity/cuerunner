// A cue's file cut into slices: markers in the region it plays, and how many times each
// piece between them plays — once, n times, not at all (skipped), or until a devamp moves it
// on (a vamp).
//
// The markers are file times, so a slice stays on the music it was cut at whatever the
// region does; a marker outside the region is kept but not played, and moves back in when the
// region does. The pieces are the region cut at the markers that fall inside it, in order,
// and the engine plays them sample for sample (native/audio/src/mixer.cpp: advanceSlices).
// A piece that plays no times is passed over: the piece before it runs straight into the one
// after, to the sample, and a skipped last piece ends the cue where it begins — a cut bar, or
// the tail a rehearsal track leaves off. It is how QLab 5's own slices come across.
//
// A cue with slices ignores its loop count — the counts are per slice — and a cue without
// any is the one region and its loop count it always was, which is what keeps a show written
// before slices existed playing exactly as it did. One vamp with no markers is the old vamp.

import { AUDIO_MAX_SLICES, type AudioSlice } from './audio'

/** A slice's play count that means "until released": a vamp. */
export const SLICE_VAMP = -1
/** A slice's play count that means "not at all": the piece is skipped. */
export const SLICE_SKIP = 0
/** The most passes a slice takes as a number; more is a vamp in all but name. */
export const SLICE_MAX_PLAYS = 999

export interface CueSlices {
  /** File ms, ascending: where one slice ends and the next begins. */
  markers: number[]
  /** One per piece — `markers.length + 1` of them — each 0 (skipped) or more, or `SLICE_VAMP`. */
  playCounts: number[]
}

/** A count as a slice may carry it: a vamp, or a whole number of passes from 0, which skips it. */
export function normalizePlayCount(count: unknown): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 1
  if (count < 0) return SLICE_VAMP
  return Math.min(SLICE_MAX_PLAYS, Math.max(SLICE_SKIP, Math.round(count)))
}

/**
 * Slices as a file may carry them, held to their shape: markers that are numbers, ascending
 * and distinct, at most one fewer than the engine's slice count, and one count per piece.
 * Null for anything that is not slices at all, so a hand-edited file plays its region.
 */
export function normalizeSlices(value: unknown): CueSlices | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.markers) || !Array.isArray(record.playCounts)) return null
  const markers = [...new Set(record.markers.filter((m): m is number => typeof m === 'number' && Number.isFinite(m) && m >= 0))]
    .sort((a, b) => a - b)
    .slice(0, AUDIO_MAX_SLICES - 1)
  const playCounts: number[] = []
  for (let i = 0; i <= markers.length; i++) playCounts.push(normalizePlayCount(record.playCounts[i]))
  return { markers, playCounts }
}

/**
 * Why slices a file carries are not ones this build writes, or null when they are: the load
 * funnel refuses them rather than reading something nobody wrote. Bounded by the engine's
 * slice count, so a file cannot ask for more than a start can carry.
 */
export function slicesRefusal(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return 'slices that are not markers and counts'
  const { markers, playCounts } = value as Record<string, unknown>
  if (!Array.isArray(markers) || !Array.isArray(playCounts)) return 'slices that are not markers and counts'
  if (markers.length > AUDIO_MAX_SLICES - 1) {
    return `${markers.length} slice markers, and a cue has at most ${AUDIO_MAX_SLICES - 1}`
  }
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]
    if (typeof marker !== 'number' || !Number.isFinite(marker) || marker < 0) return 'a slice marker that is not a time in the file'
    if (i > 0 && marker <= (markers[i - 1] as number)) return 'slice markers out of order'
  }
  if (playCounts.length !== markers.length + 1) return 'a slice play count missing or to spare'
  for (const count of playCounts) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < SLICE_VAMP || count > SLICE_MAX_PLAYS) {
      return `a slice play count of ${String(count)}`
    }
  }
  return null
}

/** Whether a cue's slices ask for anything: a marker, or a piece that does not play once. */
export function slicesInUse(slices: CueSlices | null | undefined): slices is CueSlices {
  if (!slices) return false
  return slices.markers.length > 0 || slices.playCounts.some(count => count !== 1)
}

/**
 * The pieces the engine plays for a region `[startMs, endMs)`: the region cut at the markers
 * inside it, each with its count. A marker outside the region cuts nothing; the counts of the
 * pieces it would have bounded fold into the piece that holds them, which is the first one
 * the region keeps — so moving the region never shifts a count onto the wrong music.
 */
export function slicePieces(slices: CueSlices, startMs: number, endMs: number): AudioSlice[] {
  const pieces: AudioSlice[] = []
  let from = startMs
  let pieceIndex = 0
  for (let i = 0; i < slices.markers.length; i++) {
    const marker = slices.markers[i]
    if (marker <= startMs) {
      pieceIndex = i + 1
      continue
    }
    if (marker >= endMs) break
    pieces.push({ startTime: from, endTime: marker, playCount: slices.playCounts[pieceIndex] ?? 1 })
    from = marker
    pieceIndex = i + 1
  }
  if (endMs > from) pieces.push({ startTime: from, endTime: endMs, playCount: slices.playCounts[pieceIndex] ?? 1 })
  return pieces
}

/** How long the pieces play for, ms, at `rate` — or null while any of them vamps. A skipped piece adds nothing. */
export function slicedLengthMs(pieces: AudioSlice[], rate = 1): number | null {
  let total = 0
  for (const piece of pieces) {
    if (piece.playCount < 0) return null
    total += (piece.endTime - piece.startTime) * piece.playCount
  }
  return total / (rate > 0 ? rate : 1)
}

/** Adds a marker at `ms`, splitting the piece it lands in; both halves keep its count. */
export function addMarker(slices: CueSlices | null | undefined, ms: number): CueSlices {
  const current = slices ?? { markers: [], playCounts: [1] }
  if (current.markers.includes(ms) || current.markers.length >= AUDIO_MAX_SLICES - 1) return current
  const index = current.markers.filter(marker => marker < ms).length
  const markers = [...current.markers.slice(0, index), ms, ...current.markers.slice(index)]
  const playCounts = [...current.playCounts]
  playCounts.splice(index, 0, current.playCounts[index] ?? 1)
  return { markers, playCounts }
}

/** Removes the marker at `index`; the two pieces it divided become one with the first's count. */
export function removeMarker(slices: CueSlices, index: number): CueSlices {
  if (index < 0 || index >= slices.markers.length) return slices
  const markers = slices.markers.filter((_, i) => i !== index)
  const playCounts = slices.playCounts.filter((_, i) => i !== index + 1)
  return { markers, playCounts }
}

/** Moves the marker at `index` to `ms`, kept between its neighbours. */
export function moveMarker(slices: CueSlices, index: number, ms: number): CueSlices {
  if (index < 0 || index >= slices.markers.length) return slices
  const low = index > 0 ? slices.markers[index - 1] + 1 : 0
  const high = index < slices.markers.length - 1 ? slices.markers[index + 1] - 1 : Number.POSITIVE_INFINITY
  const markers = [...slices.markers]
  markers[index] = Math.round(Math.min(high, Math.max(low, ms)))
  return { markers, playCounts: slices.playCounts }
}

/** Sets the count of piece `index`. */
export function setPlayCount(slices: CueSlices, index: number, count: number): CueSlices {
  if (index < 0 || index > slices.markers.length) return slices
  const playCounts = [...slices.playCounts]
  playCounts[index] = normalizePlayCount(count)
  return { markers: slices.markers, playCounts }
}

/** A count as the window writes it: "∞" for a vamp, "skip" for a piece that is passed over, "×n" otherwise. */
export function playCountLabel(count: number): string {
  if (count < 0) return '∞'
  return count === SLICE_SKIP ? 'skip' : `×${count}`
}
