import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { formatClock } from '../../utils/cueDefaults'
import './LogPanel.css'

// How close to the bottom counts as "following the log". Scrolling further up
// releases the pin so new entries stop yanking the view.
const PIN_THRESHOLD_PX = 24

interface Props {
  onClose: () => void
}

export function LogPanel({ onClose }: Props) {
  const log = useStore(s => s.log)
  const clearLog = useStore(s => s.clearLog)

  const listRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    const el = listRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [log])

  const handleScroll = (): void => {
    const el = listRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX
  }

  return (
    <div className="log-panel">
      <div className="log-header">
        <span className="log-title">Log</span>
        <span className="log-count">{log.length === 0 ? 'empty' : `${log.length} ${log.length === 1 ? 'entry' : 'entries'}`}</span>
        <div className="log-actions">
          <button className="log-btn" onClick={clearLog} disabled={log.length === 0}>
            Clear
          </button>
          <button className="log-btn" onClick={onClose} title="Hide log">
            ✕
          </button>
        </div>
      </div>
      <div className="log-list" ref={listRef} onScroll={handleScroll}>
        {log.length === 0 ? (
          <div className="log-empty">
            Nothing yet. Run a cue to see what it did.
          </div>
        ) : (
          log.map(entry => (
            <div key={entry.id} className="log-row" data-level={entry.level}>
              <span className="log-time">{formatClock(entry.at)}</span>
              <span className="log-label">{entry.label ?? ''}</span>
              <span className="log-message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
