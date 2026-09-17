import type { Cue } from './cue'
import type { ShowSettings } from './show'
import type { ShowHistoryEntry } from './showfile'

export interface AudioSettings {
  /**
   * The audio system the show asks the engine to use. Absent means the engine's own
   * default, which is the platform's own audio stack.
   */
  backend?: 'auto' | 'asio'
  outputDeviceId: string
  /** Requested sample rate, Hz. Absent leaves the device's own rate. */
  sampleRate?: number
  /** Requested output channels. Absent leaves the device's own count. */
  channels?: number
  /** Take the device exclusively, where the driver allows it. */
  exclusive?: boolean
  /** Requested buffer size in frames. Absent leaves the engine's own. */
  bufferFrames?: number
  /**
   * Whether a new audio cue is born trimming the silence from its file's edges. A
   * default, not a switch: it is copied into the cue when the cue is made, so turning
   * it on or off changes nothing that is already in the show.
   */
  autoTrimSilence?: boolean
}

export interface MidiSettings {
  outputPortName: string
}

/**
 * The guard that stands in front of every way a cue can be fired: the keyboard, an OSC
 * datagram, a MIDI message. A press whose hand shakes, or a desk that sends the same
 * message twice, should start one cue rather than two — and a cue that is already
 * running should not be restarted by the second one unless it was asked to be.
 *
 * A window rather than a set of per-surface timings, because an operator who has just
 * watched a doubled note truncate a cue reaches for one number, not three. It travels
 * with the show: the desk on the other end is part of the show.
 */
export interface TriggerGuardSettings {
  /**
   * How long, in milliseconds, one surface stays deaf after it fires a cue. Zero turns
   * the window off — which is a thing a show may want, and the reason it is a field
   * rather than a constant.
   */
  windowMs: number
}

/**
 * What a new show's guard is: long enough to swallow the bounce of a key, a footswitch
 * or a desk sending twice, and short enough that two cues meant as two cues are two
 * cues. Nothing musical lives inside a third of a second.
 */
export const DEFAULT_TRIGGER_GUARD: TriggerGuardSettings = { windowMs: 300 }

/** The guard's editable range. A window past two seconds is a cue that refused to fire. */
export const TRIGGER_GUARD_MIN_MS = 0
export const TRIGGER_GUARD_MAX_MS = 2000

/** Fills in a gate a workspace saved by an older build never wrote. */
export function normalizeTriggerGuard(
  guard: Partial<TriggerGuardSettings> | undefined
): TriggerGuardSettings {
  const windowMs = guard?.windowMs
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs)) return { ...DEFAULT_TRIGGER_GUARD }
  return {
    windowMs: Math.min(Math.max(windowMs, TRIGGER_GUARD_MIN_MS), TRIGGER_GUARD_MAX_MS)
  }
}

/**
 * A show's identity as it is stored: minted once, when the show is made, and carried by
 * every save afterwards. Saving is not a new show, so nothing about a save may change
 * these — a file that rewrites its own id and date on every write cannot be diffed, and
 * a version history is the point of the format.
 */
export interface WorkspaceIdentity {
  id: string
  createdAt: string
}

export interface Workspace {
  version: 1
  id: string
  name: string
  createdAt: string
  /**
   * What the file's saves have changed, oldest first, written by the app rather than by
   * the renderer. Optional: a workspace saved before the history existed has none, and
   * the first save that changes something adds the first entry. A save that changes
   * nothing adds nothing, which is what keeps an untouched showfile byte-identical.
   */
  history?: ShowHistoryEntry[]
  audioSettings: AudioSettings
  midiSettings: MidiSettings
  /**
   * Ports and listeners for the show services. Optional: workspaces saved before the
   * services existed carry no such section, and the migration fills it in.
   */
  showSettings?: ShowSettings
  /**
   * How long a firing surface stays deaf afterwards. Optional for the same reason: a
   * workspace saved before the guard existed gets the default on load.
   */
  triggerGuard?: TriggerGuardSettings
  cues: Cue[]
}
