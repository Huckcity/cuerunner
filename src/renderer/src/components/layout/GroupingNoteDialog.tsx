import { useEffect } from 'react'
import { useStore } from '../../store'
import { useModal } from '../../hooks/useModal'
import './GroupingNote.css'

interface Props {
  onClose: () => void
}

/**
 * The list behind the grouping bar: each repair against the cue it was about, in the
 * order the load found it. The file on disk is unchanged until a save writes the
 * repaired grouping, and the blurb says so — otherwise the operator looks for the repair
 * in the file and finds the damage still there.
 */
export function GroupingNoteDialog({ onClose }: Props) {
  useModal()
  const notes = useStore(s => s.loadNotes)
  const cues = useStore(s => s.cues)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="grouping-note-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="grouping-note-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Repaired grouping"
      >
        <div className="grouping-note-header">
          <span className="grouping-note-title">Repaired grouping</span>
          <button
            className="grouping-note-dismiss"
            onClick={onClose}
            aria-label="Dismiss repaired grouping"
          >✕</button>
        </div>
        <p className="grouping-note-blurb">
          The grouping was repaired as the show opened. The file on disk is unchanged —
          saving writes the repair into it.
        </p>
        <ul className="grouping-note-list">
          {notes.map((note, index) => {
            const cue = cues.find(candidate => candidate.id === note.cueId)
            return (
              <li key={index} className="grouping-note-row">
                <div className="grouping-note-cue">
                  {cue ? `${cue.number} ${cue.name}` : note.cueId}
                </div>
                <div className="grouping-note-detail">{note.detail}</div>
              </li>
            )
          })}
        </ul>
        <div className="grouping-note-footer">
          <button className="grouping-note-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
