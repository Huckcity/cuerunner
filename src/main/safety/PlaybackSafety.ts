import { reportMainError } from '../errors'
import { PANIC_FADE_MS } from '../../renderer/src/types/playback'
import type { PanicSource, PlaybackPanic } from '../../renderer/src/types/playback'
import type { AudioPanicResult } from '../../shared/audio'

// The main process is the last line of defence for the sound. The window can crash, and
// a renderer that is wedged half way through a script will never run its own panic path;
// the console still has to go quiet. Everything here works on the native engine, which
// lives in this process, so a panic lands whether or not the renderer is listening.



/**
 * How long the renderer may go without answering while something is playing before the
 * watchdog silences the show. A heartbeat is cheap and sent four times a second, so this
 * is wide enough for a garbage collection pause and narrow enough to matter on stage.
 */
export const HEARTBEAT_TIMEOUT_MS = 3000

/** How often the heartbeat is checked. */
export const HEARTBEAT_CHECK_MS = 500

/** The slice of the native audio service panic needs. */
export interface PanicEngine {
  /** Silences everything, and answers with what was actually stopped. */
  panic(fadeMs: number): AudioPanicResult | void | Promise<AudioPanicResult | void>
}

export interface PlaybackSafetyOptions {
  engine: PanicEngine
  /**
   * True while the engine holds a cue the operator would want silenced, or one that is
   * waiting on the sample clock. Read from the engine's own state, not from the
   * renderer: a renderer that has stopped answering cannot be asked whether it is
   * playing.
   */
  isPlaying: () => boolean
  /** Hands the panic to every live window, so pending cues and scripts are cancelled. */
  broadcast: (panic: PlaybackPanic) => void
  /** Overridable so the watchdog can be tested without waiting in real time. */
  now?: () => number
  timeoutMs?: number
  checkMs?: number
}

export interface PlaybackSafetyState {
  /** What the engine reported last. */
  playing: boolean
  /** Whether the renderer has answered a heartbeat recently enough to be believed. */
  rendererResponding: boolean
  lastPanic: PlaybackPanic | null
  /**
   * Voices the engine reported stopping for the last panic, once it has answered. Null
   * before the first panic and while the engine is still answering.
   */
  lastStoppedVoices: number | null
}

export class PlaybackSafety {
  private readonly engine: PanicEngine
  private readonly isPlaying: () => boolean
  private readonly broadcast: (panic: PlaybackPanic) => void
  private readonly now: () => number
  private readonly timeoutMs: number

  private lastHeartbeat: number | null = null
  // Set when a heartbeat was missed during playback. Latched so one silent renderer
  // does not panic on every tick, and cleared by the next heartbeat — a renderer that
  // comes back is not panicked again.
  private missedHeartbeats = false
  private timer: NodeJS.Timeout | null = null
  private lastPanic: PlaybackPanic | null = null
  private lastStoppedVoices: number | null = null

  constructor(options: PlaybackSafetyOptions) {
    this.engine = options.engine
    this.isPlaying = options.isPlaying
    this.broadcast = options.broadcast
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? HEARTBEAT_TIMEOUT_MS

    const checkMs = options.checkMs ?? HEARTBEAT_CHECK_MS
    this.timer = setInterval(() => this.check(), checkMs)
    // A heartbeat check must never be the thing that keeps the app alive on quit.
    this.timer.unref?.()
  }

  /**
   * Silences the engine now and tells the renderer, in that order: the sound is the
   * part that cannot wait, and the renderer's job — clearing pending cues and scripts —
   * is bookkeeping that must not delay it.
   */
  panic(source: PanicSource, reason: string, fadeMs: number = PANIC_FADE_MS): PlaybackPanic {
    const panic: PlaybackPanic = { at: this.now(), source, reason, fadeMs }
    this.lastPanic = panic

    try {
      // A native service that fails to fade must not stop the panic: the engine's own
      // panic path stops the sources either way. What it answers is kept, because it is
      // the only evidence of how much sound this actually silenced.
      const result = this.engine.panic(fadeMs)
      if (result instanceof Promise || (result !== null && typeof result === 'object')) {
        Promise.resolve(result)
          .then(outcome => {
            if (outcome && 'stoppedVoices' in outcome) this.lastStoppedVoices = outcome.stoppedVoices
          })
          .catch((error: unknown) => {
            reportMainError(`[main] panic could not be delivered to the engine: ${String(error)}`)
          })
      }
    } catch (error) {
      reportMainError(`[main] panic could not be delivered to the engine: ${String(error)}`)
    }

    try {
      this.broadcast(panic)
    } catch (error) {
      reportMainError(`[main] panic could not reach the renderer: ${String(error)}`)
    }

    reportMainError(`[main] panic (${source}): ${reason}`)
    return panic
  }

  /** The renderer answered. Any missed heartbeat is forgiven. */
  noteHeartbeat(): void {
    this.lastHeartbeat = this.now()
    if (this.missedHeartbeats) {
      this.missedHeartbeats = false
      reportMainError('[main] renderer is answering heartbeats again')
    }
  }

  /**
   * The renderer's process is gone. Chromium will reload it, but the audio service lives
   * in this process and keeps playing whatever it was told to; nothing the dead renderer
   * still held can stop it, so main does.
   */
  noteRendererGone(reason: string): void {
    this.lastHeartbeat = null
    this.missedHeartbeats = true
    this.panic('renderer-crash', `renderer stopped (${reason})`)
  }

  /** Chromium says the window is not answering its events. */
  noteRendererUnresponsive(): void {
    if (this.isPlaying()) {
      this.missedHeartbeats = true
      this.panic('renderer-unresponsive', 'renderer stopped answering with playback active')
    }
  }

  state(): PlaybackSafetyState {
    return {
      playing: this.isPlaying(),
      rendererResponding:
        this.lastHeartbeat !== null && this.now() - this.lastHeartbeat <= this.timeoutMs,
      lastPanic: this.lastPanic,
      lastStoppedVoices: this.lastStoppedVoices
    }
  }

  close(): void {
    clearInterval(this.timer ?? undefined)
    this.timer = null
  }

  private check(): void {
    // Nothing playing: a silent renderer is just a quiet desk. This is the rule that
    // keeps the watchdog out of startup, a stalled save dialog or an idle session.
    if (this.missedHeartbeats || !this.isPlaying()) return

    const last = this.lastHeartbeat
    // No heartbeat yet means the renderer has not loaded. Audio cannot be playing
    // through the renderer at that point, so there is nothing to guard.
    if (last === null) return

    const silence = this.now() - last
    if (silence <= this.timeoutMs) return

    this.missedHeartbeats = true
    this.panic(
      'watchdog',
      `renderer stopped answering: no heartbeat for ${Math.round(silence)}ms with playback active`
    )
  }
}
