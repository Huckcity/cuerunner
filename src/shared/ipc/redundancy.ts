// Redundant playback, this machine's half of a pair. Reading is free — a locked app
// should be able to say what it would be — and the gate is on the change, which is why
// the result carries the settings as well as the refusal: the window redraws from one
// answer rather than from the one it hoped for.

import type { RedundancySettings } from '../redundancy'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const REDUNDANCY_CHANNELS = {
  settings: 'redundancy:settings',
  configure: 'redundancy:configure'
} as const

/** What a change did: `ok` false leaves `settings` as they were, to redraw from. */
export interface RedundancyConfigureResult {
  ok: boolean
  settings: RedundancySettings
  error?: string
}

/** Redundant playback, as the renderer reads it (`window.cuerunner.redundancy`). */
export interface RedundancyBridge {
  settings(): Promise<RedundancySettings>
  configure(patch: Partial<RedundancySettings>): Promise<RedundancyConfigureResult>
}
