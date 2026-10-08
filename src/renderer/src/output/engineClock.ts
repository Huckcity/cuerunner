// The engine's sample clock, as an output window sees it.
//
// The output cannot read the engine itself — main can — so it asks across a round trip and
// places each answer at the trip's midpoint (`fitClock`). Readings are taken often at first,
// to settle, and every second after; only the newest few are kept, because the engine's
// crystal and this machine's clock drift apart by parts per million, and an offset worked out
// an hour ago would be a frame or more out by now.

import { fitClock, type ClockFit, type ClockSample } from '../../../shared/visualSync'
import type { AudioClockReading } from '../../../shared/audio'

/** Readings kept for the fit. */
const KEPT_SAMPLES = 8
/** How often the clock is read while settling, and once settled. */
const SETTLING_MS = 200
const SETTLED_MS = 1000
const SETTLING_READS = 10

export class EngineClock {
  private samples: ClockSample[] = []
  private fit: ClockFit | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private reads = 0
  private stopped = false

  constructor(
    private readonly read: () => Promise<AudioClockReading | null>,
    /** A replaced engine counts from zero: everything placed on the old clock moves by this. */
    private readonly onRebase: (deltaMs: number) => void,
    private readonly local: () => number = () => performance.now()
  ) {}

  start(): void {
    this.stopped = false
    void this.poll()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  /** Engine ms now. Before the first reading, the window's own clock stands in. */
  now(): number {
    return this.toEngine(this.local())
  }

  /** A moment on this window's clock (`performance.now()`), as engine ms. */
  toEngine(localMs: number): number {
    return localMs + (this.fit?.offset ?? 0)
  }

  /** Whether a reading has arrived yet. */
  settled(): boolean {
    return this.fit !== null
  }

  /** Takes one reading; exposed so a window that has just been told to play can ask at once. */
  async poll(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const sentAt = this.local()
    let reading: AudioClockReading | null = null
    try {
      reading = await this.read()
    } catch {
      reading = null
    }
    const receivedAt = this.local()
    if (reading !== null && Number.isFinite(reading.clockMs)) {
      this.accept({ sentAt, receivedAt, engineMs: reading.clockMs, sessionId: reading.sessionId })
    }
    this.reads++
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.poll(), this.reads < SETTLING_READS ? SETTLING_MS : SETTLED_MS)
    }
  }

  /** One reading into the fit. Public for the tests, which hand it readings of their own. */
  accept(sample: ClockSample): void {
    const previous = this.fit
    this.samples.push(sample)
    if (this.samples.length > KEPT_SAMPLES) this.samples.splice(0, this.samples.length - KEPT_SAMPLES)
    if (previous !== null && sample.sessionId !== previous.sessionId) {
      // The engine was replaced. The old session's readings say nothing about the new one.
      this.samples = [sample]
    }
    const next = fitClock(this.samples)
    if (next === null) return
    this.fit = next
    if (previous !== null && next.sessionId !== previous.sessionId) {
      // A picture placed at engine time T on the old clock is at T + (new − old) on the new
      // one: the same instant on this window's clock.
      this.onRebase(next.offset - previous.offset)
    }
  }
}
