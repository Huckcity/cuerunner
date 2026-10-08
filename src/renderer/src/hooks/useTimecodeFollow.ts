import { useEffect } from 'react'
import { cueEngine } from '../engine/CueEngine'
import { TimecodeChase } from '../engine/timecodeChase'
import { setTimecodeSettings, setTimecodeStatus, timecodeStatus } from '../engine/timecodeStatus'
import { useStore } from '../store'
import { isPro } from '../../../shared/license'
import { formatFrames } from '../../../shared/timecode'

/** How often the cue list looks at the clock between pushes, ms: well inside a frame. */
const LOOK_MS = 10

/**
 * Follows the clock main pushes: keeps the status the window draws, and fires the cues the
 * clock reaches — and, with chase on, puts the list where the clock is.
 *
 * The pushes come every 40 ms; the list looks every 10, carrying the clock on from the last
 * push at its own rate, so a cue fires on its frame rather than on the next push after it.
 */
export function useTimecodeFollow(): void {
  useEffect(() => {
    let live = true
    window.cuerunner.timecode.status()
      .then(status => { if (live) setTimecodeStatus(status) })
      .catch(() => {})
    window.cuerunner.timecode.settings()
      .then(settings => { if (live) setTimecodeSettings(settings) })
      .catch(() => {})

    const chase = new TimecodeChase({
      getCues: () => useStore.getState().cues,
      settings: () => useStore.getState().timecode,
      isPro: () => isPro(useStore.getState().license),
      fire: (cue, frames, rate) => {
        // The cause first, so the log reads in the order the show happened.
        useStore.getState().appendLog([{
          level: 'info',
          label: `${cue.number} · ${cue.name}`,
          message: `Triggered by timecode ${formatFrames(frames, rate)}`
        }])
        cueEngine.goById(cue.id)
      },
      chase: (cue, seekMs) => {
        useStore.getState().appendLog([{
          level: 'info',
          label: `${cue.number} · ${cue.name}`,
          message: `Chased timecode to ${(seekMs / 1000).toFixed(1)} s in`
        }])
        cueEngine.adoptCue(cue.id, seekMs)
      },
      stop: cueId => cueEngine.stop(cueId),
      isRunning: cueId => useStore.getState().running.has(cueId),
      log: message => useStore.getState().appendLog([{ level: 'info', message }])
    })

    const off = window.cuerunner.timecode.onEvents(status => {
      setTimecodeStatus(status)
      chase.update(status.receiver, Date.now())
    })
    const look = setInterval(() => {
      const receiver = timecodeStatus().receiver
      if (receiver.state === 'locked' || receiver.state === 'freewheel') chase.update(receiver, Date.now())
    }, LOOK_MS)

    return () => {
      live = false
      off()
      clearInterval(look)
    }
  }, [])

  // How the open show follows the clock is the show's, and main reads the stream with it:
  // its rate, its hold and its offset go over whenever a show is opened or they are edited.
  const show = useStore(s => s.timecode)
  useEffect(() => {
    window.cuerunner.timecode.show(show).catch(error => {
      useStore.getState().appendLog([{
        level: 'error',
        message: `Could not apply the show’s timecode settings: ${error instanceof Error ? error.message : String(error)}`
      }])
    })
  }, [show])
}
