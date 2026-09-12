import { app } from 'electron'
import type { AudioEngineEvent, AudioEngineInfo } from '../../shared/audio'
import type { AudioEngineStatus } from '../audio/AudioEngine'
import type { PlaybackSafety, PlaybackSafetyState } from './PlaybackSafety'

// A window into the main process for the end-to-end suite.
//
// The tests that matter here are about what main does when the renderer cannot answer:
// the working assumption is that the page is dead or wedged, so a destroyed-page mock
// would prove nothing. The spec launches the real app, kills the real renderer, and then
// has to read what the main process actually did — which needs a name in main's own
// global scope. It exists only in a build running from the source tree: a packaged app
// never installs it, and nothing in the product reads it.

export interface PlaybackDevHarness {
  /** What main knows: what is playing, whether the renderer is answering, last panic. */
  safety: () => PlaybackSafetyState
  /** The engine's own numbers, read without going through a window. */
  engineInfo: () => AudioEngineInfo | Promise<AudioEngineInfo>
  /**
   * What the engine has said recently — the panic and per-cue `ended` events a spec
   * reads to prove the sound stopped, rather than trusting a flag that could turn
   * false without anything being silenced.
   */
  engineEvents: () => AudioEngineEvent[]
  /**
   * Whether main is holding the OS off the app's timers. A napped desk dispatches late,
   * and the timing specs are the ones that measure it.
   */
  keepAwakeHeld: () => boolean
  /**
   * Whether the engine came up, and what it said if it did not. An engine that dies at
   * startup fails specs far away from the cause, and on Windows neither the app's stderr
   * nor the engine's reaches the runner.
   */
  engineStatus: () => AudioEngineStatus
  /**
   * Kills the engine child outright, the way a crash would — not a graceful shutdown.
   * The restart path is the one the show has to survive, and a spec cannot reach the
   * child from the outside on every platform.
   */
  killEngine: () => void
}

declare global {
  // eslint-disable-next-line no-var
  var __winslabDevHarness: PlaybackDevHarness | undefined
}

export interface PlaybackDevHarnessDeps {
  safety: PlaybackSafety
  /** The app's own answer to whether the OS is being held off its timers. */
  keepAwakeHeld: () => boolean
  engine: {
    info: () => AudioEngineInfo | Promise<AudioEngineInfo>
    /** Engine-level facts, only ever installed by a build running from the source tree. */
    recentEvents: () => AudioEngineEvent[]
    /** How the engine's own startup went, and what it said if it did not. */
    status: () => AudioEngineStatus
    /** A hard kill of the engine child; a packaged build never gets the harness. */
    kill: () => void
  }
}

/** No-op in a packaged build, so a release cannot expose it by accident. */
export function installPlaybackDevHarness(deps: PlaybackDevHarnessDeps): void {
  if (app.isPackaged) return
  globalThis.__winslabDevHarness = {
    safety: () => deps.safety.state(),
    keepAwakeHeld: deps.keepAwakeHeld,
    engineStatus: deps.engine.status,
    engineInfo: () => deps.engine.info(),
    engineEvents: () => deps.engine.recentEvents(),
    killEngine: () => deps.engine.kill()
  }
}
