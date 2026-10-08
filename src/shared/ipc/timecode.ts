// SMPTE timecode: where this machine hears the clock (its own settings), how the open show
// follows it (the show's section, sent on whenever it changes), the clocks the timecode cues
// run, and the status of all of it. Reading and setting are free — they only say where to
// listen and how — while starting a clock is the Pro half, and the refusal says so.

import type { Refusal } from './refusal'
import type {
  TimecodeGenerateRequest,
  TimecodeGeneratorAction,
  TimecodeSettings,
  TimecodeShowSettings,
  TimecodeStatus
} from '../timecode'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const TIMECODE_CHANNELS = {
  settings: 'timecode:settings',
  configure: 'timecode:configure',
  /** The open show's own timecode section: how the cue list follows the clock. */
  show: 'timecode:show',
  status: 'timecode:status',
  /** The inputs the clock can be heard on: MIDI ports, and the engine's capture devices. */
  inputs: 'timecode:inputs',
  /** Starts a timecode cue's clock. */
  generate: 'timecode:generate',
  /** Pauses, resumes, locates or stops one. */
  control: 'timecode:control',
  /** Main pushes TimecodeStatus here; preload subscribes with `onEvents`. */
  events: 'timecode:events'
} as const

/** What a start came to: where the clock started, or why it did not. */
export type TimecodeGenerateResult = { ok: true; startFrames: number } | Refusal

export interface TimecodeControlPayload {
  cueId: string
  action: TimecodeGeneratorAction
}

export interface TimecodeInputs {
  midi: string[]
  /** Capture devices by name; empty when the engine is not running or has none. */
  audio: string[]
}

/** Timecode, as the renderer reads it (`window.cuerunner.timecode`). */
export interface TimecodeBridge {
  settings(): Promise<TimecodeSettings>
  configure(patch: Partial<TimecodeSettings>): Promise<TimecodeSettings>
  /** Tells main how the open show follows the clock; answers with what it applied. */
  show(settings: TimecodeShowSettings): Promise<TimecodeShowSettings>
  status(): Promise<TimecodeStatus>
  inputs(): Promise<TimecodeInputs>
  generate(request: TimecodeGenerateRequest): Promise<TimecodeGenerateResult>
  /** False when no clock was running for that cue. */
  control(payload: TimecodeControlPayload): Promise<boolean>
  onEvents(callback: (status: TimecodeStatus) => void): () => void
}
