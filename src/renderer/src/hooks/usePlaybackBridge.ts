// The window's half of the playback contract with the main process: it says it is
// alive, it hears about a panic main decided on, and it applies the show's device
// settings to the engine. Mounted once, from the top of the app.

import { useEffect } from 'react'
import { applyAudioDeviceSettings, deviceOptionsFromSettings } from '../engine/audioDeviceSettings'
import { cueEngine } from '../engine/CueEngine'
import { useStore } from '../store'

/** How often the window says it is alive. Main acts only while the engine is playing. */
const HEARTBEAT_MS = 1000

export function usePlaybackBridge(): void {
  const audioSettings = useStore(s => s.audioSettings)
  // The device half of the audio settings: the show's patches, faders and loudness target
  // live there too, and a fader moved in the mixer is not a device to reopen.
  const deviceKey = JSON.stringify(deviceOptionsFromSettings(audioSettings))

  // Main's watchdog listens for this beat whether or not a cue is running: silence
  // while playback is active is what tells it the window is gone.
  useEffect(() => {
    window.cuerunner.playback.heartbeat()
    const timer = setInterval(() => window.cuerunner.playback.heartbeat(), HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [])

  // A panic main decided on — the menu, OSC, a MIDI all-sound-off, the watchdog — has
  // already silenced the engine. The window's half is to drop the cues and scripts it
  // is still holding, and to do it without panicking a second time.
  useEffect(() => {
    return window.cuerunner.playback.onPanic(() => cueEngine.handleExternalPanic())
  }, [])

  // Device settings travel with the show, so they are applied when the window opens and
  // again whenever the operator changes one. A request the engine will not honour keeps
  // its own words: the engine never downgrades a setting quietly, and neither does this.
  // The request itself lives in audioDeviceSettings, shared with the panel's lever; the
  // refusal is already in the store by the time it rejects.
  useEffect(() => {
    applyAudioDeviceSettings(useStore.getState().audioSettings).catch(() => {
      // Recorded by applyAudioDeviceSettings; nothing left for this effect to do.
    })
  }, [deviceKey])
}
