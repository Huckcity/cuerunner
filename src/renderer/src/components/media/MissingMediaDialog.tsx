import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { relinkMissingMedia } from '../../hooks/useWorkspace'
import './MissingMedia.css'

interface Props {
  onClose: () => void
}

/**
 * The list behind the missing-media bar: which cue wants which file, where the file was
 * last seen, and a picker per row. Locating the first file is also the bulk action —
 * the main process carries the move over to every other file it accounts for — so a
 * show folder that was copied without its media is one pick to repair, not one per cue.
 */
export function MissingMediaDialog({ onClose }: Props) {
  const missing = useStore(s => s.missingMedia)
  const cues = useStore(s => s.cues)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const locate = async (cueId: string): Promise<void> => {
    // A second picker cannot be opened over the first, and the list it returns to may
    // no longer contain the row that started it.
    if (locating) return
    setLocating(true)
    try {
      await relinkMissingMedia(cueId)
    } finally {
      setLocating(false)
    }
  }

  return (
    <div
      className="missing-media-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="missing-media-dialog" role="dialog" aria-modal="true" aria-label="Missing media">
        <div className="missing-media-header">
          <span className="missing-media-title">Missing media</span>
          <button className="missing-media-dismiss" onClick={onClose} aria-label="Dismiss missing media">✕</button>
        </div>
        <p className="missing-media-blurb">
          These files are not where the workspace left them. Choosing one file puts the
          rest of that folder back with it; anything still missing keeps its last known
          location until it is found.
        </p>
        <ul className="missing-media-list">
          {missing.map(entry => {
            const cue = cues.find(c => c.id === entry.cueId)
            return (
              <li key={entry.cueId} className="missing-media-row">
                <div className="missing-media-cue">
                  {cue ? `${cue.number} ${cue.name}` : entry.cueId}
                </div>
                <div className="missing-media-path" title={entry.originalPath}>{entry.path}</div>
                <button
                  className="missing-media-locate"
                  disabled={locating}
                  onClick={() => void locate(entry.cueId)}
                >
                  Locate…
                </button>
              </li>
            )
          })}
        </ul>
        <div className="missing-media-footer">
          <button
            className="missing-media-locate-all"
            disabled={locating}
            onClick={() => void locate(missing[0].cueId)}
          >
            Locate files…
          </button>
          <button className="missing-media-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
