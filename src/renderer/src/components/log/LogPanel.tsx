import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, usePro, type LogEntry } from '../../store'
import { formatClock } from '../../utils/cueDefaults'
import { describeEvent } from '../monitor/MonitorPanel'
import type { ShowEvent } from '../../types/show'
import './LogPanel.css'

// How close to the bottom counts as "following the log". Scrolling further up
// releases the pin so new entries stop yanking the view.
const PIN_THRESHOLD_PX = 24

/** What the log is showing: everything, what the cues did, or what the show sent in. */
export type LogFilter = 'all' | 'cues' | 'show'

type Row =
  | { kind: 'entry'; at: number; key: string; entry: LogEntry }
  | { kind: 'event'; at: number; key: string; event: ShowEvent }

/**
 * One history for the session: the cues' own lines and what came in from the show,
 * newest last. Alerts are already written into the log as entries when they are raised,
 * so the show's copy of them is left out rather than said twice; a service starting and
 * stopping is the monitor's to show as a state, and one that fails raises an alert.
 */
export function logRows(log: LogEntry[], events: ShowEvent[], filter: LogFilter): Row[] {
  const entries: Row[] = filter === 'show'
    ? []
    : log.map(entry => ({ kind: 'entry', at: entry.at, key: `log-${entry.id}`, entry }))
  const incoming: Row[] = filter === 'cues'
    ? []
    : events
        .filter(event => event.kind !== 'alert' && event.kind !== 'service')
        .map((event, index) => ({ kind: 'event', at: event.at, key: `event-${event.at}-${index}`, event }))
  // A stable sort keeps each source's own order among lines stamped the same moment.
  return [...entries, ...incoming].sort((a, b) => a.at - b.at)
}

interface Props {
  onClose: () => void
}

export function LogPanel({ onClose }: Props) {
  const log = useStore(s => s.log)
  const events = useStore(s => s.showEvents)
  const clearLog = useStore(s => s.clearLog)
  const clearShowEvents = useStore(s => s.clearShowEvents)
  const pro = usePro()
  const [filter, setFilter] = useState<LogFilter>('all')

  const rows = useMemo(() => logRows(log, events, filter), [log, events, filter])

  const listRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    const el = listRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [rows])

  const handleScroll = (): void => {
    const el = listRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX
  }

  const clear = (): void => {
    clearLog()
    clearShowEvents()
  }

  return (
    <div className="log-panel">
      <div className="log-header">
        <span className="log-title">Log</span>
        <span className="log-count">{rows.length === 0 ? 'empty' : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}</span>
        {/* The show only sends anything in on a licensed machine; without it there is
            one source, and nothing to filter. */}
        {pro && (
          <div className="log-filters" role="group" aria-label="Show in the log">
            {([['all', 'All'], ['cues', 'Cues'], ['show', 'Show in']] as const).map(([id, label]) => (
              <button
                key={id}
                className="log-filter"
                data-filter={id}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="log-actions">
          <button className="log-btn" onClick={clear} disabled={log.length === 0 && events.length === 0}>
            Clear
          </button>
          <button className="log-btn" onClick={onClose} title="Hide log">
            ✕
          </button>
        </div>
      </div>
      <div className="log-list" ref={listRef} onScroll={handleScroll}>
        {rows.length === 0 ? (
          <div className="log-empty">
            {filter === 'show' ? 'Nothing has come in from the show yet.' : 'Nothing yet. Run a cue to see what it did.'}
          </div>
        ) : (
          rows.map(row => row.kind === 'entry' ? (
            <div key={row.key} className="log-row" data-level={row.entry.level}>
              <span className="log-time">{formatClock(row.entry.at)}</span>
              <span className="log-label">{row.entry.label ?? ''}</span>
              <span className="log-message">{row.entry.message}</span>
            </div>
          ) : (
            <div key={row.key} className="log-row log-event" data-kind={row.event.kind}>
              <span className="log-time">{formatClock(row.event.at)}</span>
              <span className="log-label log-event-kind">{row.event.kind.toUpperCase()}</span>
              <span className="log-message">{describeEvent(row.event)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
