import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { GroupingNoteDialog } from './GroupingNoteDialog'

/**
 * Says the show's cue grouping was repaired as it loaded — children gathered behind
 * their group, a cue whose group was not in the file returned to the top level, a loop
 * of groups dissolved — with the list of each repair behind it. The repair lives in this
 * session only: loading never writes the file, so the bar stands until a save writes the
 * repaired grouping, which is what clears it.
 */
export function GroupingNoteBar() {
  const notes = useStore(s => s.loadNotes)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    // A load replaces what the list was showing. Close on any new notes array, not only
    // on an empty one: a second damaged show must not leave the first one's rows up over
    // the new show.
    setReviewing(false)
  }, [notes])

  if (notes.length === 0) return null

  return (
    <>
      <div className="grouping-note-bar" role="alert" data-count={notes.length}>
        <span className="grouping-note-bar-text">
          {`The cue grouping in this show was repaired on load (${notes.length} ${
            notes.length === 1 ? 'change' : 'changes'
          }).`}
        </span>
        <div className="grouping-note-bar-actions">
          <button className="grouping-note-review" onClick={() => setReviewing(true)}>
            What changed…
          </button>
        </div>
      </div>
      {reviewing && <GroupingNoteDialog onClose={() => setReviewing(false)} />}
    </>
  )
}
