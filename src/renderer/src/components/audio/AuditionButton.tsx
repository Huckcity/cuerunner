import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { Cue } from '../../../../shared/cue'
import { audition, type AuditionState } from '../../engine/audition'
import './AudioIo.css'

/** The audition's state, kept current. */
export function useAudition(): AuditionState {
  const [state, setState] = useState(audition.current())
  useEffect(() => audition.subscribe(setState), [])
  return state
}

interface Props {
  /** The cue to audition, or none for a file. */
  cue?: Cue
  /** A file to audition whole, from its start. */
  filePath?: string
  label?: string
  className?: string
}

/**
 * Plays a cue — or a whole file — on the show's audition output, and stops it. It never
 * touches the show: no row lights, nothing moves on, and the audition output is the only
 * place it is heard.
 */
export function AuditionButton({ cue, filePath, label = 'Audition', className = '' }: Props) {
  const state = useAudition()
  const playing = state.playing !== null
  const start = (): void => {
    const settings = useStore.getState().audioSettings
    if (cue) audition.playCues([cue], settings)
    else if (filePath) audition.playFile(filePath, settings)
  }
  return (
    <>
      <button
        className={`inspector-btn audition-btn ${className}`.trim()}
        aria-pressed={playing}
        disabled={!playing && !cue && !filePath}
        onClick={() => (playing ? audition.stop() : start())}
        title={playing ? 'Stop the audition' : 'Hear it on the audition output, without firing the show'}
      >
        {playing ? 'Stop audition' : label}
      </button>
      {state.refusal !== null && !playing && <span className="audition-status" role="status">{state.refusal}</span>}
    </>
  )
}
