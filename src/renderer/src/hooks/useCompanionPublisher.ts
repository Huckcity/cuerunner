import { useEffect } from 'react'
import { useStore } from '../store'
import { scriptLines } from '../utils/scriptDocument'
import type { CompanionCue, CompanionState } from '../types/show'
import type { Cue } from '../types/cue'

/** The shape the tablet is served, minus the timestamp that makes each publish unique. */
type CompanionBody = Omit<CompanionState, 'at'>

function toCompanionCue(cue: Cue): CompanionCue {
  return {
    id: cue.id,
    number: cue.number,
    name: cue.name,
    type: cue.type,
    parentId: cue.parentId,
    scriptLine: cue.scriptLine ?? null
  }
}

/**
 * Keeps the tablet's view of the show current.
 *
 * The renderer owns the cue list, so it is the renderer that publishes: one message
 * whenever anything the tablet can see has changed, and nothing at all while it has
 * not. A duplicate is never sent, because a tablet on a music stand redrawing the same
 * page twenty times a second is a battery and a distraction both.
 */
export function useCompanionPublisher(): void {
  const enabled = useStore(s => s.showSettings.companion.enabled)
  const scriptPath = useStore(s => s.showSettings.script.path)
  // Turning the companion on is itself a settings change, and a settings change restarts
  // the service — which drops whatever it had. Following the service's state means the
  // show is published again the moment it is listening, rather than waiting for the
  // operator to touch something.
  const serviceState = useStore(
    s => s.showServices.find(service => service.id === 'companion')?.state ?? 'stopped'
  )

  useEffect(() => {
    if (!enabled) return

    let lines: string[] | null = null
    let cancelled = false
    let lastSent = ''

    // The tablet shows the script whether or not the operator has the panel open, so
    // the publisher loads the document too: one small file, read when the path changes.
    const loadScript = async (): Promise<void> => {
      if (!scriptPath) {
        lines = null
        publish()
        return
      }
      try {
        const file = await window.winslab.script.readFile(
          scriptPath,
          useStore.getState().workspacePath
        )
        if (cancelled) return
        lines = scriptLines(file.code)
      } catch {
        // A script that cannot be read leaves the tablet without one; the rest of the
        // show is still worth serving.
        lines = null
      }
      publish()
    }

    const build = (): CompanionBody => {
      const state = useStore.getState()
      const selected = state.cues.find(cue => cue.id === state.selectedId) ?? null
      return {
        workspaceName: state.workspaceName,
        nextCue: selected ? toCompanionCue(selected) : null,
        running: [...state.running.values()].map(entry => {
          const cue = state.cues.find(candidate => candidate.id === entry.cueId)
          return {
            id: entry.cueId,
            number: cue?.number ?? '',
            name: cue?.name ?? '',
            state: entry.state
          }
        }),
        cues: state.cues.map(toCompanionCue),
        script: scriptPath && lines ? { path: scriptPath, lines } : null,
        alerts: state.showAlerts.map(alert => ({
          id: alert.id,
          level: alert.level,
          message: alert.message
        }))
      }
    }

    const publish = (): void => {
      const body = build()
      const serialized = JSON.stringify(body)
      if (serialized === lastSent) return
      lastSent = serialized
      window.winslab.show
        .command('companion', 'publish', { ...body, at: Date.now() })
        // A companion that cannot be updated is not worth a notice during a show: the
        // service's own state is where the operator reads that it is not serving.
        .catch(() => {})
    }

    const unsubscribe = useStore.subscribe(publish)
    void loadScript()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [enabled, scriptPath, serviceState])
}
