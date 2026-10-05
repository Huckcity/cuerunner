// Durations exist as soon as a file does.
//
// A cue's `duration` is workspace content and is 0 until something has measured the
// file, so a workspace that has just been loaded carries no lengths at all: the Duration
// cell reads `–`, a group has no length to show, and its timeline blocks are stubs. All
// of that is one fault — nobody has asked about the file — so it is answered in one
// place, before anybody touches a cue.
//
// The measurement is the engine's header-only `probe`: no decode, no cache entry, no
// counters, which is why asking about every file in a show is cheap enough to do on
// load. What it finds is written back through `syncCueDuration`, so every surface that
// reads a cue's length — the row, the group's sum, the timeline, the runner's plan for
// the end of a run — sees the same number.
//
// One file at a time. A show on a network share fills in as it goes rather than asking
// the engine for forty headers at once, and a cue list that changes under the pass —
// another show opened, a file relinked — is simply the next thing it reads.

import { useEffect } from 'react'
import { useStore } from '../store'
import { audioEngine } from '../engine/audioEngineClient'
import { cuesAwaitingLength, mediaLengthsFrom } from '../utils/mediaLength'

/** Refusal codes that say the file cannot be read, as opposed to an engine that is not there. */
function isUnreadable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'decode' || code === 'format-unavailable'
}

/**
 * Measures every audio cue in the show that has no length yet: on load, on import, and
 * after a relink. Mounted once, for the life of the window.
 */
export function useMediaLengths(): void {
  useEffect(() => {
    let cancelled = false
    let working = false
    // Whether the last pass ran the queue dry. While it has, a write to the store that is
    // not about the show's files is not walked for: only a pass that stopped short — an
    // engine that was not there — is retried on whatever happens next.
    let settled = false

    // The show's own store is the queue: take the next cue nobody has measured, ask the
    // engine about its file, write down what the answer is worth, and look again.
    const work = async (): Promise<void> => {
      if (working || cancelled) return
      working = true
      try {
        for (;;) {
          if (cancelled) return
          const state = useStore.getState()
          const [next] = cuesAwaitingLength(
            state.cues,
            mediaLengthsFrom(state.mediaLengths, state.missingMedia)
          )
          if (!next) {
            // Nothing left to ask about: until the show changes there is nothing to look for.
            settled = true
            return
          }

          try {
            const probe = await audioEngine.probe(next.filePath)
            if (cancelled) return
            // The show may have changed while the engine was reading: a length must
            // never be written onto a cue that now names another file.
            if (!stillAwaiting(next.id, next.filePath)) continue
            const measured = Math.max(0, Math.round(probe.durationMs))
            if (measured > 0) state.syncCueDuration(next.id, measured)
            // A container that states no length has answered: there is nothing more to
            // learn, and asking again would be a question with no answer in it.
            else state.setMediaLengths({ [next.id]: { path: next.filePath, state: 'no-length' } })
          } catch (error) {
            if (cancelled) return
            // An engine that was not there is a question not yet asked, and the next
            // session — or the next edit — comes back to it. A file the engine could
            // not open is an answer: this cue has no length to show, and the row says so.
            if (!isUnreadable(error)) return
            if (!stillAwaiting(next.id, next.filePath)) continue
            state.setMediaLengths({ [next.id]: { path: next.filePath, state: 'missing' } })
          }
        }
      } finally {
        working = false
      }
    }

    // Every change to the show wakes the pass: opening a workspace, dropping files on
    // the list, relinking media, or a file answering. A pass already running is left
    // alone — it is working through the same queue — so no file is ever asked twice.
    const wake = (): void => {
      settled = false
      void work()
    }
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.cues !== previous.cues || state.mediaLengths !== previous.mediaLengths ||
        state.missingMedia !== previous.missingMedia) settled = false
      if (!settled) void work()
    })
    // An engine that was replaced has to be asked again: a show that loaded while it
    // was restarting would otherwise read as unmeasured for the night.
    const offSession = audioEngine.onSessionChange(wake)
    void work()

    return () => {
      cancelled = true
      unsubscribe()
      offSession()
    }
  }, [])
}

/** True while the cue is still an audio cue naming the file that was asked about. */
function stillAwaiting(cueId: string, filePath: string): boolean {
  const cue = useStore.getState().cues.find(c => c.id === cueId)
  return cue !== undefined && cue.type === 'audio' && cue.filePath === filePath && cue.duration <= 0
}