import { describe, expect, it } from 'vitest'
import {
  curveAt,
  dissolveProgress,
  elapsedAt,
  fadeInFactor,
  fadeOutFactor,
  mediaPosition,
  playEndsAt,
  playLengthMs,
  rampAt,
  rampDone,
  reanchor,
  retarget,
  segmentMs,
  steady,
  stopFactor,
  stopLanded,
  type MediaTimeline
} from './visualClock'

const clip: MediaTimeline = { startMs: 1000, endMs: 3000, durationMs: 10_000, loopCount: 0 }

describe('a video\'s place in its file', () => {
  it('plays the region from its start, and ends at its end', () => {
    expect(mediaPosition(clip, 0)).toEqual({ positionMs: 1000, loop: 0, ended: false })
    expect(mediaPosition(clip, 1500)).toEqual({ positionMs: 2500, loop: 0, ended: false })
    expect(mediaPosition(clip, 2000)).toEqual({ positionMs: 3000, loop: 0, ended: true })
  })

  it('loops the region the number of times it is told, and for ever at −1', () => {
    const twice = { ...clip, loopCount: 1 }
    expect(playLengthMs(twice)).toBe(4000)
    expect(mediaPosition(twice, 2500)).toEqual({ positionMs: 1500, loop: 1, ended: false })
    expect(mediaPosition(twice, 4000).ended).toBe(true)
    const forever = { ...clip, loopCount: -1 }
    expect(playLengthMs(forever)).toBeNull()
    expect(mediaPosition(forever, 2000 * 50 + 10)).toEqual({ positionMs: 1010, loop: 50, ended: false })
  })

  it('plays out to the end of the file from where a devamp let go of the loop', () => {
    const vamp = { ...clip, loopCount: -1 }
    // Released 500 ms into the third pass: from 1500 in the file, out to the file's end.
    const releasedAt = 4500
    expect(mediaPosition(vamp, 5000, releasedAt)).toEqual({ positionMs: 2000, loop: 2, ended: false })
    expect(mediaPosition(vamp, 5000 + 1000, releasedAt).positionMs).toBe(3000)
    expect(mediaPosition(vamp, 4500 + 8500, releasedAt)).toEqual({ positionMs: 10_000, loop: 2, ended: true })
  })

  it('plays forward from the region\'s start while the file\'s length is not known', () => {
    const unknown = { startMs: 0, endMs: null, durationMs: null, loopCount: 0 }
    expect(segmentMs(unknown)).toBeNull()
    expect(mediaPosition(unknown, 1234)).toEqual({ positionMs: 1234, loop: 0, ended: false })
  })

  it('stands still while paused, and carries on from there', () => {
    const anchor = { engineMs: 10_000, elapsedMs: 0, paused: false }
    const paused = reanchor(anchor, 11_000, true)
    expect(elapsedAt(paused, 50_000)).toBe(1000)
    const resumed = reanchor(paused, 60_000, false)
    expect(elapsedAt(resumed, 60_250)).toBe(1250)
  })

  it('says when an unpaused play ends, so a fade-out can land on it', () => {
    expect(playEndsAt(clip, { engineMs: 5000, elapsedMs: 500, paused: false })).toBe(6500)
    expect(playEndsAt(clip, { engineMs: 5000, elapsedMs: 500, paused: true })).toBeNull()
    expect(playEndsAt({ ...clip, loopCount: -1 }, { engineMs: 5000, elapsedMs: 0, paused: false })).toBeNull()
  })
})

describe('fades as values of the clock', () => {
  it('ramps a level from where it stands, on the named curve', () => {
    const ramp = retarget(steady(1), 0, 1000, 2000, 'linear')
    expect(rampAt(ramp, 0)).toBe(1)
    expect(rampAt(ramp, 2000)).toBe(0.5)
    expect(rampAt(ramp, 3000)).toBe(0)
    expect(rampDone(ramp, 2999)).toBe(false)
    expect(rampDone(ramp, 3000)).toBe(true)
    // A second fade mid-way carries on from the level the eye is seeing.
    const second = retarget(ramp, 1, 2000, 1000, 'linear')
    expect(second.from).toBe(0.5)
  })

  it('shapes the three curves the audio fades take', () => {
    expect(curveAt('linear', 0.5)).toBe(0.5)
    expect(curveAt('sCurve', 0.5)).toBeCloseTo(0.5)
    expect(curveAt('sCurve', 0.1)).toBeLessThan(0.1)
    expect(curveAt('logarithmic', 0.1)).toBeGreaterThan(0.1)
    for (const curve of ['linear', 'sCurve', 'logarithmic'] as const) {
      expect(curveAt(curve, 0)).toBeCloseTo(0)
      expect(curveAt(curve, 1)).toBeCloseTo(1)
      expect(curveAt(curve, 2)).toBeCloseTo(1)
    }
  })

  it('fades in from the first frame, not from the GO', () => {
    expect(fadeInFactor(null, 1000, 5000)).toBe(0)
    expect(fadeInFactor(4000, 1000, 4500)).toBe(0.5)
    expect(fadeInFactor(4000, 0, 4000)).toBe(1)
  })

  it('lands a fade-out on the picture\'s own end', () => {
    expect(fadeOutFactor(10_000, 1000, 8000)).toBe(1)
    expect(fadeOutFactor(10_000, 1000, 9500)).toBe(0.5)
    expect(fadeOutFactor(10_000, 1000, 10_000)).toBe(0)
    expect(fadeOutFactor(null, 1000, 10_000)).toBe(1)
    expect(fadeOutFactor(10_000, 0, 9999)).toBe(1)
    expect(fadeOutFactor(10_000, 0, 10_000)).toBe(0)
  })

  it('takes a stopped picture down over the stop\'s fade, then says it has landed', () => {
    const stop = { atMs: 1000, fadeMs: 500 }
    expect(stopFactor(stop, 999)).toBe(1)
    expect(stopFactor(stop, 1250)).toBe(0.5)
    expect(stopLanded(stop, 1499)).toBe(false)
    expect(stopLanded(stop, 1500)).toBe(true)
    expect(stopFactor({ atMs: 1000, fadeMs: 0 }, 1000)).toBe(0)
    expect(stopFactor(null, 1000)).toBe(1)
  })

  it('starts a dissolve\'s clock on the incoming picture\'s first frame', () => {
    expect(dissolveProgress(null, 2000, 99_999)).toBe(0)
    expect(dissolveProgress(1000, 2000, 2000)).toBe(0.5)
    expect(dissolveProgress(1000, 2000, 5000)).toBe(1)
    expect(dissolveProgress(1000, 0, 1000)).toBe(1)
  })
})
