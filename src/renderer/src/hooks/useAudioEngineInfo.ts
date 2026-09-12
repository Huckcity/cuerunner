// What the engine says about itself, refreshed on a slow poll. The settings dialog and
// the waveform header both read it, and neither asks for media: the numbers are
// counters and pressure figures the engine already holds.

import { useEffect, useState } from 'react'
import { audioEngine } from '../engine/audioEngineClient'
import type { AudioEngineInfo } from '../engine/audioEngineClient'

/** Slow enough to be free, quick enough that a warning appears while it still matters. */
const INFO_POLL_MS = 4000

export interface AudioEngineStatus {
  info: AudioEngineInfo | null
  /** False once the engine could not be reached at all. */
  available: boolean
}

export function useAudioEngineInfo(): AudioEngineStatus {
  const [info, setInfo] = useState<AudioEngineInfo | null>(null)
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    let current = true
    const load = (): void => {
      audioEngine.info()
        .then(next => {
          if (!current) return
          setInfo(next)
          setAvailable(true)
        })
        .catch(() => {
          if (current) setAvailable(false)
        })
    }
    load()
    const timer = setInterval(load, INFO_POLL_MS)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [])

  return { info, available }
}
