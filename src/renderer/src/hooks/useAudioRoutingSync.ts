import { useEffect } from 'react'
import { useStore } from '../store'
import { audioEngine } from '../engine/audioEngineClient'
import { syncAudioRouting } from '../engine/audioRouting'

/**
 * Keeps the engine's patches and output faders where the show says they are: on every change
 * to the show's audio settings, and in full to an engine that has replaced the last one — so
 * a crash mid-show does not leave the new engine playing every cue on raw device channels.
 */
export function useAudioRoutingSync(): void {
  const settings = useStore(s => s.audioSettings)
  useEffect(() => {
    void syncAudioRouting(settings)
  }, [settings])
  useEffect(() => audioEngine.onSessionChange(() => {
    void syncAudioRouting(useStore.getState().audioSettings, true)
  }), [])
}
