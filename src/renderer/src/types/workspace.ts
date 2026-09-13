import type { Cue } from './cue'
import type { ShowSettings } from './show'

export interface AudioSettings {
  outputDeviceId: string
  /** Requested sample rate, Hz. Absent leaves the device's own rate. */
  sampleRate?: number
  /** Requested output channels. Absent leaves the device's own count. */
  channels?: number
  /** Take the device exclusively, where the driver allows it. */
  exclusive?: boolean
  /** Requested buffer size in frames. Absent leaves the engine's own. */
  bufferFrames?: number
}

export interface MidiSettings {
  outputPortName: string
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
  audioSettings: AudioSettings
  midiSettings: MidiSettings
  /**
   * Ports and listeners for the show services. Optional: workspaces saved before the
   * services existed carry no such section, and the migration fills it in.
   */
  showSettings?: ShowSettings
  cues: Cue[]
}
