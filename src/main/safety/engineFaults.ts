import type { AudioEngineEvent } from '../../shared/audio'
import type { AlertLevel } from '../../shared/show'

/**
 * Which engine events the operator has to be told about, and in what words.
 *
 * The engine's events are consumed in one place, and one of them is an alarm rather than
 * a line for the log: a device it lost. Keeping the decision pure means it can be tested
 * without a bus, a socket or a window — the way `panicFromShowEvent` is — while the IPC
 * layer applies the answer through the alarm path every other alarm uses.
 */

/** One alarm the show owes the operator: the level, what raised it, and the engine's own
 *  fault line. */
export interface EngineFaultAlert {
  level: AlertLevel
  /** What raised it, so an alarm can be traced the way a service's id traces one. */
  source: string
  message: string
}

/**
 * The alarm a device the engine lost raises, or null when the event is not that.
 *
 * `error` with `code === 'device'` is the engine's fault line for a device that went
 * away: the show has stopped making a sound mid-performance, which is the level it is
 * raised at. The engine's other reports are not this alarm — a cue that failed is the
 * cue's own line, an engine that died or restarted reports itself with `engine` — and a
 * deliberate stop (a reconfigure, a shutdown) writes nothing to the wire at all.
 */
export function deviceFaultAlert(event: AudioEngineEvent): EngineFaultAlert | null {
  if (event.type !== 'error' || event.code !== 'device') return null
  return { level: 'critical', source: 'audio', message: event.message }
}
