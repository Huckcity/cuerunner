import type { ClockMissedPolicy, Cue, CueTrigger } from '../../../shared/cue'
import { cueTriggers } from './triggers'

// Wall-clock triggers: a cue that fires at a time of day on this machine's clock — the half-hour
// call, the house-open loop, the interval bell.
//
// The clock is read, not trusted to tick: the watcher is woken once a second and asks what
// times of day have gone by since it last looked. A time that went by inside the last couple of
// seconds is on time, and fires. A time that went by further back than that went by while the
// watcher could not see it — the show was closed, the machine was asleep, the window was hung —
// and the trigger's own policy decides: `skip` writes that it was missed and fires nothing,
// `fire` fires it late when it is no more than its grace behind and says so. Either way it is
// said, once, because a half-hour call that did not happen is something the stage manager has
// to hear from the log rather than from the cast.
//
// Nothing here owns a timer or reads `Date.now()`: the hook does (`useClockTriggers`), and the
// tests hand in the clock.

/** A time of day that has gone by on time, if it went by this recently, ms. */
export const ON_TIME_MS = 2500

/** How far back a show that has just opened looks for times it missed, ms: the longest grace. */
export const LOOK_BACK_MS = 60 * 60 * 1000

/** The longest grace a trigger may give a late time, in minutes. */
export const MAX_GRACE_MINUTES = 60

/** What a clock trigger's time is, as seconds since midnight, or null when it is not a time. */
export function clockSeconds(text: string): number | null {
  const match = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(text)
  if (!match) return null
  const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3] ?? '0')]
  if (h > 23 || m > 59 || s > 59) return null
  return h * 3600 + m * 60 + s
}

/** A time as the trigger writes it: `19:30`, or `19:30:15` when it has seconds. */
export function formatClockTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return s === 0 ? `${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type ClockTrigger = Extract<CueTrigger, { kind: 'clock' }>

/** How a clock trigger reads in a list: `19:30 every day`, `14:00 Sat, Sun · fires late within 5 min`. */
export function describeClockTrigger(trigger: ClockTrigger): string {
  const days = trigger.days.length === 0 || trigger.days.length === 7
    ? 'every day'
    : [...trigger.days].sort((a, b) => a - b).map(day => DAY_NAMES[day] ?? '?').join(', ')
  const missed = trigger.missed === 'fire'
    ? ` · fires late within ${trigger.graceMinutes} min`
    : ''
  return `${trigger.time} ${days}${missed}`
}

/**
 * Every moment in `(from, to]` at which a trigger's time of day came round on a day it answers,
 * oldest first, read on the local clock — so a show in a building that changes its clocks
 * keeps to the clock on the wall. Bounded by the span asked about: a watcher that has been
 * away for a week asks about a week, which is seven moments a trigger at most.
 */
export function occurrences(trigger: ClockTrigger, from: number, to: number): number[] {
  const seconds = clockSeconds(trigger.time)
  if (seconds === null || to <= from) return []
  const found: number[] = []
  const day = new Date(from)
  day.setHours(0, 0, 0, 0)
  // One day before the span begins, in case the time of day sits before midnight's shift.
  day.setDate(day.getDate() - 1)
  for (let guard = 0; guard < 400; guard++) {
    const at = new Date(day)
    at.setHours(Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60, 0)
    const moment = at.getTime()
    if (moment > to) break
    if (moment > from && (trigger.days.length === 0 || trigger.days.includes(at.getDay()))) found.push(moment)
    day.setDate(day.getDate() + 1)
  }
  return found
}

/** One thing the watcher decided about one trigger's time. */
export type ClockDecision =
  | { kind: 'fire'; cueId: string; triggerId: string; at: number; lateMs: number }
  | { kind: 'missed'; cueId: string; triggerId: string; at: number; lateMs: number; policy: ClockMissedPolicy }

/**
 * Watches the clock for a cue list. `check(now)` answers what has come due since the last
 * check; the first check after `open` looks back over the last hour, which is the span a show
 * that has just been opened was not there to see.
 */
export class ClockTriggerWatcher {
  private last: number | null = null

  /** The moment the show began watching: everything before it was missed, not on time. */
  open(now: number): void {
    this.last = now - LOOK_BACK_MS
  }

  /** Forgets where it was: a closed show sees nothing. */
  close(): void {
    this.last = null
  }

  check(cues: readonly Cue[], now: number): ClockDecision[] {
    if (this.last === null) this.open(now)
    const from = this.last as number
    this.last = now
    // A clock moved backwards — the machine's time was corrected — has nothing new to show.
    if (now <= from) return []
    const decisions: ClockDecision[] = []
    for (const cue of cues) {
      if (!cue.isArmed) continue
      for (const trigger of cueTriggers(cue)) {
        if (trigger.kind !== 'clock') continue
        const times = occurrences(trigger, from, now)
        if (times.length === 0) continue
        // Only the latest time counts: a week away is one late half-hour call, not seven.
        const at = times[times.length - 1]
        const lateMs = now - at
        if (lateMs <= ON_TIME_MS) {
          decisions.push({ kind: 'fire', cueId: cue.id, triggerId: trigger.id, at, lateMs })
          continue
        }
        const graceMs = Math.min(MAX_GRACE_MINUTES, Math.max(0, trigger.graceMinutes)) * 60_000
        if (trigger.missed === 'fire' && lateMs <= graceMs) {
          decisions.push({ kind: 'fire', cueId: cue.id, triggerId: trigger.id, at, lateMs })
        } else {
          decisions.push({ kind: 'missed', cueId: cue.id, triggerId: trigger.id, at, lateMs, policy: trigger.missed })
        }
      }
    }
    return decisions
  }
}
