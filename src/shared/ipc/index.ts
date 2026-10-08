// The bridge the preload exposes as `window.cuerunner`, and the one place the app's whole
// IPC surface is read from.
//
// Every namespace declares its channel table and its bridge in its own file — the ten
// beside this one, audio in `src/shared/audio.ts` — and each wire shape is written where
// it already belongs: a request the domain module owns (`network`, `osc`, `playback`,
// `license`) stays there, and one only this seam has is declared in the namespace file.
// This file composes them into the type the renderer's `window` and the preload's
// `satisfies` both use, so a member added, renamed or removed fails to compile at both
// ends rather than at a button on stage.
//
// Audio is the worked example (src/shared/audio.ts): a verb-keyed channel table with the
// push channel in it, payload interfaces beside the verbs that carry them, and one
// interface consumed by the two processes. The other ten namespaces follow it, with the
// one licence the rule allows: a request shape that already lives in a domain module is
// read from there rather than restated.

import { AUDIO_CHANNELS, type AudioEngineBridge } from '../audio'
import { APP_CHANNELS, type AppBridge } from './app'
import { PLAYBACK_CHANNELS, type PlaybackBridge } from './playback'
import { MIDI_CHANNELS, type MidiBridge } from './midi'
import { NETWORK_CHANNELS, type NetworkBridge } from './network'
import { OSC_CHANNELS, type OscBridge } from './osc'
import { SHOW_CHANNELS, type ShowBridge } from './show'
import { REDUNDANCY_CHANNELS, type RedundancyBridge } from './redundancy'
import { LICENSE_CHANNELS, type LicenseBridge } from './license'
import { SCRIPT_CHANNELS, type ScriptBridge } from './script'
import { WORKSPACE_CHANNELS, type WorkspaceBridge } from './workspace'
import { QLAB_CHANNELS, type QLabBridge } from './qlab'
import { TIMECODE_CHANNELS, type TimecodeBridge } from './timecode'
import { OUTPUT_CHANNELS, type OutputBridge } from './output'

/** Everything `window.cuerunner` carries, as the renderer reads it. */
export interface CuerunnerBridge {
  /** `process.platform` of the machine the app is running on. */
  platform: string
  /** Where a File the window holds lives on disk; the renderer has no Node to ask. */
  getPathForFile(file: File): string
  app: AppBridge
  playback: PlaybackBridge
  audio: AudioEngineBridge
  midi: MidiBridge
  network: NetworkBridge
  osc: OscBridge
  show: ShowBridge
  redundancy: RedundancyBridge
  license: LicenseBridge
  script: ScriptBridge
  workspace: WorkspaceBridge
  qlab: QLabBridge
  timecode: TimecodeBridge
  output: OutputBridge
}

/**
 * Every domain's channel table, joined where the whole surface is composed: the interface
 * above joins the namespaces, and this joins the tables behind them. A reader that needs
 * the declared set — the parity gate in `src/main/ipc/parity.test.ts` — derives it from
 * here rather than listing the domains a second time, so a namespace that joins the bridge
 * joins this too, or it is missing from the composition rather than from a test.
 */
export const CHANNEL_TABLES = [
  APP_CHANNELS,
  PLAYBACK_CHANNELS,
  MIDI_CHANNELS,
  NETWORK_CHANNELS,
  OSC_CHANNELS,
  SHOW_CHANNELS,
  REDUNDANCY_CHANNELS,
  LICENSE_CHANNELS,
  SCRIPT_CHANNELS,
  WORKSPACE_CHANNELS,
  AUDIO_CHANNELS,
  QLAB_CHANNELS,
  TIMECODE_CHANNELS,
  OUTPUT_CHANNELS
] as const

/**
 * The channels main pushes on — the events, not the request channels. `sendToWindow`
 * accepts nothing else, so a push on an event this list leaves out fails to compile;
 * keeping a request channel out of the list is on the list, not on the type.
 */
export const EVENT_CHANNELS = [
  APP_CHANNELS.closeRequested,
  APP_CHANNELS.menuAction,
  APP_CHANNELS.mainError,
  PLAYBACK_CHANNELS.panic,
  AUDIO_CHANNELS.events,
  SHOW_CHANNELS.events,
  LICENSE_CHANNELS.changed,
  TIMECODE_CHANNELS.events,
  OUTPUT_CHANNELS.events
] as const

export type EventChannel = (typeof EVENT_CHANNELS)[number]
