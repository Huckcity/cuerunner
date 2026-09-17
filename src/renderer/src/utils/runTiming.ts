import type { Cue } from '../../../shared/cue'
import type { RunningCue } from '../store'
import type { AudioProgress } from '../../../shared/audio'

export interface RunTiming {
  elapsedMs: number
  /** Null when nothing says how long the phase lasts: an audio loop set to forever, a script. */
  remainingMs: number | null
  /** 0..1 through the phase, or null alongside an unknown length. */
  fraction: number | null
}

function span(elapsedMs: number, totalMs: number): RunTiming {
  const elapsed = Math.max(0, elapsedMs)
  if (totalMs <= 0) return { elapsedMs: elapsed, remainingMs: null, fraction: null }
  return {
    elapsedMs: elapsed,
    remainingMs: Math.max(0, totalMs - elapsed),
    fraction: Math.min(1, elapsed / totalMs)
  }
}

/**
 * Where a running cue is in its current phase. Audio reads the engine's own position,
 * which is the one the speakers agree with; everything else counts from the moment the
 * runner said the phase began. `totalMs` is the cue's length as the list shows it — a
 * group's is derived from its children, so the caller passes it in.
 */
export function runTiming(
  cue: Pick<Cue, 'preWait' | 'postWait'>,
  run: RunningCue,
  totalMs: number,
  nowMs: number,
  audio: AudioProgress | null
): RunTiming {
  const sinceStart = nowMs - run.startedAt
  if (run.state === 'pre-wait') return span(sinceStart, cue.preWait)
  if (run.state === 'post-wait') return span(sinceStart, cue.postWait)
  if (audio !== null && audio.durationMs > 0) return span(audio.elapsedMs, audio.durationMs)
  return span(sinceStart, totalMs)
}

/** A running clock as the booth reads it: always minutes, tenths, never a dash. */
export function formatRunTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const min = Math.floor(tenths / 600)
  const sec = (tenths % 600) / 10
  return `${min}:${sec.toFixed(1).padStart(4, '0')}`
}
