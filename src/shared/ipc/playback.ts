// The two messages that exist because the show keeps running when the window does not.
// Neither is a command to the engine: the heartbeat says a hand is still on the wheel,
// and the panic says main already silenced the show by itself (see src/main/safety).

import type { PlaybackPanic } from '../playback'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const PLAYBACK_CHANNELS = {
  /**
   * Sent on a timer whether or not a cue is running: main's watchdog silences the engine
   * when these stop arriving while anything is playing.
   */
  heartbeat: 'playback:heartbeat',
  /** A panic main decided on — the menu, the watchdog, or a show input binding. */
  panic: 'playback:panic'
} as const

/** Playback safety, as the renderer reads it (`window.cuerunner.playback`). */
export interface PlaybackBridge {
  /** Fire and forget: a heartbeat that fails is a missed heartbeat, and that is noticed. */
  heartbeat(): void
  onPanic(callback: (panic: PlaybackPanic) => void): () => void
}
