import type { Cue } from '../../../shared/cue'
import {
  framesToMs,
  parseTimecodeFrames,
  positionAt,
  type TimecodeOnStop,
  type TimecodeRate,
  type TimecodeReceiverStatus
} from '../../../shared/timecode'

/**
 * The cue list following an incoming clock.
 *
 * Every cue with a timecode trigger has a place on the clock. While the clock runs forward
 * through a cue's frame, the cue fires — once per pass, armed again when the clock goes back
 * before it — exactly as a trigger fires any cue, pre-wait and advance included. A clock that
 * skips a few frames (a dropout, a slipped reel) still fires what it skipped, up to the
 * tolerance; a jump further than that is a locate, and fires nothing it jumped over.
 *
 * With chase on, the list goes where the clock goes. A locate — and the clock starting
 * again after a stop — puts every cue whose frame is behind the clock and whose length
 * reaches past it into play at the right point inside it, and stops what the clock has left
 * behind; a cue the clock is not over is not touched. When the clock stops, what chase
 * started is held (stopped, and put back where the clock is when it runs again), stopped
 * outright, or left running, as the setting says.
 *
 * Pure: it is told where the clock is and what time it is, and it says what to do through
 * its deps, so a test drives it with a fake clock and no window.
 */
export interface ChaseDeps {
  getCues(): Cue[]
  settings(): { chase: boolean; toleranceFrames: number; onStop: TimecodeOnStop }
  /** Fires a cue the way a trigger does. `frames` is the trigger's own, for the log. */
  fire(cue: Cue, frames: number, rate: TimecodeRate): void
  /** Starts a cue `seekMs` into itself, with no pre-wait: the clock is already past its start. */
  chase(cue: Cue, seekMs: number): void
  stop(cueId: string): void
  isRunning(cueId: string): boolean
  log?(message: string): void
  /**
   * Where a cue's list puts it on the clock: frames added to its triggers, or null for a list
   * that does not follow the clock — turned off, or taken out of the show. Optional: without it
   * every cue follows the show's clock as it is, which is what a show of one list does.
   */
  listShift?(cue: Cue): number | null
}

interface Placed {
  cue: Cue
  triggerId: string
  frames: number
}

/** The cue types a chase places mid-way: the ones with a length that a seek can land inside. */
function chaseLengthMs(cue: Cue): number | null {
  if (cue.type === 'audio' || cue.type === 'wait') return cue.duration > 0 ? cue.duration : null
  return null
}

export class TimecodeChase {
  private last: number | null = null
  private lastRunning = false
  /** Triggers this pass has fired, by trigger id. */
  private fired = new Set<string>()
  /** Cues the clock started, so a stop knows which ones are the clock's to hold. */
  private owned = new Set<string>()
  private parsed = new Map<string, number | null>()

  constructor(private readonly deps: ChaseDeps) {}

  /** Every cue with a timecode trigger, at `rate`, in cue order. */
  private placed(rate: TimecodeRate): Placed[] {
    const out: Placed[] = []
    for (const cue of this.deps.getCues()) {
      if (!cue.isArmed) continue
      const shift = this.deps.listShift === undefined ? 0 : this.deps.listShift(cue)
      if (shift === null) continue
      for (const trigger of cue.triggers ?? []) {
        if (trigger.kind !== 'timecode') continue
        const key = `${rate}|${trigger.timecode}`
        let frames = this.parsed.get(key)
        if (frames === undefined) {
          frames = parseTimecodeFrames(trigger.timecode, rate)
          this.parsed.set(key, frames)
        }
        if (frames !== null) out.push({ cue, triggerId: trigger.id, frames: frames + shift })
      }
    }
    return out
  }

  /** Where the clock is now. Called on every status and on a short tick between them. */
  update(status: TimecodeReceiverStatus, now: number): void {
    const position = positionAt(status, now)
    const running = status.state === 'locked' || status.state === 'freewheel'
    const settings = this.deps.settings()

    if (!running) {
      if (this.lastRunning) this.stopped(settings.onStop)
      this.lastRunning = false
      this.last = position
      return
    }
    if (position === null) return

    const placed = this.placed(status.rate)
    const tolerance = settings.toleranceFrames
    const last = this.last
    const starting = !this.lastRunning || last === null
    const forward = last !== null && position >= last
    const step = last === null ? 0 : position - last

    if (!starting && forward && step <= tolerance + 1) {
      // Running through: fire what the clock passed since the last look.
      for (const entry of placed) {
        if (entry.frames > last! && entry.frames <= position) this.fireOnce(entry, status.rate)
      }
    } else if (!starting && !forward && -step <= tolerance + 1) {
      // Running back a little: what is now ahead of the clock may fire again.
      this.rearm(placed, position)
    } else {
      this.located(placed, position, status.rate, settings, starting, tolerance)
    }
    this.last = position
    this.lastRunning = true
  }

  private fireOnce(entry: Placed, rate: TimecodeRate): void {
    if (this.fired.has(entry.triggerId)) return
    this.fired.add(entry.triggerId)
    this.owned.add(entry.cue.id)
    this.deps.fire(entry.cue, entry.frames, rate)
  }

  private rearm(placed: Placed[], position: number): void {
    for (const entry of placed) if (entry.frames > position) this.fired.delete(entry.triggerId)
  }

  /**
   * The clock is somewhere it did not run to: a jump, or a start. What it is ahead of is
   * armed again; what it is a hair past (inside the tolerance) fires, because a clock that
   * starts on a cue's frame and is first heard a frame later meant that cue; and with chase
   * on, what it is inside of is put where it should be.
   */
  private located(
    placed: Placed[],
    position: number,
    rate: TimecodeRate,
    settings: { chase: boolean; onStop: TimecodeOnStop },
    starting: boolean,
    tolerance: number
  ): void {
    this.fired.clear()
    const chase = settings.chase && !(starting && settings.onStop === 'stop' && this.last !== null)
    const inside = new Set<string>()
    for (const entry of placed) {
      if (entry.frames > position) continue
      if (position - entry.frames <= tolerance) {
        this.fireOnce(entry, rate)
        inside.add(entry.cue.id)
        continue
      }
      // Behind the clock and out of reach: passed, not to be fired by running on.
      this.fired.add(entry.triggerId)
      if (!chase) continue
      const lengthMs = chaseLengthMs(entry.cue)
      if (lengthMs === null) continue
      const seekMs = framesToMs(position - entry.frames, rate)
      if (seekMs >= lengthMs) continue
      inside.add(entry.cue.id)
      this.owned.add(entry.cue.id)
      this.deps.chase(entry.cue, seekMs)
    }
    if (!chase) return
    // What the clock started and is no longer inside of goes quiet.
    for (const cueId of [...this.owned]) {
      if (inside.has(cueId)) continue
      if (this.deps.isRunning(cueId)) this.deps.stop(cueId)
      this.owned.delete(cueId)
    }
  }

  private stopped(onStop: TimecodeOnStop): void {
    if (!this.deps.settings().chase || onStop === 'continue') return
    for (const cueId of this.owned) {
      if (this.deps.isRunning(cueId)) this.deps.stop(cueId)
    }
    this.deps.log?.(onStop === 'hold'
      ? 'timecode stopped: holding the cues it was running'
      : 'timecode stopped: stopped the cues it was running')
    this.owned.clear()
  }

  reset(): void {
    this.last = null
    this.lastRunning = false
    this.fired.clear()
    this.owned.clear()
    this.parsed.clear()
  }
}
