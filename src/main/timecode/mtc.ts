/**
 * MIDI Time Code, both ways.
 *
 * A running clock is a stream of quarter-frame messages — `F1 0n`, four to a frame — each
 * carrying one nibble of the time, so a whole position takes eight of them and spans two
 * frames. Where the clock jumps (a locate, a shuttle, a stop) the sender says so with one
 * full-frame SysEx instead: `F0 7F <device> 01 01 hr mn sc fr F7`.
 *
 * The encoders here make the bytes; the decoder reassembles them, works out which way the
 * pieces are running, and hands whole positions to whatever is following the clock. Time
 * comes in as an argument everywhere, so the tests drive both halves on a clock of their
 * own.
 */
import {
  framesToTimecode,
  rateCode,
  rateFromCode,
  rateInfo,
  timecodeToFrames,
  type Timecode,
  type TimecodeRate
} from '../../shared/timecode'

/** The device ID every receiver answers to. */
export const MTC_ALL_CALL = 0x7f

/** The data byte of quarter-frame piece `piece` (0–7) of a position. */
export function quarterFrameData(tc: Timecode, rate: TimecodeRate, piece: number): number {
  const p = piece & 7
  let nibble: number
  switch (p) {
    case 0: nibble = tc.frames & 0x0f; break
    case 1: nibble = (tc.frames >> 4) & 0x01; break
    case 2: nibble = tc.seconds & 0x0f; break
    case 3: nibble = (tc.seconds >> 4) & 0x03; break
    case 4: nibble = tc.minutes & 0x0f; break
    case 5: nibble = (tc.minutes >> 4) & 0x03; break
    case 6: nibble = tc.hours & 0x0f; break
    default: nibble = (rateCode(rate) << 1) | ((tc.hours >> 4) & 0x01); break
  }
  return (p << 4) | nibble
}

/** One quarter-frame message. */
export function encodeQuarterFrame(tc: Timecode, rate: TimecodeRate, piece: number): number[] {
  return [0xf1, quarterFrameData(tc, rate, piece)]
}

/** The full-frame message that says where the clock is now, standing or about to run. */
export function encodeFullFrame(tc: Timecode, rate: TimecodeRate, deviceId = MTC_ALL_CALL): number[] {
  return [
    0xf0, 0x7f, deviceId & 0x7f, 0x01, 0x01,
    ((rateCode(rate) << 5) | (tc.hours & 0x1f)) & 0x7f,
    tc.minutes & 0x3f,
    tc.seconds & 0x3f,
    tc.frames & 0x1f,
    0xf7
  ]
}

/** What a full-frame message names, or null when the bytes are some other SysEx. */
export function decodeFullFrame(bytes: ArrayLike<number>): { tc: Timecode; rate: TimecodeRate } | null {
  // With or without the delimiters: the input service strips them, a raw port does not.
  const body = Array.from(bytes)
  if (body[0] === 0xf0) body.shift()
  if (body[body.length - 1] === 0xf7) body.pop()
  if (body.length !== 8) return null
  if (body[0] !== 0x7f || body[2] !== 0x01 || body[3] !== 0x01) return null
  const hr = body[4]
  return {
    tc: { hours: hr & 0x1f, minutes: body[5] & 0x3f, seconds: body[6] & 0x3f, frames: body[7] & 0x1f },
    rate: rateFromCode((hr >> 5) & 0x03)
  }
}

/**
 * Where a quarter-frame stream says the clock is. Every position is a fractional frame
 * count at `rate`, measured to the moment the message that completed it arrived.
 */
export interface MtcSink {
  /** A whole position assembled from a running stream. */
  running(frames: number, rate: TimecodeRate, at: number, direction: 1 | -1): void
  /** A full-frame locate: the clock is here, and not running until the pieces resume. */
  located(frames: number, rate: TimecodeRate, at: number): void
  /** A piece arrived: the stream is still there, whether or not it completed anything. */
  alive(at: number): void
}

/**
 * Reassembles quarter frames into positions.
 *
 * A position is only reported from eight pieces in one unbroken run — 0 to 7 going
 * forward, 7 to 0 going back — because a nibble from before a jump stitched to nibbles
 * after it names a time that never happened. A piece out of sequence starts the run
 * again from itself.
 *
 * Going forward, the time the pieces carry is the frame that piece 0 was sent on, and
 * piece 7 arrives three quarters of the way through the frame after it: the clock is
 * 1.75 frames past what was assembled. Going back the stream starts at piece 7, on the
 * frame the pieces carry, and piece 0 lands as the frame before that one is ending.
 */
export class MtcDecoder {
  private nibbles = new Array<number>(8).fill(0)
  private last = -1
  private direction: 1 | -1 = 1
  private run = 0

  constructor(private readonly sink: MtcSink) {}

