// What a merge did, in front of the operator before they trust it.
//
// A merge writes a file rather than changing the open show, so this is the one place the
// two decisions it made are visible: which side won a cue both people changed, and what
// could not be carried at all. The two buttons at the bottom are the two things that are
// worth doing next — open the result, or run the same merge over the same two files with
// the other side's choices, which is why the merge remembers them.
import { useEffect } from 'react'
import { useStore, usePro } from '../../store'
import { useModal } from '../../hooks/useModal'
import { ProLock } from '../license/ProLock'
import { openMergedShow, mergeAnotherShow } from '../../hooks/useWorkspace'
import type { MergeTally } from '../../../../shared/showfileMerge'
import './Changes.css'

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** The run of numbers the merge produced, as a sentence. */
function summarise(tally: MergeTally): string {
  const parts: string[] = []
  if (tally.oursOnly > 0) parts.push(`${tally.oursOnly} from this show`)
  if (tally.theirsOnly > 0) parts.push(`${tally.theirsOnly} from the other show`)
  if (tally.blended > 0) parts.push(`${tally.blended} put together`)
  if (tally.same > 0) parts.push(`${tally.same} unchanged`)
  if (tally.conflicts > 0) {
    parts.push(`${tally.conflicts} ${tally.conflicts === 1 ? 'conflict' : 'conflicts'}`)
  }
  return parts.length === 0 ? 'nothing to merge' : parts.join(', ')
}

export function MergeReportDialog() {
  useModal()
  const report = useStore(s => s.mergeReport)
  const setMergeReport = useStore(s => s.setMergeReport)
  const pro = usePro()

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') setMergeReport(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setMergeReport])

  if (!report) return null
  const conflicts = report.notes.filter(note => note.conflict).length
  const decided = report.policy === 'ours' ? 'this show’s' : 'the other show’s'

  return (
    <div className="settings-overlay">
      <div
        className="settings-dialog changes-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Merge"
      >
        <div className="settings-header">
          <span className="settings-title">Merged</span>
          <button
            className="settings-close"
            onClick={() => setMergeReport(null)}
            aria-label="Close merge report"
            title="Close (Esc)"
          >✕</button>
        </div>
        <div className="settings-body changes-body">
          {pro ? (
            <>
              <p className="changes-intro">
                <strong>{fileName(report.path)}</strong> holds the merge: {summarise(report.tally)}.
                This show has not been touched.
              </p>
              {conflicts > 0 && (
                <p className="changes-note">
                  {conflicts} {conflicts === 1 ? 'cue was' : 'cues were'} changed on both sides in
                  different ways. {decided} version is in the merged file, and each one is named
                  below — merging again, keeping the other show’s choices, takes a press and
                  leaves this file alone.
                </p>
              )}
              {report.notes.length > 0 ? (
                <section className="changes-group" data-group="merged">
                  <h3 className="changes-group-title">
                    What the merge had to say ({report.notes.length})
                  </h3>
                  <ul className="changes-lines">
                    {report.notes.map((note, index) => (
                      <li key={index} className="changes-line changes-line-cue">
                        <span className="changes-cue-name">{note.subject}</span>
                        <span className="changes-field">{note.detail}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                <p className="changes-empty">
                  The two sides changed different things: nothing needed deciding.
                </p>
              )}
              <div className="changes-actions">
                <button
                  className="changes-choose"
                  onClick={() => void openMergedShow(report.path)}
                >
                  Open the merged show
                </button>
                <button
                  className="changes-choose"
                  onClick={() => void mergeAnotherShow(report.policy === 'ours' ? 'theirs' : 'ours', true)}
                >
                  Merge again, keeping the {report.policy === 'ours' ? 'other show’s' : 'this show’s'} choices
                </button>
              </div>
            </>
          ) : (
            <ProLock
              variant="section"
              feature="Merging two shows"
              blurb="Two people working on different acts merge into one show, with the cues both changed named rather than decided quietly."
            />
          )}
        </div>
      </div>
    </div>
  )
}
