import { useState } from 'react'
import type { UpdateInstall, UpdateStatus } from '../../../../shared/update'
import { checkForUpdate, configureUpdates, faultReason, useUpdateStatus } from '../../engine/updateStatus'
import { UpdateActions, updateHeadline } from './UpdateNotice'
import './Update.css'

const INSTALL_LABEL: Record<UpdateInstall, string> = {
  nsis: 'Windows installer',
  dmg: 'macOS app',
  appimage: 'AppImage',
  deb: '.deb package',
  rpm: 'system package',
  pacman: 'system package',
  development: 'development build',
  unknown: 'unpacked copy'
}

/** The time of day a check last reached the server, or that none has. */
function lastChecked(status: UpdateStatus): string {
  if (status.lastCheckedAt === null) return 'Not checked yet.'
  const at = new Date(status.lastCheckedAt)
  const today = new Date().toDateString() === at.toDateString()
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `Last checked ${today ? `today at ${time}` : `${at.toLocaleDateString()} ${time}`}.`
}

/** Where the update stands, in the line beside Check now. */
function standing(status: UpdateStatus): string {
  switch (status.phase) {
    case 'checking':
      return 'Checking…'
    case 'up-to-date':
      return `Up to date. ${lastChecked(status)}`
    case 'offline':
    case 'failed':
      return status.message ?? 'The check did not finish.'
    default:
      return updateHeadline(status) ?? lastChecked(status)
  }
}

/**
 * Updates on this machine: what is running, whether there is something newer, and the rules
 * for asking — on launch and daily, never in the hours the show runs, never in Show Mode with a
 * show open. The settings are the machine's, kept in the user-data folder.
 */
export function UpdateSection() {
  const status = useUpdateStatus()
  const [note, setNote] = useState<string | null>(null)
  if (status === null) return <p className="inspector-hint">Reading this machine’s settings…</p>
  const settings = status.settings

  const save = (patch: Parameters<typeof configureUpdates>[0]): void => {
    setNote(null)
    configureUpdates(patch).catch(fault => setNote(`The setting could not be saved: ${faultReason(fault)}`))
  }
  const check = async (): Promise<void> => {
    setNote(null)
    setNote(await checkForUpdate())
  }
  const showMessage = status.message !== null && status.phase !== 'offline' && status.phase !== 'failed'

  return (
    <div className="update-section">
      <div className="field-row">
        <label>This version</label>
        <span className="settings-info" data-testid="update-current">
          {status.current} — {INSTALL_LABEL[status.install]}
        </span>
      </div>
      <div className="field-row">
        <label>Updates</label>
        <button
          className="update-action"
          onClick={() => void check()}
          disabled={status.phase === 'checking' || status.phase === 'downloading'}
        >
          Check now
        </button>
        <span className="settings-info update-standing" role="status">{standing(status)}</span>
      </div>
      {showMessage && <p className="update-message">{status.message}</p>}
      {status.available !== null && (
        <div className="field-row">
          <label />
          <div className="update-actions">
            <UpdateActions status={status} onNote={setNote} />
          </div>
        </div>
      )}
      {note !== null && <p className="update-message" role="alert">{note}</p>}

      <div className="field-row">
        <label htmlFor="update-auto">Check automatically</label>
        <input
          id="update-auto"
          type="checkbox"
          checked={settings.check}
          onChange={e => save({ check: e.target.checked })}
        />
        <span className="settings-info">On launch and once a day</span>
      </div>
      <p className="inspector-hint">
        A check only asks whether there is something newer. Nothing is downloaded or installed
        until you press for it, and never while a cue is running.
      </p>

      <div className="field-row">
        <label htmlFor="update-lockout">Show hours</label>
        <input
          id="update-lockout"
          type="checkbox"
          checked={settings.lockout.enabled}
          onChange={e => save({ lockout: { ...settings.lockout, enabled: e.target.checked } })}
        />
        <span className="settings-info">No update checks between these times</span>
      </div>
      <div className="field-row">
        <label htmlFor="update-lockout-from">From</label>
        <input
          id="update-lockout-from"
          type="time"
          className="update-time"
          value={settings.lockout.from}
          disabled={!settings.lockout.enabled}
          onChange={e => { if (e.target.value !== '') save({ lockout: { ...settings.lockout, from: e.target.value } }) }}
        />
      </div>
      <div className="field-row">
        <label htmlFor="update-lockout-to">To</label>
        <input
          id="update-lockout-to"
          type="time"
          className="update-time"
          value={settings.lockout.to}
          disabled={!settings.lockout.enabled}
          onChange={e => { if (e.target.value !== '') save({ lockout: { ...settings.lockout, to: e.target.value } }) }}
        />
      </div>
      <p className="inspector-hint">This computer’s clock. A window past midnight runs into the next day.</p>

      <div className="field-row">
        <label htmlFor="update-show-mode">In Show Mode</label>
        <input
          id="update-show-mode"
          type="checkbox"
          checked={settings.lockInShowMode}
          onChange={e => save({ lockInShowMode: e.target.checked })}
        />
        <span className="settings-info">No checks while a show file is open in Show Mode</span>
      </div>
      {status.lockout !== null && <p className="update-message" data-testid="update-lockout">{status.lockout}</p>}
    </div>
  )
}
