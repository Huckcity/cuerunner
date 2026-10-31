// The two questions a showfile can answer about itself: what its own saves changed, and
// how it differs from another file.
//
// Both are read here rather than in the main process: the history travels in the
// workspace the window already holds, and a comparison — the one part that needs a file
// this process cannot read — is asked for as one call and comes back as data. Nothing
// here writes to the show.
import { useEffect, useState } from 'react'
import { useStore, type ChangesTab } from '../../store'
import { useModal } from '../../hooks/useModal'
import { buildWorkspace } from '../../utils/workspace'
import {
  describeEntry,
  describeField,
  describeValue,
  type LoggedCue,
  type ShowHistoryEntry,
  type WorkspaceDiff
} from '../../../../shared/showfile'
import './Changes.css'

const TABS: { id: ChangesTab; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'compare', label: 'Compare' }
]

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** A stamp as an operator reads it: the day, then the time, on the machine's clock. */
function when(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function cueLine(cue: LoggedCue): string {
  const verb = { added: 'Added', removed: 'Removed', edited: 'Edited', moved: 'Moved' }[cue.kind]
  const fields = cue.fields && cue.fields.length > 0 ? ` — ${cue.fields.join(', ')}` : ''
  return `${verb} ${cue.label}${fields}`
}

function HistoryRow({ entry }: { entry: ShowHistoryEntry }) {
  const lines = [
    ...entry.cues.map(cueLine),
    ...entry.settings.map(path => `Settings — ${path}`)
  ]
  const dropped = (entry.omitted?.cues ?? 0) + (entry.omitted?.settings ?? 0)
  return (
    <li className="changes-entry">
      <div className="changes-entry-head">
        <span className="changes-when">{when(entry.at)}</span>
        <span className="changes-who" title={entry.machine ? `${entry.by} on ${entry.machine}` : entry.by}>
          {entry.by}
        </span>
      </div>
      <div className="changes-summary">{describeEntry(entry)}</div>
      {lines.length > 0 && (
        <details className="changes-detail">
          <summary>{lines.length} {lines.length === 1 ? 'line' : 'lines'}</summary>
          <ul className="changes-lines">
            {lines.map((line, index) => <li key={index} className="changes-line">{line}</li>)}
            {dropped > 0 && <li className="changes-line changes-line-more">and {dropped} more</li>}
          </ul>
        </details>
      )}
    </li>
  )
}

function HistoryTab() {
  const history = useStore(s => s.showHistory)
  const name = useStore(s => s.workspaceName)

  if (history.length === 0) {
    return (
      <p className="changes-empty">
        Nothing has been saved yet. A save that changes the show writes a line into the
        file — who saved it, when, and what moved — and this is where those lines are read
        back. Saving without changing anything writes nothing.
      </p>
    )
  }

  return (
    <div className="changes-history">
      <p className="changes-intro">
        What each save of <strong>{name}</strong> changed, newest first. The history lives
        in the showfile, so it travels with the show.
      </p>
      <ul className="changes-list">
        {[...history].reverse().map((entry, index) => (
          <HistoryRow key={`${entry.at}:${index}`} entry={entry} />
        ))}
      </ul>
    </div>
  )
}

function DiffView({ path, diff }: { path: string; diff: WorkspaceDiff }) {
  const cues = diff.added.length + diff.removed.length + diff.changed.length

  return (
    <div className="changes-diff">
      <p className="changes-intro">
        What changed from <strong>{fileName(path)}</strong> ({diff.from.cues} cues) to this
        show, <strong>{diff.to.name}</strong> ({diff.to.cues} cues).
      </p>
      {!diff.sameShow && (
        <p className="changes-note">
          These two files are different shows, so this is a comparison of two documents
          rather than two versions of one — every cue either file has is reported as added
          or removed.
        </p>
      )}
      {diff.empty ? (
        <p className="changes-empty">Nothing has changed. The two files say the same thing.</p>
      ) : (
        <div className="changes-groups">
          {diff.added.length > 0 && (
            <section className="changes-group" data-group="added">
              <h3 className="changes-group-title">Added ({diff.added.length})</h3>
              <ul className="changes-lines">
                {diff.added.map(cue => (
                  <li key={cue.id} className="changes-line">
                    {cue.label}
                    {cue.place.parent && <span className="changes-where"> in {cue.place.parent.label}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {diff.removed.length > 0 && (
            <section className="changes-group" data-group="removed">
              <h3 className="changes-group-title">Removed ({diff.removed.length})</h3>
              <ul className="changes-lines">
                {diff.removed.map(cue => (
                  <li key={cue.id} className="changes-line">
                    {cue.label}
                    {cue.place.parent && <span className="changes-where"> in {cue.place.parent.label}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {diff.changed.length > 0 && (
            <section className="changes-group" data-group="changed">
              <h3 className="changes-group-title">Changed ({diff.changed.length})</h3>
              <ul className="changes-lines">
                {diff.changed.map(change => (
                  <li key={change.id} className="changes-line changes-line-cue">
                    <span className="changes-cue-name">{change.label}</span>
                    {change.fields?.map(field => (
                      <span key={field.field} className="changes-field">{describeField(field)}</span>
                    ))}
                    {change.moved && <span className="changes-field">moved</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {diff.settings.length > 0 && (
            <section className="changes-group" data-group="settings">
              <h3 className="changes-group-title">Show settings ({diff.settings.length})</h3>
              <ul className="changes-lines">
                {diff.settings.map(setting => (
                  <li key={setting.path} className="changes-line changes-line-cue">
                    <span className="changes-cue-name">{setting.path}</span>
                    <span className="changes-field">
                      {describeValue(setting.from)} → {describeValue(setting.to)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <p className="changes-foot">
        {cues === 0 && diff.empty
          ? ''
          : `${diff.unchanged} ${diff.unchanged === 1 ? 'cue is' : 'cues are'} the same in both files.`}
      </p>
    </div>
  )
}

function CompareTab() {
  const [comparison, setComparison] = useState<{ path: string; diff: WorkspaceDiff } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const workspaceId = useStore(s => s.workspaceId)

  // A comparison belongs to the show it was made against: opening another show leaves
  // the answer on screen about a show that is no longer in front of the operator.
  useEffect(() => {
    setComparison(null)
    setError(null)
  }, [workspaceId])

  const choose = async (): Promise<void> => {
    const {
      workspaceName, cues, audioSettings, midiSettings, showSettings, triggerGuard, lighting, timecode, cueLists, oscPatches,
      workspaceId, workspaceCreatedAt, showHistory
    } = useStore.getState()
    const workspace = buildWorkspace({
      id: workspaceId,
      name: workspaceName,
      createdAt: workspaceCreatedAt,
      history: showHistory,
      audioSettings,
      midiSettings,
      showSettings,
      triggerGuard,
      lighting,
      timecode,
      videoOutputs: useStore.getState().videoOutputs,
      cueLists,
      pictures: useStore.getState().pictures,
      oscPatches,
      cues
    })
    setBusy(true)
    setError(null)
    try {
      const answer = await window.cuerunner.workspace.compare(workspace)
      if (!answer.ok) {
        setError(answer.error)
        setComparison(null)
        return
      }
      setComparison(answer.comparison)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="changes-compare">
      <div className="changes-compare-bar">
        <button className="changes-choose" onClick={() => void choose()} disabled={busy}>
          {comparison ? 'Compare with another file…' : 'Choose a file to compare with…'}
        </button>
        <span className="changes-hint">
          The file you pick is the older side: what changed since it was written.
        </span>
      </div>
      {error && <p className="changes-error">{error}</p>}
      {comparison
        ? <DiffView path={comparison.path} diff={comparison.diff} />
        : !busy && !error && (
          <p className="changes-empty">
            Pick a saved show — last night’s copy, a colleague’s version — and this says
            what changed cue by cue: added, removed, edited, moved, and which settings
            moved with them.
          </p>
        )}
    </div>
  )
}

interface Props {
  initialTab: ChangesTab
  onClose: () => void
}

/**
 * What this showfile has done, and how it differs from another one. A dialog rather than
 * a view: it is something an operator reads between rehearsals, not a surface the show is
 * run from.
 */
export function ChangesDialog({ initialTab, onClose }: Props) {
  useModal()
  const [tab, setTab] = useState<ChangesTab>(initialTab)

  // Closed from Escape like the other panels, and never from a press beside it: a
  // half-read history should not disappear because a click landed on the backdrop.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="settings-overlay">
      <div
        className="settings-dialog changes-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Changes"
      >
        <div className="settings-header">
          <span className="settings-title">Changes</span>
          <button className="settings-close" onClick={onClose} aria-label="Close changes" title="Close (Esc)">✕</button>
        </div>
        <div className="settings-tabs">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              className="settings-tab"
              data-active={tab === id}
              data-changes-tab={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="settings-body changes-body">
          {tab === 'history' ? <HistoryTab /> : <CompareTab />}
        </div>
      </div>
    </div>
  )
}
