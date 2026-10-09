// What an import made of a QLab show, before the operator trusts it.
//
// A converted show nobody can audit is a show nobody can run, so this says what needs
// hands rather than celebrating: every QLab type with what it became, every placeholder
// and every approximation by cue, and the audio that was not where QLab said — with a
// folder to look in for all of it at once.
import { useEffect } from 'react'
import { useStore } from '../../store'
import { useModal } from '../../hooks/useModal'
import { CueIcon } from '../../utils/cueIcons'
import type { CueType } from '../../../../shared/cue'
import type { QLabImportNote, QLabImportReport } from '../../../../shared/ipc/qlab'
import { closeQLabImport, findQLabMediaInFolder, useQLabImport } from './qlabImport'
import './QLab.css'

/** What each Cuerunner type is called in the window. */
const TYPE_LABELS: Partial<Record<CueType, string>> = {
  audio: 'Audio', midi: 'MIDI', osc: 'OSC', wait: 'Wait', fade: 'Fade', stop: 'Stop',
  group: 'Group', network: 'Network', script: 'Script', scene: 'Scene', devamp: 'Devamp',
  msc: 'Show Control', mic: 'Mic'
}

const NOTE_SECTIONS: Array<{ kind: QLabImportNote['kind']; title: string; blurb: string }> = [
  {
    kind: 'placeholder',
    title: 'Placeholders',
    blurb: 'Disarmed, under the QLab number and name; the notes say what each one was.'
  },
  {
    kind: 'approximated',
    title: 'Approximated',
    blurb: 'Mapped, with one thing that could not be carried exactly.'
  },
  {
    kind: 'retimed',
    title: 'Retimed',
    blurb: 'Fires when it fired in QLab; the times are written differently.'
  }
]

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function summary(report: QLabImportReport): string {
  const placeholders = report.types.filter(row => row.becameType === null).reduce((sum, row) => sum + row.count, 0)
  const from = report.source === 'file' ? fileName(report.origin) : `QLab at ${report.origin}`
  const parts = [
    `${plural(report.totalCues, 'cue', 'cues')} in ${plural(report.cueLists, 'cue list', 'cue lists')} came across from ${from}`,
    placeholders > 0 ? `${plural(placeholders, 'is a placeholder', 'are placeholders')}` : 'every one has a Cuerunner cue'
  ]
  return `${parts.join('; ')}.`
}

export function QLabReportDialog({ report }: { report: QLabImportReport }) {
  useModal()
  const busy = useQLabImport(s => s.busy)
  const error = useQLabImport(s => s.error)
  const lastFound = useQLabImport(s => s.lastFound)
  const lastAmbiguous = useQLabImport(s => s.lastAmbiguous)
  const missingMedia = useStore(s => s.missingMedia)
  const cues = useStore(s => s.cues)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeQLabImport() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const cueLabel = (cueId: string): string => {
    const cue = cues.find(entry => entry.id === cueId)
    if (!cue) return ''
    return cue.number !== '' ? `${cue.number} ${cue.name}` : cue.name
  }

  return (
    <div className="settings-overlay">
      <div className="qlab-dialog qlab-report" role="dialog" aria-modal="true" aria-label="QLab import report">
        <div className="settings-header">
          <span className="settings-title">Imported from QLab</span>
          <button className="settings-close" onClick={closeQLabImport} aria-label="Close import report" title="Close (Esc)">✕</button>
        </div>
        <div className="qlab-body">
          <p className="qlab-intro" data-testid="qlab-summary">
            <strong>{report.workspaceName}</strong>: {summary(report)} It is a new show with no
            file yet — Save As keeps it.
          </p>

          <table className="qlab-types">
            <thead>
              <tr><th>QLab cue</th><th className="qlab-count">Cues</th><th>Became</th></tr>
            </thead>
            <tbody>
              {report.types.map(row => (
                <tr key={`${row.qlabType}-${row.becameType ?? 'placeholder'}`} data-qlab-type={row.qlabType} data-became={row.becameType ?? 'placeholder'}>
                  <td>{row.qlabType}</td>
                  <td className="qlab-count">{row.count}</td>
                  <td>
                    {row.becameType === null
                      ? <span className="qlab-placeholder">Placeholder, disarmed</span>
                      : <span className="qlab-became"><CueIcon type={row.becameType} />{TYPE_LABELS[row.becameType] ?? row.becameType}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {NOTE_SECTIONS.map(section => {
            const notes = report.notes.filter(note => note.kind === section.kind)
            if (notes.length === 0) return null
            return (
              <section key={section.kind} className="qlab-section" data-notes={section.kind}>
                <h3 className="qlab-section-title">{section.title} ({notes.length})</h3>
                <p className="qlab-hint">{section.blurb}</p>
                <ul className="qlab-notes">
                  {notes.map((note, index) => (
                    <li key={`${note.cueId}-${index}`}>
                      <span className="qlab-note-cue">
                        {note.number !== '' && <span className="qlab-note-number">{note.number}</span>}
                        {note.name || note.qlabType}
                      </span>
                      <span className="qlab-note-detail">{note.qlabType}: {note.detail}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          <section className="qlab-section" data-notes="media">
            <h3 className="qlab-section-title">Audio files</h3>
            {report.media.referenced === 0 ? (
              <p className="qlab-hint">The show plays no audio files.</p>
            ) : missingMedia.length === 0 ? (
              <p className="qlab-ok" data-testid="qlab-media-ok">
                All {plural(report.media.referenced, 'file', 'files')} the show plays are where QLab said.
              </p>
            ) : (
              <>
                <p className="qlab-warn" data-testid="qlab-media-missing">
                  {plural(missingMedia.length, 'file is', 'files are')} not where QLab said. Find in Folder… links
                  every one a folder holds.
                </p>
                <ul className="qlab-notes qlab-missing">
                  {missingMedia.map(entry => (
                    <li key={entry.cueId}>
                      <span className="qlab-note-cue">{cueLabel(entry.cueId)}</span>
                      <span className="qlab-note-detail">{entry.originalPath || entry.path}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {lastFound !== null && (
              <p className="qlab-hint" role="status">
                {lastFound === 0 ? 'None of them were in that folder.' : `Found ${plural(lastFound, 'file', 'files')} in that folder.`}
              </p>
            )}
            {lastAmbiguous.length > 0 && (
              // A renamed file two files could be: neither is guessed, and the operator picks.
              <ul className="qlab-notes qlab-missing" data-testid="qlab-media-ambiguous">
                {lastAmbiguous.map(entry => (
                  <li key={entry.cueId}>
                    <span className="qlab-note-cue">{cueLabel(entry.cueId)}</span>
                    <span className="qlab-note-detail">
                      Could be any of {entry.candidates.map(fileName).join(', ')}: relink it from the cue.
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {missingMedia.length > 0 && (
              <div className="qlab-actions">
                <button className="qlab-button" data-action="qlab-find-media" disabled={busy} onClick={() => void findQLabMediaInFolder()}>
                  Find in Folder…
                </button>
              </div>
            )}
          </section>

          {error !== null && <p className="qlab-error" role="alert">{error}</p>}

          <div className="qlab-actions qlab-footer">
            <button className="qlab-button qlab-primary" data-action="qlab-done" onClick={closeQLabImport}>Done</button>
          </div>
        </div>
      </div>
    </div>
  )
}
