// Panic crosses the process boundary, so its shape lives where both processes can read
// it: the main process decides to silence the show, and the renderer is told so it can
// drop the cues and scripts it still holds. The engine's own panic never waits for that
// trip — the broadcast is bookkeeping, not the silence.

/** The fade panic cuts with, matching the guide and the renderer's own panic button. */
export const PANIC_FADE_MS = 200

/** Which path decided to silence the show. */
export type PanicSource =
  | 'menu'
  | 'osc'
  | 'midi'
  | 'watchdog'
  | 'renderer-crash'
  | 'renderer-unresponsive'
  | 'renderer'

export interface PlaybackPanic {
  /** When main acted, on the wall clock. */
  at: number
  source: PanicSource
  /** Operator-facing: what main knew, e.g. "no heartbeat for 3400ms with playback active". */
  reason: string
  fadeMs: number
}
