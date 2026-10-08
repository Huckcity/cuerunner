// The clocks a picture runs on, as pure functions of the engine's sample clock.
//
// An output never keeps time of its own: every frame it asks "where should this picture be
// now?" of the engine clock it tracks, and answers from the functions here. A video's place
// in its file, the opacity a fade has reached, how far a dissolve has got — each is a value
// of `now`, so a frame that is late draws the right picture rather than the next one in a
// queue, and two outputs showing one cue agree because they ask the same question.
//
// All times are milliseconds. Engine times are on the engine's sample clock; positions are
// in the file.

import type { FadeCurve } from './cue'
import { shapeValue, type FadeShape } from './fadeShape'

/** The part of a file a video plays, and how often. The same numbers its sound plays with. */
export interface MediaTimeline {
  /** ms into the file the region starts. */
  startMs: number
  /** ms into the file it ends, or null for the file's end. */
  endMs: number | null
  /** The file's length, when it is known. */
  durationMs: number | null
  /** 0 once, n more times, −1 for ever. */
  loopCount: number
}

/**
 * How far a picture has played — ms of play, pauses taken out — as of an engine time. A run
 * that is playing advances with the clock from `engineMs`; one that is paused stands at
 * `elapsedMs`.
 */
export interface PlayAnchor {
  engineMs: number
  elapsedMs: number
  paused: boolean
}

/** Elapsed play time at `now`. */
export function elapsedAt(anchor: PlayAnchor, now: number): number {
  if (anchor.paused) return anchor.elapsedMs
  return Math.max(0, anchor.elapsedMs + (now - anchor.engineMs))
}

/** The anchor re-taken at `now` for a pause (or a resume): the elapsed time it had reached. */
export function reanchor(anchor: PlayAnchor, now: number, paused: boolean): PlayAnchor {
  return { engineMs: now, elapsedMs: elapsedAt(anchor, now), paused }
}

/** The region's own length, or null while the file's length is not known. */
export function segmentMs(timeline: MediaTimeline): number | null {
  const end = timeline.endMs ?? timeline.durationMs
  if (end === null) return null
  const length = end - timeline.startMs
  return length > 0 ? length : null
}

/** How long the whole play lasts, every loop included; null for ever or not yet known. */
export function playLengthMs(timeline: MediaTimeline): number | null {
  if (timeline.loopCount < 0) return null
  const segment = segmentMs(timeline)
  return segment === null ? null : segment * (timeline.loopCount + 1)
}

export interface MediaPosition {
  /** ms into the file. */
  positionMs: number
  /** Which pass through the region this is, from 0. */
  loop: number
  /** The play is over: the position is the region's last. */
  ended: boolean
}

/**
 * Where in the file a picture is after `elapsedMs` of play.
 *
 * `releasedAtMs` is the elapsed time a devamp landed at: from there the loop is let go and
 * the file plays out to its end from wherever the pass had reached — exactly what the
 * engine does to the sound.
 */
export function mediaPosition(
  timeline: MediaTimeline,
  elapsedMs: number,
  releasedAtMs: number | null = null
): MediaPosition {
  const elapsed = Math.max(0, elapsedMs)
  const segment = segmentMs(timeline)
  if (segment === null) {
    // The length is not known yet: the picture plays forward from the region's start, and
    // its own end is the media's to report.
    return { positionMs: timeline.startMs + elapsed, loop: 0, ended: false }
  }
  if (releasedAtMs !== null && elapsed >= releasedAtMs) {
    const at = mediaPosition(timeline, releasedAtMs)
    const fileEnd = timeline.durationMs ?? timeline.endMs ?? at.positionMs
    const positionMs = at.positionMs + (elapsed - releasedAtMs)
    if (positionMs >= fileEnd) return { positionMs: fileEnd, loop: at.loop, ended: true }
    return { positionMs, loop: at.loop, ended: false }
  }
  const total = playLengthMs(timeline)
  if (total !== null && elapsed >= total) {
    return { positionMs: timeline.startMs + segment, loop: timeline.loopCount, ended: true }
  }
  const loop = Math.floor(elapsed / segment)
  return { positionMs: timeline.startMs + (elapsed - loop * segment), loop, ended: false }
}

