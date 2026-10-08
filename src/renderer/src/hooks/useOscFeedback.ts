import { useEffect } from 'react'
import { subscribeToParts, useStore } from '../store'
import { audioEngine } from '../engine/audioEngineClient'
import { buildFeedbackSnapshot } from '../utils/oscFeedbackSnapshot'

/** The soonest a change is published after the last publish, ms: a burst of edits is one. */
const COALESCE_MS = 100
/** How often a show with something running is published anyway, ms: main carries progress on between. */
const RESYNC_MS = 1000

/**
 * Keeps main's copy of the show current for the OSC feedback: what a remote is told, and what
 * a QLab-style query is answered from.
 *
 * The window owns the cue list and the clocks, so the window publishes — when the playhead,
 * the list or what is running changes, coalesced, and once a second while anything runs, so a
 * seek or a held cue reaches the remotes. Between those, main carries a playing cue's progress
 * on by itself, so the remotes' gauges move at the show's rate without the window publishing at
 * it. Nothing is published while the show is not listening for OSC: there is no socket to
 * answer on.
 */
export function useOscFeedback(): void {
  const listening = useStore(s => s.showSettings.oscIn.enabled)
  const serviceState = useStore(s => s.showServices.find(service => service.id === 'osc-in')?.state ?? 'stopped')

  useEffect(() => {
    if (!listening || serviceState !== 'running') return
    let lastPublish = 0
    let timer: number | undefined
    let cancelled = false

    const publish = (): void => {
      timer = undefined
      if (cancelled) return
      lastPublish = Date.now()
      const state = useStore.getState()
      const snapshot = buildFeedbackSnapshot(state, Date.now(), cueId => audioEngine.getProgress(cueId))
      void window.cuerunner.show.command('osc-in', 'feedback', snapshot).catch(() => {
        // A service that is restarting has nobody to answer yet; the next change publishes again.
      })
    }

    const schedule = (): void => {
      if (timer !== undefined) return
      timer = window.setTimeout(publish, Math.max(0, lastPublish + COALESCE_MS - Date.now()))
    }

    publish()
    const unsubscribe = subscribeToParts(
      s => [s.cues, s.selectedId, s.running, s.workspaceName, s.workspaceId],
      schedule
    )
    const resync = window.setInterval(() => {
      if (useStore.getState().running.size > 0) schedule()
    }, RESYNC_MS)

    return () => {
      cancelled = true
      unsubscribe()
      window.clearInterval(resync)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [listening, serviceState])
}
