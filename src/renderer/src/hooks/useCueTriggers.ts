import { useEffect } from 'react'
import { cueRunner } from '../engine/CueRunner'
import { describeTriggerSource, triggeredCues } from '../engine/triggers'
import { useStore, usePro } from '../store'

/**
 * Fires the cues that answer to what the show sends back.
 *
 * This sits beside the cue stack rather than inside it: the events are the ones the
 * monitor shows, and a triggered cue goes through the same runner as GO, so it
 * pre-waits, advances and stops exactly like one the operator fired by hand. Nothing
 * here can interrupt a cue that is already running.
 *
 * The events only exist while the show services are licensed and listening, so with no
 * key there is nothing to do here.
 */
export function useCueTriggers(): void {
  const pro = usePro()

  useEffect(() => {
    if (!pro) return
    return window.winslab.show.onEvents(events => {
      for (const event of events) {
        if (event.kind !== 'osc' && event.kind !== 'midi') continue

        // Read the cue list per event rather than per batch: a trigger that fires a cue
        // which is itself edited by that run should be matched against what is there.
        const store = useStore.getState()
        for (const cue of triggeredCues(store.cues, event)) {
          // The cause is written before the run, so the log reads in the order the show
          // happened — and so a cue that then fails has its reason above it.
          store.appendLog([{
            level: 'info',
            label: `${cue.number} · ${cue.name}`,
            message: `Triggered by ${describeTriggerSource(event)}`
          }])
          cueRunner.goById(cue.id)
        }
      }
    })
  }, [pro])
}
