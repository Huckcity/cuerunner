// The window's half of the playback contract with the main process: it says it is
// alive, it hears about a panic main decided on, and it applies the show's device
// settings to the engine. Mounted once, from the top of the app.

import { useEffect } from 'react'
import { audioEngine } from '../engine/audioEngineClient'
import { cueRunner } from '../engine/CueRunner'
import { useStore } from '../store'

/** How often the window says it is alive. Main acts only while the engine is playing. */
const HEARTBEAT_MS = 1000

export function usePlaybackBridge(): void {
  const audioSettings = useStore(s => s.audioSettings)

  // Main's watchdog listens for this beat whether or not a cue is running: silence
  // while playback is active is what tells it the window is gone.
  useEffect(() => {
    window.winslab.playback.heartbeat()
    const timer = setInterval(() => window.winslab.playback.heartbeat(), HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [])

  // A panic main decided on — the menu, OSC, a MIDI all-sound-off, the watchdog — has
  // already silenced the engine. The window's half is to drop the cues and scripts it
  // is still holding, and to do it without panicking a second time.
  useEffect(() => {
    return window.winslab.playback.onPanic(() => cueRunner.handleExternalPanic())
  }, [])

  // Device settings travel with the show, so they are applied when the window opens and
  // again whenever the operator changes one.
  useEffect(() => {
    void audioEngine.configure({
      deviceId: audioSettings.outputDeviceId === 'default' ? undefined : audioSettings.outputDeviceId,
      sampleRate: audioSettings.sampleRate,
      channels: audioSettings.channels,
      exclusive: audioSettings.exclusive,
      bufferFrames: audioSettings.bufferFrames
    }).catch(() => {
      // An engine that is not there yet will be told when the next change lands.
    })
  }, [audioSettings])
}
