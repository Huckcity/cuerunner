import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { useModal } from '../../hooks/useModal'
import './ReportDialog.css'

interface Props {
  onClose: () => void
}

/** How long the description sits still before the preview is rebuilt around it. */
const REBUILD_MS = 250

/** One session-log entry as a line of the report. */
function logLine(entry: { at: number; level: string; message: string; label?: string }): string {
  const who = entry.label ? ` ${entry.label}:` : ''
  return `${new Date(entry.at).toISOString()} [${entry.level}]${who} ${entry.message}`
}

/**
 * Report a Problem: the whole report, on screen, before it goes anywhere.
 *
 * The text below the box is exactly what Copy, Save and Email act on — main builds it, and
 * the same string is handed back — so what leaves is what the operator read. Cuerunner
 * sends nothing itself: Copy and Save are local, and Email puts the report on the clipboard
 * and opens a message to the support address for the operator to send.
 */
export function ReportDialog({ onClose }: Props) {
  useModal()
  const log = useStore(s => s.log)
  const [description, setDescription] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  // A rebuild that finishes after a newer one started must not put its text back.
  const latest = useRef(0)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    const ticket = ++latest.current
    const timer = setTimeout(() => {
      window.cuerunner.app
        .composeReport({ description, log: log.map(logLine) })
        .then(built => { if (ticket === latest.current) setText(built) })
        .catch(() => { if (ticket === latest.current) setStatus('The report could not be built.') })
    }, description === '' && text === '' ? 0 : REBUILD_MS)
    return () => clearTimeout(timer)
    // `text` only picks the first build's delay; it must not retrigger the build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, log])

  const copy = (): void => {
    navigator.clipboard.writeText(text).then(
      () => setStatus('Copied to the clipboard.'),
      () => setStatus('The clipboard could not be reached. Use Save instead.')
    )
  }

  const save = async (): Promise<void> => {
    try {
      const result = await window.cuerunner.app.saveReport(text)
      if (!result.ok) setStatus(result.error)
      else if (result.path !== null) setStatus(`Saved to ${result.path}`)
    } catch {
      setStatus('The report could not be saved.')
    }
  }

  const email = async (): Promise<void> => {
    try {
      const result = await window.cuerunner.app.emailReport(text)
      setStatus(result.ok
        ? 'On the clipboard. Paste it into the message that opened.'
        : result.error)
    } catch {
      setStatus('A message could not be opened. Copy the report and write to the support address.')
    }
  }

  return (
    <div className="report-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="report-dialog" role="dialog" aria-modal="true" aria-label="Report a Problem">
        <div className="report-header">
          <span className="report-title">Report a Problem</span>
          <button className="report-close" onClick={onClose} aria-label="Close report" title="Close (Esc)">✕</button>
        </div>
        <div className="report-body">
          <div className="field-row report-what">
            <label htmlFor="report-description">What happened</label>
            <textarea
              id="report-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              autoFocus
            />
          </div>
          <p className="report-hint">Cuerunner sends nothing. This is the whole report.</p>
          <pre className="report-text" aria-label="Report text" tabIndex={0}>{text}</pre>
        </div>
        <div className="report-footer">
          <span className="report-status" role="status">{status}</span>
          <button className="report-button" onClick={copy} disabled={text === ''}>Copy</button>
          <button className="report-button" onClick={() => void save()} disabled={text === ''}>Save…</button>
          <button className="report-button report-primary" onClick={() => void email()} disabled={text === ''}>
            Email…
          </button>
        </div>
      </div>
    </div>
  )
}
