/**
 * Following an incoming clock, whichever wire it came in on.
 *
 * Each source — MTC, LTC, ArtTimeCode — reports positions as it decodes them, and this
 * keeps the one answer the show reads: where the clock is now, whether it is still
 * arriving, and at what rate. Between reports the position is carried on at the rate the
 * stream has been measured running at, which is what lets a cue fire on its frame when the
 * reports themselves land every other frame, and what carries the show through a dropout:
 * a stream that stops arriving freewheels for the hold time before it is called lost.
 *
 * The clock is an argument everywhere, so the dropout tests run on a fake one.
 */
import {
  framesToTimecode,
  idleReceiverStatus,
  timecodeToFrames,
  rateInfo,
  refineRate,
  type TimecodeLockState,
  type TimecodeRate,
  type TimecodeReceiverStatus,
  type TimecodeSourceKind
} from '../../shared/timecode'

export interface FollowerOptions {
  /** The rate setting: a fixed rate, or `auto` to read and measure the stream's own. */
  rate: TimecodeRate | 'auto'
  /** How long a stream that stops arriving is carried on before it is lost, ms. */
  holdMs: number
  /** Frames added to every position before anything reads it. */
  offsetFrames: number
  /**
   * How long the stream may go quiet before it is freewheeling rather than locked, in
   * frames of its own rate. MTC completes a position every second frame and LTC every
   * frame, so three frames of silence is a stream that has stopped, not one between
   * messages.
   */
  gapFrames?: number
  /** Consecutive running positions, one after another, before the clock counts as locked. */
  lockAfter?: number
}

interface Anchor {
  /** Frames at `at`, offset not yet applied. */
  frames: number
  at: number
}

/** Positions kept for measuring the rate: enough to span the window below. */
const RATE_SAMPLES = 512
/** The least span of stream measured before a rate is reported, ms. */
const RATE_MIN_SPAN_MS = 3000
/** The longest span kept, ms: long enough to tell 30 from 29.97, short enough to follow a change. */
const RATE_MAX_SPAN_MS = 12_000

export class TimecodeFollower {
  private source: TimecodeSourceKind
  private detail = ''
  private anchor: Anchor | null = null
  private lastArrival = -Infinity
  private declared: TimecodeRate | null = null
  private direction: 1 | -1 | 0 = 0
  private standing = false
  private consecutive = 0
  private locked = false
  private samples: Anchor[] = []
  private measured: number | null = null

  constructor(source: TimecodeSourceKind, private options: FollowerOptions) {
    this.source = source
  }

  configure(options: FollowerOptions): void {
    this.options = options
  }

  describe(detail: string): void {
    this.detail = detail
  }

  /** The rate positions are read at: the setting, or the stream's own refined by measurement. */
  rate(): TimecodeRate {
    if (this.options.rate !== 'auto') return this.options.rate
    return refineRate(this.declared ?? '25', this.measured)
  }

  private fps(): number {
    if (this.options.rate === 'auto' && this.measured !== null) return this.measured
    return rateInfo(this.rate()).fps
  }

  /**
   * A position counted at the stream's own rate, counted again at the one the setting
   * fixes: the label is what the source meant, and a fixed rate reads that label.
   */
  private recount(frames: number, declared: TimecodeRate): number {
    const fixed = this.options.rate
    if (fixed === 'auto' || fixed === declared) return frames
    const a = rateInfo(fixed)
    const b = rateInfo(declared)
    if (a.nominal === b.nominal && a.dropFrame === b.dropFrame) return frames
    const whole = Math.floor(frames)
    return timecodeToFrames(framesToTimecode(whole, declared), fixed) + (frames - whole)
  }

