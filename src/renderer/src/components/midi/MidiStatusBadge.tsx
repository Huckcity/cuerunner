import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import './MidiStatusBadge.css'

/**
 * Says when this build has no MIDI at all.
 *
 * `midi` is an optional native dependency: it needs build tools, and a machine that
 * cannot build it still runs the show. What it cannot do is send or listen to MIDI —
 * and that used to be invisible, because a cue that reached nothing looked exactly like
 * one that worked. The badge appears only when the answer is bad, and the element itself
 * is always in the tree so the row it sits in does not change height when the answer
 * arrives.
 */
export default function MidiStatusBadge() {
  const [error, setError] = useState<string | null>(null)
  const openSettings = useStore(s => s.openSettings)

  useEffect(() => {
    let live = true
    window.winslab.midi.status()
      .then(status => {
        if (live) setError(status.available ? null : status.error ?? 'MIDI is unavailable')
      })
      // A status that cannot be read is not proof that MIDI works.
      .catch(() => {
        if (live) setError('MIDI could not be checked')
      })
    return () => { live = false }
  }, [])

  const unavailable = error !== null

  return (
    <button
      className="midi-status"
      data-state={unavailable ? 'unavailable' : 'ok'}
      aria-hidden={!unavailable}
      tabIndex={unavailable ? 0 : -1}
      title={unavailable ? `${error} — open Settings, MIDI` : undefined}
      onClick={() => { if (unavailable) openSettings('midi') }}
    >
      {unavailable ? 'MIDI unavailable' : null}
    </button>
  )
}
