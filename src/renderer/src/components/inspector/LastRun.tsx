import { useStore } from '../../store'
import { formatClock } from '../../utils/cueDefaults'

function formatRunDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

interface Props { cueId: string }

// Outcome of the cue's most recent run. Read-only: it reflects what happened, not
// configuration, so it is stored outside the cue (see CueRunResult in the store).
export function LastRun({ cueId }: Props) {
  const result = useStore(s => s.lastRuns[cueId])

  return (
    <>
      <div className="field-section-title">Last Run</div>
      {result === undefined ? (
        <p className="inspector-hint">Not run yet.</p>
      ) : (
        <div className="last-run">
          <div className="last-run-line">
            <span className="last-run-badge" data-outcome={result.outcome}>
              {result.outcome === 'success' ? 'ok' : 'failed'}
            </span>
            <span className="last-run-meta">{formatClock(result.startedAt)}</span>
            <span className="last-run-meta">{formatRunDuration(result.durationMs)}</span>
            {result.status !== undefined && (
              <span className="last-run-meta">
                {result.status}{result.statusText ? ` ${result.statusText}` : ''}
              </span>
            )}
          </div>
          {result.error !== undefined && <p className="last-run-error">{result.error}</p>}
          {result.body !== undefined && <pre className="last-run-body">{result.body}</pre>}
        </div>
      )}
    </>
  )
}
