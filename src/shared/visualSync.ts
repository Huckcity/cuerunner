// Keeping a picture on the engine's clock.
//
// The sound of a video is an engine voice, started on the sample clock; the picture is a
// muted element Chromium decodes, on a clock of its own. Two clocks drift — a few
// milliseconds a minute is ordinary, and a video element that stalls for a decode loses a
// frame or two at a time — so the output measures, every frame, how far the picture is from
// where the engine clock says it should be, and closes the gap: a small error by playing the
// picture a little fast or slow until it is gone (the element is muted, so nothing is heard
// to bend), a large one by putting the picture where it belongs. The sound never moves: it
// is the show's clock, and the picture follows it.

/** Below this, the picture is where it should be and plays at its own rate. */
export const SYNC_DEADBAND_MS = 12
/** Past this, the picture is moved rather than chased: a seek is cheaper than seconds of catch-up. */
export const SYNC_SEEK_MS = 250
/** How hard a small error is chased: a 100 ms error is closed at 10% over about a second. */
export const SYNC_GAIN = 1
/** The most the picture's rate is bent while it catches up. */
export const SYNC_MAX_BEND = 0.1
/** Rate changes smaller than this are not worth asking the element for. */
export const SYNC_RATE_STEP = 0.005

export type SyncAction =
  | { kind: 'hold'; rate: number }
  | { kind: 'bend'; rate: number }
  | { kind: 'seek'; toMs: number; rate: number }

/**
 * What to do about a picture at `actualMs` that should be at `expectedMs`. `baseRate` is the
 * rate it plays at when nothing is wrong.
 */
export function syncCorrection(expectedMs: number, actualMs: number, baseRate = 1): SyncAction {
  const drift = actualMs - expectedMs
  if (Math.abs(drift) >= SYNC_SEEK_MS) return { kind: 'seek', toMs: expectedMs, rate: baseRate }
  if (Math.abs(drift) <= SYNC_DEADBAND_MS) return { kind: 'hold', rate: baseRate }
  const bend = Math.min(Math.max((drift / 1000) * SYNC_GAIN, -SYNC_MAX_BEND), SYNC_MAX_BEND)
  return { kind: 'bend', rate: baseRate * (1 - bend) }
}

/** Whether a new rate differs enough from the element's to be worth setting. */
export function rateWorthSetting(current: number, next: number): boolean {
  return Math.abs(current - next) >= SYNC_RATE_STEP
}

/**
 * One reading of the engine clock taken across a round trip: asked at `sentAt`, answered at
 * `receivedAt` (both on the reader's own clock), saying `engineMs`. The best guess is that
 * the engine read its clock half way through the trip, so the reading is placed there and
 * the trip's length is how much it can be trusted.
 */
export interface ClockSample {
  sentAt: number
  receivedAt: number
  engineMs: number
  sessionId: string
}

export interface ClockFit {
  /** engine = local + offset */
  offset: number
  /** The round trip of the sample the fit was taken from: its error is at most half of this. */
  rttMs: number
  sessionId: string
}

/**
 * The engine clock as a reader sees it, from the samples it has: the one with the shortest
 * round trip among the newest is trusted most, because a long trip is one the engine or the
 * IPC sat on and its midpoint is a guess. Samples from an older session than the newest are
 * not mixed in: a replaced engine counts from zero again.
 */
export function fitClock(samples: readonly ClockSample[]): ClockFit | null {
  if (samples.length === 0) return null
  const session = samples[samples.length - 1].sessionId
  let best: ClockSample | null = null
  for (const sample of samples) {
    if (sample.sessionId !== session) continue
    const rtt = sample.receivedAt - sample.sentAt
    if (rtt < 0) continue
    if (best === null || rtt < best.receivedAt - best.sentAt) best = sample
  }
  if (best === null) return null
  const midpoint = best.sentAt + (best.receivedAt - best.sentAt) / 2
  return { offset: best.engineMs - midpoint, rttMs: best.receivedAt - best.sentAt, sessionId: session }
}
