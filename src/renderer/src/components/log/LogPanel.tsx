import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type LogEntry } from '../../store'
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
  | { kind: 'entry'; at: number; key: string; entry: LogEntry; repeat?: number }
  | { kind: 'event'; at: number; key: string; event: ShowEvent; repeat?: number }

/**
 * What a row says, for the purpose of noticing that two say the same thing. A label is
 * part of it: the same sentence from two different cues is two pieces of news.
 */
function rowText(row: Row): string {
  return row.kind === 'entry'
    ? `${row.entry.label ?? ''}\u0000${row.entry.message}`
    : `${row.event.kind}\u0000${describeEvent(row.event)}`
}

/**
 * Lines in a row that say the same thing are one line with a count. A redundancy status
 * is the case that made this worth doing — the same sentence can be published twice in a
 * second as a machine's picture of its partner changes and changes back — but it applies
 * to anything: a script that logs the same line twice is one line that happened twice.
 * Only *adjacent* lines join, so a repeat separated by anything else stays visible.
 */
function joinRepeats(rows: Row[]): Row[] {
  const joined: Row[] = []
  for (const row of rows) {
    const previous = joined.at(-1)
    if (previous && rowText(previous) === rowText(row)) {
      joined[joined.length - 1] = { ...previous, repeat: (previous.repeat ?? 1) + 1 }
      continue
    }
    joined.push(row)
  }
  return joined
}

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
  return joinRepeats([...entries, ...incoming].sort((a, b) => a.at - b.at))
}

interface Props {
  onClose: () => void
}

export function LogPanel({ onClose }: Props) {
  const log = useStore(s => s.log)
  const events = useStore(s => s.showEvents)
  const clearLog = useStore(s => s.clearLog)
  const clearShowEvents = useStore(s => s.clearShowEvents)
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
              {row.repeat !== undefined && <span className="log-repeat">×{row.repeat}</span>}
            </div>
          ) : (
            <div key={row.key} className="log-row log-event" data-kind={row.event.kind}>
              <span className="log-time">{formatClock(row.event.at)}</span>
              <span className="log-label log-event-kind">{row.event.kind.toUpperCase()}</span>
              <span className="log-message">{describeEvent(row.event)}</span>
              {row.repeat !== undefined && <span className="log-repeat">×{row.repeat}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
