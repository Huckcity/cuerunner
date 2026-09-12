import { useEffect } from 'react'
import { useStore, usePro } from '../store'
import type { ShowEvent, ShowSnapshot } from '../types/show'

/**
 * Connects the renderer to the show services running in the main process.
 *
 * Three things have to line up, and the order matters. The subscription goes on first,
 * so nothing that happens while the snapshot is in flight is dropped. The snapshot then
 * replaces state wholesale — it is the world as it is now, not a history of it. Finally
 * the batches that arrived in between are replayed on top, minus anything the snapshot
 * already contains, which is why the snapshot carries the time it was taken.
 *
 * The services are part of WinsLab Pro, so this does nothing until the machine is
 * licensed. A key entered while the window is open turns the effect back on, which is
 * what starts the listeners the operator had configured.
 */
export function useShowBridge(): void {
  const settings = useStore(s => s.showSettings)
  const pro = usePro()

  useEffect(() => {
    if (!pro) return
    let live = true
    const pending: ShowEvent[][] = []
    let ready = false

    const off = window.winslab.show.onEvents(events => {
      if (!ready) {
        pending.push(events)
        return
      }
      useStore.getState().applyShowEvents(events)
    })

    const apply = (snapshot: ShowSnapshot): void => {
      useStore.getState().setShowSnapshot(snapshot)
      ready = true
      for (const batch of pending) {
        const fresh = batch.filter(event => event.at > snapshot.at)
        if (fresh.length > 0) useStore.getState().applyShowEvents(fresh)
      }
      pending.length = 0
    }

    window.winslab.show.snapshot()
      .then(snapshot => {
        if (live) apply(snapshot)
      })
      .catch(error => {
        // Without the snapshot the panels stay empty, but live events still arrive:
        // a monitor with no history is worth more than none at all.
        ready = true
        useStore.getState().appendLog([
          { level: 'error', message: `Could not read the show state: ${describe(error)}` }
        ])
      })

    return () => {
      live = false
      off()
    }
  }, [pro])

  useEffect(() => {
    // A settings change means a listener has to move: a new port, a different MIDI
    // input, or the service being turned off. The main process compares what it has
    // and only restarts what actually changed.
    if (!pro) return
    window.winslab.show.configure(settings).catch(error => {
      useStore.getState().appendLog([
        { level: 'error', message: `Could not apply the show settings: ${describe(error)}` }
      ])
    })
  }, [settings, pro])
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
