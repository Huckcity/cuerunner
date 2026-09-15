// Where the silence at the edges of a file is measured, before anything plays it.
//
// Playback must not wait for a scan — a pass over a whole file is exactly the kind of
// reading a GO cannot be held on — so a cue's audible extent is written down ahead of
// time and the runner reads it when it fires. This is that pass: greedy, one file at a
// time, over every audio cue playing with the trim on whose file nobody has measured.
//
// The queue is the show's own store, the way the length pass works: each change wakes
// the pass, and a pass already running is left alone — it is working through the same
// queue. A file the engine refuses is written down as refused, keyed by path, because a
// scan that cannot answer would otherwise be asked again on every keystroke.

import { useEffect } from 'react'
import { useStore } from '../store'
import { audioEngine } from '../engine/audioEngineClient'
import { cuesAwaitingSilence } from '../utils/silenceTrim'

/** Refusal codes that say the file cannot be read, as opposed to an engine that is not there. */
function isUnreadable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'decode' || code === 'format-unavailable'
}

/**
 * Measures the audible extent of every audio cue that plays with the silence trim on:
 * on load, on import, on a toggle, and after a relink. Mounted once, for the life of the
 * window.
 */
export function useSilenceTrim(): void {
  useEffect(() => {
    let cancelled = false
    let working = false

    const work = async (): Promise<void> => {
      if (working || cancelled) return
      working = true
      try {
        for (;;) {
          if (cancelled) return
          const state = useStore.getState()
          // The trim is part of WinsLab Pro, and this scan is what turns it on: a machine
          // that may not apply it is not asked to read the show's files for it.
          if (state.license.state !== 'active') return
          const [next] = cuesAwaitingSilence(state.cues, state.silenceFailures)
          if (!next) return

          try {
            const silence = await audioEngine.silence(next.filePath)
            if (cancelled) return
            // The show may have changed while the engine was reading: a measurement must
            // never be written onto a cue that now names another file, or has had the
            // trim turned off under it.
            if (!stillTrimming(next.id, next.filePath)) continue
            state.syncCueSilence(next.id, {
              startMs: silence.startMs,
              endMs: silence.endMs,
              durationMs: silence.durationMs,
              silent: silence.silent
            })
          } catch (error) {
            if (cancelled) return
            // An engine that was not there is a question not yet asked, and the next
            // session — or the next edit — comes back to it. A file the engine could not
            // read is an answer: this cue plays its whole region, and the panel says why.
            if (!isUnreadable(error)) return
            if (!stillTrimming(next.id, next.filePath)) continue
            state.setSilenceFailure(next.id, next.filePath)
          }
        }
      } finally {
        working = false
      }
    }

    const wake = (): void => { void work() }
    const unsubscribe = useStore.subscribe(wake)
    // An engine that was replaced has to be asked again: a show that loaded while it was
    // restarting would otherwise stay unmeasured for the night.
    const offSession = audioEngine.onSessionChange(wake)
    void work()

    return () => {
      cancelled = true
      unsubscribe()
      offSession()
    }
  }, [])
}

/** True while the cue is still an audio cue trimming the file that was asked about. */
function stillTrimming(cueId: string, filePath: string): boolean {
  const cue = useStore.getState().cues.find(c => c.id === cueId)
  return cue !== undefined && cue.type === 'audio' && cue.trimSilence === true &&
    cue.filePath === filePath && cue.soundRegion == null
}
