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
