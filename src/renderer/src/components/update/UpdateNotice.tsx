import { useState } from 'react'
import { useStore } from '../../store'
import { canSelfUpdate, type UpdateStatus } from '../../../../shared/update'
import { parseReleaseNotes, sectionsBetween } from '../../../../shared/releaseNotes'
import {
  dismissUpdate,
  downloadUpdate,
  installUpdate,
  useDismissedUpdate,
  useUpdateStatus
} from '../../engine/updateStatus'
import { ReleaseNotesDialog } from './ReleaseNotes'
import './Update.css'

/** What the bar and the settings tab say about where an update stands. */
export function updateHeadline(status: UpdateStatus): string | null {
  const version = status.available?.version
  switch (status.phase) {
    case 'available':
      return version === undefined ? null : `Cuerunner ${version} is available.`
    case 'downloading':
      return `Downloading Cuerunner ${version ?? ''}${status.progress === null ? '…' : ` — ${Math.round(status.progress * 100)}%`}`
    case 'downloaded':
      return `Cuerunner ${version ?? ''} is ready. It installs when Cuerunner quits, or now if you restart.`
    case 'held':
    case 'refused':
      return version === undefined ? null : `Cuerunner ${version}:`
    default:
      return null
  }
}

/**
 * The buttons an update offers where it stands: the release notes always, then download,
 * restart, or — for a copy that cannot replace itself — the download page. A press that is
 * refused says why beside the buttons; it is never a dialog.
 */
export function UpdateActions({ status, onNote }: { status: UpdateStatus; onNote: (note: string | null) => void }) {
  const dirty = useStore(s => s.isDirty)
  const [notesOpen, setNotesOpen] = useState(false)
  const available = status.available
  if (available === null) return null
  const selfUpdating = canSelfUpdate(status.install)

  const download = async (): Promise<void> => {
    onNote(await downloadUpdate())
  }
  const restart = async (): Promise<void> => {
    // A restart closes the show, and a show with unsaved changes asks first on its own way out —
    // but an installer that is already running does not wait for the answer, so it is asked here.
    if (dirty) {
      onNote('Save the show first: restarting closes it.')
      return
    }
    onNote(await installUpdate())
  }
  const sections = sectionsBetween(parseReleaseNotes(available.notes), status.current, available.version)

  return (
    <>
      <button className="update-action" onClick={() => setNotesOpen(true)}>Release notes</button>
      {selfUpdating && (status.phase === 'available' || status.phase === 'held' || status.phase === 'refused' || status.phase === 'failed') && (
        <button className="update-action" data-primary="true" onClick={() => void download()}>
          {status.phase === 'available' ? 'Download' : 'Download again'}
        </button>
      )}
      {selfUpdating && status.phase === 'downloaded' && (
        <button className="update-action" data-primary="true" onClick={() => void restart()}>Restart now</button>
      )}
      {!selfUpdating && (
        <button className="update-action" onClick={() => void window.cuerunner.update.openDownloads()}>
          Open the download page
        </button>
      )}
      {notesOpen && (
        <ReleaseNotesDialog
          title={`Cuerunner ${available.version}`}
          lede={`What changes from ${status.current}${available.releaseDate ? `, released ${available.releaseDate.slice(0, 10)}` : ''}:`}
          sections={sections}
          fallback={available.notes}
          onClose={() => setNotesOpen(false)}
        />
      )}
    </>
  )
}

/**
 * The bar an update is offered in: under the toolbar's notices, never in Show Mode — a show
 * being run is not the moment — and put away for the session with Later. What is under way and
 * why a press was refused are said in it, in one line.
 */
export function UpdateNotice({ showMode }: { showMode: boolean }) {
  const status = useUpdateStatus()
  const dismissed = useDismissedUpdate()
  // A refused press's sentence belongs to the state it was refused in: once the update moves
  // on, so does the sentence.
  const [note, setNote] = useState<{ text: string; phase: string } | null>(null)
  if (status === null || showMode) return null
  const headline = updateHeadline(status)
  const version = status.available?.version
  if (headline === null || version === undefined || dismissed === version) return null
  const sentence = (note !== null && note.phase === status.phase ? note.text : null) ?? status.message
  const onNote = (text: string | null): void => setNote(text === null ? null : { text, phase: status.phase })

  return (
    <div className="app-notice update-notice" data-kind="update" data-phase={status.phase} role="status">
      <span className="app-notice-text">
        {headline}
        {sentence !== null && <span className="update-notice-message"> {sentence}</span>}
      </span>
      <span className="app-notice-actions">
        <UpdateActions status={status} onNote={onNote} />
        {status.phase !== 'downloading' && (
          <button className="app-notice-dismiss" onClick={() => dismissUpdate(version)}>Later</button>
        )}
      </span>
    </div>
  )
}
