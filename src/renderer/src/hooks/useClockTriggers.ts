import { useEffect } from 'react'
import { cueEngine } from '../engine/CueEngine'
import { ClockTriggerWatcher, ON_TIME_MS } from '../engine/clockTriggers'
import { useStore } from '../store'
import { formatClock } from '../utils/cueDefaults'

/** How often the watcher asks the clock what has gone by, ms. */
const CHECK_MS = 1000

/**
 * The clock this window reads. An end-to-end spec cannot wait for half past seven, so a test
 * hands in its own through `window.__cuerunnerClock`; nothing else sets it.
 */
function now(): number {
  const injected = (window as unknown as { __cuerunnerClock?: () => number }).__cuerunnerClock
  return typeof injected === 'function' ? injected() : Date.now()
}

/**
 * Fires the cues whose time of day has come, and says which ones the show missed.
 *
 * The watcher is opened when a show is loaded — a new show's times are its own, and the hour
 * before it was opened is what it looks back over — and asked once a second. A fire goes through
 * the runner as any trigger's does; a time that went by unseen is written to the log with what
 * its policy did about it.
 */
export function useClockTriggers(): void {
  const workspaceId = useStore(s => s.workspaceId)
  useEffect(() => {
    const watcher = new ClockTriggerWatcher()
    watcher.open(now())
    const tick = (): void => {
      const store = useStore.getState()
      for (const decision of watcher.check(store.cues, now())) {
        const cue = store.cues.find(candidate => candidate.id === decision.cueId)
        if (!cue) continue
        const label = `${cue.number} · ${cue.name}`
        const time = formatClock(decision.at)
        if (decision.kind === 'missed') {
          store.appendLog([{
            level: 'error',
            label,
            message: `missed its ${time} time while the show was closed or the machine asleep — not fired`
          }])
          continue
        }
        store.appendLog([{
          level: 'info',
          label,
          message: decision.lateMs > ON_TIME_MS
            ? `Triggered late by the clock: ${time} went by while the show was closed or the machine asleep`
            : `Triggered by the clock at ${time}`
        }])
        cueEngine.goById(cue.id)
      }
    }
    tick()
    const timer = setInterval(tick, CHECK_MS)
    return () => {
      clearInterval(timer)
      watcher.close()
    }
  }, [workspaceId])
}
