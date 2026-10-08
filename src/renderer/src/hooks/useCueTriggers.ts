import { useEffect } from 'react'
import { cueEngine } from '../engine/CueEngine'
import { describeTriggerSource, triggeredCues } from '../engine/triggers'
import { firingIdentity, noteKey } from '../engine/inputGuard'
import { runRemote } from '../engine/oscRemote'
import { parseRemote, remoteEnabled } from '../../../shared/oscRemote'
import { useStore } from '../store'

/**
 * Fires the cues that answer to what the show sends back.
 *
 * This sits beside the cue stack rather than inside it: the events are the ones the
 * monitor shows, and a triggered cue goes through the same runner as GO, so it
 * pre-waits, advances and stops exactly like one the operator fired by hand.
 *
 * What reaches the runner first is the guard, not the cue: a desk that sends the same
 * message twice is one firing, and a note held down is one firing however many times it
 * repeats. Both are properties of the surface the message came in on, so they are
 * settled before anything looks for a cue to fire.
 *
 * The events come from the show's own inputs — OSC and MIDI, which are the free half of
 * the app — so this listens on every machine, and a key only adds the services that
 * publish more (the desk link, the radios, the network).
 */
export function useCueTriggers(): void {
  useEffect(() => {
    return window.cuerunner.show.onEvents(events => {
      for (const event of events) {
        if (event.kind !== 'osc' && event.kind !== 'midi') continue

        // A note coming up is a release, and a release is never gated — it is what makes
        // the next press of that note a press rather than a repeat.
        const note = noteKey(event)
        if (note !== null && event.kind === 'midi' && event.message.kind === 'noteOff') {
          cueEngine.releaseNote(note)
          // A note-off is not a trigger in any case: nothing below can match it.
          continue
        }

        const firing = firingIdentity(event)
        if (!firing || !cueEngine.acceptsFire(firing.surface, firing.key)) continue

        // The press is remembered only once it has been allowed: a note that was refused
        // never started anything, so nothing should be waiting for it to come up.
        if (note !== null) cueEngine.pressNote(note)

        // Read the cue list per event rather than per batch: a trigger that fires a cue
        // which is itself edited by that run should be matched against what is there.
        const store = useStore.getState()
        const triggered = triggeredCues(store.cues, event)
        // An address a cue's own trigger answers is the operator's, written for that cue; the
        // remote namespace is only what is left. So a show that wired `/go` to one cue keeps it.
        if (event.kind === 'osc' && triggered.length === 0 && remoteEnabled(store.showSettings.oscIn)) {
          const command = parseRemote(event.address, event.args)
          if (command !== null) runRemote(command, remoteDeps(), `OSC ${event.address} from ${event.from}`)
          continue
        }
        for (const cue of triggered) {
          // The cause is written before the run, so the log reads in the order the show
          // happened — and so a cue that then fails has its reason above it.
          store.appendLog([{
            level: 'info',
            label: `${cue.number} · ${cue.name}`,
            message: `Triggered by ${describeTriggerSource(event)}`
          }])
          cueEngine.goById(cue.id)
        }
      }
    })
  }, [])
}

/** The window's half of the remote: the runner, the store and the log. */
function remoteDeps() {
  const store = useStore.getState()
  return {
    getCues: () => useStore.getState().cues,
    getSelected: () => useStore.getState().selectedId,
    getCollapsed: () => useStore.getState().collapsedGroupIds,
    select: store.select,
    go: () => cueEngine.go(),
    stop: (cueId?: string) => cueEngine.stop(cueId),
    goById: (cueId: string) => cueEngine.goById(cueId),
    seekCue: (cueId: string, positionMs: number) => cueEngine.seekCue(cueId, positionMs),
    pauseAll: () => cueEngine.pauseAll(),
    resumeAll: () => cueEngine.resumeAll(),
    togglePause: () => cueEngine.togglePause(),
    pauseCue: (cueId: string) => cueEngine.pauseCue(cueId),
    resumeCue: (cueId: string) => cueEngine.resumeCue(cueId),
    togglePauseCue: (cueId: string) => cueEngine.togglePauseCue(cueId),
    log: (entry: Parameters<typeof store.appendLog>[0][number]) => useStore.getState().appendLog([entry])
  }
}