  /** The data byte of an `F1` message. */
  quarterFrame(data: number, at: number): void {
    const piece = (data >> 4) & 0x07
    const nibble = data & 0x0f
    this.sink.alive(at)

    if (this.last >= 0 && piece === ((this.last + 1) & 7)) {
      if (this.direction !== 1) this.run = 1
      this.direction = 1
      this.run++
    } else if (this.last >= 0 && piece === ((this.last + 7) & 7)) {
      if (this.direction !== -1) this.run = 1
      this.direction = -1
      this.run++
    } else {
      this.run = 1
    }
    this.last = piece
    this.nibbles[piece] = nibble

    // A run of eight in one direction ends on 7 going forward and on 0 going back; the
    // pieces in between are the same set read either way.
    const complete = this.run >= 8 && ((this.direction === 1 && piece === 7) || (this.direction === -1 && piece === 0))
    if (!complete) return

    const n = this.nibbles
    const rate = rateFromCode((n[7] >> 1) & 0x03)
    const tc: Timecode = {
      frames: n[0] | ((n[1] & 0x01) << 4),
      seconds: n[2] | ((n[3] & 0x03) << 4),
      minutes: n[4] | ((n[5] & 0x03) << 4),
      hours: n[6] | ((n[7] & 0x01) << 4)
    }
    if (tc.hours > 23 || tc.minutes > 59 || tc.seconds > 59 || tc.frames >= rateInfo(rate).nominal) return
    const frames = timecodeToFrames(tc, rate)
    if (this.direction === 1) this.sink.running(frames + 1.75, rate, at, 1)
    else this.sink.running(frames - 0.75, rate, at, -1)
  }

  /** A SysEx message: true when it was a full-frame locate, which it then reports. */
  sysex(bytes: ArrayLike<number>, at: number): boolean {
    const full = decodeFullFrame(bytes)
    if (full === null) return false
    // A locate breaks the run: the pieces after it start a set of their own.
    this.run = 0
    this.last = -1
    this.sink.located(timecodeToFrames(full.tc, full.rate), full.rate, at)
    return true
  }

  /** Raw bytes from a port: one message, as the MIDI layer delivers them. */
  message(bytes: ArrayLike<number>, at: number): boolean {
    if (bytes.length === 2 && bytes[0] === 0xf1) {
      this.quarterFrame(bytes[1], at)
      return true
    }
    if (bytes.length > 0 && bytes[0] === 0xf0) return this.sysex(bytes, at)
    return false
  }
}

/**
 * The quarter frames a running clock owes the wire.
 *
 * Positions are counted in quarter frames from 00:00:00:00, and sets of eight start on
 * even frames, so piece 0 always lands on the frame it names whatever frame the clock
 * started on. `due(now)` returns every message whose moment has come since the last call
 * — a timer that fires late catches up rather than slipping — but never more than a
 * frame and a half of them at once: a clock that was starved for longer has a gap, and
 * the honest thing to say about a gap is a full frame where the clock is now.
 */
export class MtcClock {
  private startQuarter: number
  private sentQuarter: number
  private startedAt: number

  constructor(
    private rate: TimecodeRate,
    startFrames: number,
    now: number,
    /** Real-time speed: 1 is the clock, and nothing else is generated today. */
    private readonly speed = 1
  ) {
    this.startQuarter = Math.floor(startFrames) * 4
    this.sentQuarter = this.startQuarter - 1
    this.startedAt = now
  }

  /** Where the clock is at `now`, in frames. */
  framesAt(now: number): number {
    return (this.startQuarter + this.quartersSince(now)) / 4
  }

  private quartersSince(now: number): number {
    return ((now - this.startedAt) * rateInfo(this.rate).fps * 4 * this.speed) / 1000
  }

  /** The quarter frames that have come due, oldest first, and a full frame if it skipped. */
  due(now: number): number[][] {
    const target = this.startQuarter + Math.floor(this.quartersSince(now) + 1e-9)
    const out: number[][] = []
    if (target - this.sentQuarter > 6) {
      // Starved: say where the clock is and carry on from there.
      this.sentQuarter = target - 1
      out.push(encodeFullFrame(framesToTimecode(Math.floor(target / 4), this.rate), this.rate))
    }
    for (let q = this.sentQuarter + 1; q <= target; q++) {
      const piece = ((q % 8) + 8) % 8
      const groupFrame = (q - piece) / 4
      out.push(encodeQuarterFrame(framesToTimecode(groupFrame, this.rate), this.rate, piece))
    }
    this.sentQuarter = Math.max(this.sentQuarter, target)
    return out
  }

  /** When the next quarter frame is due, so a timer can sleep until then. */
  nextDueAt(): number {
    const quarterMs = 1000 / (rateInfo(this.rate).fps * 4 * this.speed)
    return this.startedAt + (this.sentQuarter + 1 - this.startQuarter) * quarterMs
  }
}