/** Where a fade's curve is at `t` (0–1). The same three curve names an audio fade takes. */
export function curveAt(curve: FadeCurve, t: number): number {
  const x = Math.min(Math.max(t, 0), 1)
  switch (curve) {
    case 'linear':
      return x
    case 'sCurve':
      return 0.5 - 0.5 * Math.cos(Math.PI * x)
    case 'logarithmic':
      // Quick off the mark and settling at the end — the shape an ear (or eye) reads as even.
      return Math.log10(1 + 9 * x)
  }
}

/** A level moving from one value to another over time; a fade cue is one of these. */
export interface Ramp {
  from: number
  to: number
  startMs: number
  durationMs: number
  curve: FadeCurve
  /** A drawn shape (src/shared/fadeShape.ts), read in place of `curve` where there is one. */
  shape?: FadeShape | null
}

export function steady(value: number): Ramp {
  return { from: value, to: value, startMs: 0, durationMs: 0, curve: 'linear' }
}

export function rampAt(ramp: Ramp, now: number): number {
  if (ramp.durationMs <= 0 || now >= ramp.startMs + ramp.durationMs) return now < ramp.startMs ? ramp.from : ramp.to
  if (now <= ramp.startMs) return ramp.from
  const t = (now - ramp.startMs) / ramp.durationMs
  // A drawn shape is read by the one function every fade reads it with — the lights, the
  // audio engine's table — so a picture fades on exactly the curve the editor drew.
  return ramp.from + (ramp.to - ramp.from) * (ramp.shape ? shapeValue(ramp.shape, t) : curveAt(ramp.curve, t))
}

/** Whether a ramp has reached its value by `now`. */
export function rampDone(ramp: Ramp, now: number): boolean {
  return ramp.durationMs <= 0 ? now >= ramp.startMs : now >= ramp.startMs + ramp.durationMs
}

/**
 * A new ramp from wherever the current one has got to at `startMs`: a fade that lands on a
 * fade still running carries on from the level the eye is seeing, never from where the
 * first one was headed.
 */
export function retarget(
  ramp: Ramp, to: number, startMs: number, durationMs: number, curve: FadeCurve, shape: FadeShape | null = null
): Ramp {
  return { from: rampAt(ramp, startMs), to, startMs, durationMs: Math.max(0, durationMs), curve, ...(shape ? { shape } : {}) }
}

/** The fade-in's factor, 0–1, from the first frame. */
export function fadeInFactor(shownAtMs: number | null, fadeInMs: number, now: number): number {
  if (shownAtMs === null) return 0
  if (fadeInMs <= 0) return 1
  return curveAt('linear', (now - shownAtMs) / fadeInMs)
}

/**
 * The fade-out's factor, 0–1, landing on the picture's own end at `endsAtMs`: 1 until the
 * fade begins, 0 at the end. No end to land on is no fade.
 */
export function fadeOutFactor(endsAtMs: number | null, fadeOutMs: number, now: number): number {
  if (endsAtMs === null) return 1
  if (fadeOutMs <= 0) return now >= endsAtMs ? 0 : 1
  return curveAt('linear', (endsAtMs - now) / fadeOutMs)
}

/** A stop that takes the picture down over a fade: 1 before it, 0 once it has landed. */
export interface StopFade {
  atMs: number
  fadeMs: number
}

export function stopFactor(stop: StopFade | null, now: number): number {
  if (stop === null) return 1
  if (stop.fadeMs <= 0) return now >= stop.atMs ? 0 : 1
  return curveAt('linear', 1 - (now - stop.atMs) / stop.fadeMs)
}

/** Whether a stop has finished taking its picture down. */
export function stopLanded(stop: StopFade | null, now: number): boolean {
  return stop !== null && now >= stop.atMs + Math.max(0, stop.fadeMs)
}

/**
 * The engine time a video's play ends when it is anchored at `anchor` and nothing pauses it
 * — where a fade-out that lands on the end has to land. Null for ever, or not known.
 */
export function playEndsAt(timeline: MediaTimeline, anchor: PlayAnchor): number | null {
  if (anchor.paused) return null
  const total = playLengthMs(timeline)
  if (total === null) return null
  return anchor.engineMs + (total - anchor.elapsedMs)
}

/**
 * How far a dissolve has got, 0–1. Its clock starts on the incoming picture's first frame —
 * never on the GO — so a file that took a moment to open does not jump in half-dissolved.
 */
export function dissolveProgress(firstFrameMs: number | null, durationMs: number, now: number): number {
  if (firstFrameMs === null) return 0
  if (durationMs <= 0) return 1
  return Math.min(Math.max((now - firstFrameMs) / durationMs, 0), 1)
}
