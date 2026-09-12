import { app } from 'electron'
import type { AudioEngineEvent, AudioEngineInfo } from '../../shared/audio'
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
}

declare global {
  // eslint-disable-next-line no-var
  var __winslabDevHarness: PlaybackDevHarness | undefined
}

export interface PlaybackDevHarnessDeps {
  safety: PlaybackSafety
  engine: {
    info: () => AudioEngineInfo | Promise<AudioEngineInfo>
    /** Engine-level facts, only ever installed by a build running from the source tree. */
    recentEvents: () => AudioEngineEvent[]
  }
}

/** No-op in a packaged build, so a release cannot expose it by accident. */
export function installPlaybackDevHarness(deps: PlaybackDevHarnessDeps): void {
  if (app.isPackaged) return
  globalThis.__winslabDevHarness = {
    safety: () => deps.safety.state(),
    engineInfo: () => deps.engine.info(),
    engineEvents: () => deps.engine.recentEvents()
  }
}