  /** A position from a running stream. */
  running(streamFrames: number, declared: TimecodeRate, at: number, direction: 1 | -1): void {
    const frames = this.recount(streamFrames, declared)
    this.alive(at)
    const predicted = this.anchor === null ? null : this.projected(at)
    const contiguous = predicted !== null && !this.standing && Math.abs(predicted - frames) <= 2.5
    this.declared = declared
    this.direction = direction
    this.standing = false
    if (contiguous) {
      this.consecutive++
    } else {
      // A jump, or the first position: the rate is measured afresh from here, and the
      // lock has to be earned again — one position is not yet a clock.
      this.consecutive = 1
      this.samples = []
      this.locked = false
    }
    if (this.consecutive >= (this.options.lockAfter ?? 2)) this.locked = true
    this.anchor = { frames, at }
    this.measure(frames, at, direction)
  }

  /** The source said where it is, standing still: a full-frame locate. */
  located(streamFrames: number, declared: TimecodeRate, at: number): void {
    const frames = this.recount(streamFrames, declared)
    this.alive(at)
    this.declared = declared
    this.anchor = { frames, at }
    this.standing = true
    this.direction = 0
    this.consecutive = 0
    this.locked = false
    this.samples = []
  }

  /** Something arrived from the stream, whether or not it completed a position. */
  alive(at: number): void {
    this.lastArrival = at
  }

  private measure(frames: number, at: number, direction: 1 | -1): void {
    if (direction !== 1) return
    this.samples.push({ frames, at })
    if (this.samples.length > RATE_SAMPLES) this.samples.shift()
    while (this.samples.length > 2 && at - this.samples[0].at > RATE_MAX_SPAN_MS) this.samples.shift()
    const first = this.samples[0]
    const span = at - first.at
    if (span < RATE_MIN_SPAN_MS) return
    // A least-squares slope rather than first-to-last: every arrival carries its own
    // jitter, and the slope through all of them is what the stream's clock really is.
    let sx = 0, sy = 0, sxx = 0, sxy = 0
    const n = this.samples.length
    for (const sample of this.samples) {
      const x = sample.at - first.at
      const y = sample.frames - first.frames
      sx += x; sy += y; sxx += x * x; sxy += x * y
    }
    const denominator = n * sxx - sx * sx
    if (denominator <= 0) return
    const perMs = (n * sxy - sx * sy) / denominator
    this.measured = perMs * 1000
  }

  /** Frames at `now` from the last anchor, carried on while the clock is moving. */
  private projected(now: number): number {
    const anchor = this.anchor!
    if (this.standing) return anchor.frames
    const end = Math.min(now, this.lastArrival + this.options.holdMs)
    return anchor.frames + (this.direction * (Math.max(anchor.at, end) - anchor.at) * this.fps()) / 1000
  }

  private gapMs(): number {
    return ((this.options.gapFrames ?? 3) * 1000) / rateInfo(this.rate()).fps
  }

  state(now: number): TimecodeLockState {
    if (this.source === 'none') return 'off'
    if (this.anchor === null) return 'waiting'
    if (this.standing) return 'stopped'
    const quiet = now - this.lastArrival
    if (quiet > this.options.holdMs + this.gapMs()) return 'lost'
    if (quiet > this.gapMs()) return this.locked ? 'freewheel' : 'lost'
    return this.locked ? 'locked' : 'waiting'
  }

  status(now: number): TimecodeReceiverStatus {
    const base = idleReceiverStatus(this.source)
    const state = this.state(now)
    const frames = this.anchor === null ? null : this.projected(now) + this.options.offsetFrames
    return {
      ...base,
      state,
      frames,
      at: now,
      rate: this.rate(),
      declaredRate: this.declared,
      measuredFps: this.measured,
      rateDetected: this.options.rate === 'auto' && this.measured !== null,
      direction: state === 'locked' || state === 'freewheel' ? this.direction : 0,
      detail: this.detail
    }
  }

  reset(): void {
    this.anchor = null
    this.lastArrival = -Infinity
    this.declared = null
    this.direction = 0
    this.standing = false
    this.consecutive = 0
    this.locked = false
    this.samples = []
    this.measured = null
  }
}
