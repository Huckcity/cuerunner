// What the engine says about itself, refreshed on a slow poll. The settings dialog and
// the waveform header both read it, and neither asks for media: the numbers are
// counters and pressure figures the engine already holds.

import { useEffect, useState } from 'react'
import { audioEngine } from '../engine/audioEngineClient'
import type { AudioEngineInfo } from '../engine/audioEngineClient'

/** Slow enough to be free, quick enough that a warning appears while it still matters. */
const INFO_POLL_MS = 4000

/**
 * Every panel reading the engine at this moment. A configure reply is a reading about
 * the engine, not about the component that asked for it: a panel that sends the show's
 * settings publishes what came back here, so the readout and the warnings bar on the
 * same screen cannot disagree about the device both of them describe.
 */
const readers = new Set<(reading: AudioEngineInfo) => void>()

export interface AudioEngineStatus {
  info: AudioEngineInfo | null
  /** False once the engine could not be reached at all. */
  available: boolean
  /**
   * Takes a fresh reading — the reply to a configure the operator just asked for —
   * without waiting for the next poll. A panel that has just sent the show's settings
   * shows the engine as it is now, rather than the reading from before the request.
   */
  accept: (reading: AudioEngineInfo) => void
}

export function useAudioEngineInfo(): AudioEngineStatus {
  const [info, setInfo] = useState<AudioEngineInfo | null>(null)
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    const reader = (reading: AudioEngineInfo): void => {
      setInfo(reading)
      setAvailable(true)
    }
    readers.add(reader)
    return () => {
      readers.delete(reader)
    }
  }, [])

  const accept = (reading: AudioEngineInfo): void => {
    // Over a copy: a panel that unmounts on the reading it was just handed must not
    // take the rest of the round with it.
    for (const reader of [...readers]) reader(reading)
  }

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

  return { info, available, accept }
}
