import type { Cue } from './cue'
import type { ShowSettings } from './show'

export interface AudioSettings {
  outputDeviceId: string
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
