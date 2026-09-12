import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { MissingMediaDialog } from './MissingMediaDialog'

/**
 * Says what the loaded workspace cannot find, and offers the one action that fixes it.
 * It stays on screen while anything is missing — a cue that will play silence is not
 * something the operator should have to remember — and clears itself once every file
 * has been relinked.
 */
export function MissingMediaBar() {
  const missing = useStore(s => s.missingMedia)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    // The pick that clears the last file also closes the dialog listing it.
    if (missing.length === 0) setReviewing(false)
  }, [missing.length])

  if (missing.length === 0) return null

  return (
    <>
      <div className="missing-media-bar" role="alert" data-count={missing.length}>
        <span className="missing-media-bar-text">
          {missing.length === 1
            ? 'One audio file this workspace names cannot be found.'
            : `${missing.length} audio files this workspace names cannot be found.`}
        </span>
        <div className="missing-media-bar-actions">
          <button className="missing-media-bar-review" onClick={() => setReviewing(true)}>
            Review files…
          </button>
        </div>
      </div>
      {reviewing && <MissingMediaDialog onClose={() => setReviewing(false)} />}
    </>
  )
}
