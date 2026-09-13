// The window's half of the playback contract with the main process: it says it is
// alive, it hears about a panic main decided on, and it applies the show's device
// settings to the engine. Mounted once, from the top of the app.

import { useEffect } from 'react'
import { audioEngine } from '../engine/audioEngineClient'
import { cueRunner } from '../engine/CueRunner'
import { useStore } from '../store'

/** How often the window says it is alive. Main acts only while the engine is playing. */
const HEARTBEAT_MS = 1000

/**
 * Electron wraps a rejected `invoke` in its own sentence, and the engine's class name
 * rides along behind it. The operator asked for a device setting and the engine refused
 * it; what they need is the engine's reason, not the plumbing that carried it.
 */
function engineReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^AudioEngineError:\s*/, '')
}

export function usePlaybackBridge(): void {
  const audioSettings = useStore(s => s.audioSettings)
  const setAudioDeviceError = useStore(s => s.setAudioDeviceError)

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
  // again whenever the operator changes one. A request the engine will not honour keeps
  // its own words: the engine never downgrades a setting quietly, and neither does this.
  useEffect(() => {
    audioEngine.configure({
      deviceId: audioSettings.outputDeviceId === 'default' ? undefined : audioSettings.outputDeviceId,
      sampleRate: audioSettings.sampleRate,
      channels: audioSettings.channels,
      exclusive: audioSettings.exclusive,
      bufferFrames: audioSettings.bufferFrames
    }).then(
      () => setAudioDeviceError(null),
      error => setAudioDeviceError(engineReason(error))
    )
  }, [audioSettings, setAudioDeviceError])
}
