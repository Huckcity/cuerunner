// The real clock a MIDI file plays on: `performance.now()` to read, and a wake that lands on
// the millisecond rather than on whenever the OS timer next comes round.
//
// A timer alone is not enough. Node's timers fire at or after the delay they were given, and
// how far after is the operating system's: about a millisecond on Linux and macOS, and up to a
// whole 15.6 ms tick on Windows unless something has raised the system's timer resolution.
// Notes quantised to that are audible. So the wake sleeps on a timer until it is close, then
// yields the event loop turn by turn (`setImmediate`) for the last stretch, checking the clock
// each turn. The stretch is as long as timers have lately been late, learned as they fire —
// short where timers are good, a tick where they are not — so the spinning costs only what
// the machine's own timers make necessary.

import { performance } from 'node:perf_hooks'
import type { MidiFileClock } from './midiFilePlayer'

/** The least, and the most, a wake spends yielding before its moment, ms. */
const MIN_LEAD_MS = 2
const MAX_LEAD_MS = 20

/** A wake this close to its moment counts as on it. */
const ON_TIME_MS = 0.25

/** How much one late timer moves the learned lead, and how fast the lead relaxes after. */
const LEARN_UP = 1
const RELAX = 0.98

export interface HighResolutionClockOptions {
  now?: () => number
}

/** One clock for the process: what it learns about timer lateness serves every run. */
export function createHighResolutionClock(options: HighResolutionClockOptions = {}): MidiFileClock {
  const now = options.now ?? (() => performance.now())
  let lead = MIN_LEAD_MS

  return {
    now,
    wakeAt(atMs, wake) {
      let timer: ReturnType<typeof setTimeout> | null = null
      let immediate: ReturnType<typeof setImmediate> | null = null
      let cancelled = false

      const check = (): void => {
        timer = null
        immediate = null
        if (cancelled) return
        const left = atMs - now()
        if (left <= ON_TIME_MS) {
          wake()
          return
        }
        if (left > lead) {
          const asked = left - lead
          const setAt = now()
          timer = setTimeout(() => {
            // How late the timer was, against what it was asked for: the lead grows to cover
            // that and then relaxes, so one slow moment does not set it for the night.
            const late = now() - setAt - asked
            lead = Math.min(MAX_LEAD_MS, Math.max(MIN_LEAD_MS, lead * RELAX, late > 0 ? late + LEARN_UP : 0))
            check()
          }, asked)
          return
        }
        immediate = setImmediate(check)
      }

      // Never synchronously: a wake that is already due still goes on the next turn, so a
      // player asking to be woken cannot be re-entered from inside its own request.
      immediate = setImmediate(check)
      return () => {
        cancelled = true
        if (timer !== null) clearTimeout(timer)
        if (immediate !== null) clearImmediate(immediate)
      }
    }
  }
}
