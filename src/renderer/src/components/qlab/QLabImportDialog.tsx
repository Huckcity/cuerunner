// Where a QLab show comes from: the workspace file QLab saved, or a QLab that is running.
//
// The file is the common case and one button. The running QLab is the other: on this
// machine, or a Mac on the network, asked over its own OSC interface — which is the path
// that works whatever version of QLab saved the show, and for a workspace whose latest
// changes were never saved.
import { useEffect } from 'react'
import { useModal } from '../../hooks/useModal'
import {
  closeQLabImport,
  findQLabWorkspaces,
  importQLabFile,
  importQLabLive,
  setQLabAddress,
  useQLabImport
} from './qlabImport'
import './QLab.css'

export function QLabImportDialog() {
  useModal()
  const busy = useQLabImport(s => s.busy)
  const error = useQLabImport(s => s.error)
  const host = useQLabImport(s => s.host)
  const port = useQLabImport(s => s.port)
  const passcode = useQLabImport(s => s.passcode)
  const workspaces = useQLabImport(s => s.workspaces)
  const workspaceId = useQLabImport(s => s.workspaceId)
  const chosen = workspaces?.find(entry => entry.id === workspaceId) ?? null

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeQLabImport() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="settings-overlay">
      <div className="qlab-dialog" role="dialog" aria-modal="true" aria-label="Import QLab Workspace">
        <div className="settings-header">
          <span className="settings-title">Import QLab Workspace</span>
          <button className="settings-close" onClick={closeQLabImport} aria-label="Close" title="Close (Esc)">✕</button>
        </div>
        <div className="qlab-body">
          <p className="qlab-intro">
            The QLab show becomes a new Cuerunner show. Nothing is written to the QLab
            workspace, and the new show has no file until you save it.
          </p>

          <section className="qlab-section">
            <h3 className="qlab-section-title">From a workspace file</h3>
            <div className="qlab-actions">
              <button className="qlab-button qlab-primary" data-action="qlab-file" disabled={busy} onClick={() => void importQLabFile()}>
                Choose Workspace File…
              </button>
              <span className="qlab-hint">.qlab5, .qlab4 or .cues</span>
            </div>
          </section>

          <section className="qlab-section">
            <h3 className="qlab-section-title">From a running QLab</h3>
            <div className="field-row">
              <label htmlFor="qlab-host">Address</label>
              <input
                id="qlab-host"
                type="text"
                value={host}
                spellCheck={false}
                onChange={e => setQLabAddress({ host: e.target.value })}
              />
            </div>
            <div className="field-row">
              <label htmlFor="qlab-port">Port</label>
              <input
                id="qlab-port"
                type="text"
                inputMode="numeric"
                value={port}
                onChange={e => setQLabAddress({ port: e.target.value })}
              />
            </div>
            <div className="qlab-actions">
              <button className="qlab-button" data-action="qlab-find" disabled={busy} onClick={() => void findQLabWorkspaces()}>
                Find Workspaces
              </button>
              <span className="qlab-hint">QLab’s OSC access has to allow this computer</span>
            </div>
            {workspaces !== null && workspaces.length > 0 && (
              <>
                <div className="field-row">
                  <label htmlFor="qlab-workspace">Workspace</label>
                  <select
                    id="qlab-workspace"
                    value={workspaceId ?? ''}
                    onChange={e => setQLabAddress({ workspaceId: e.target.value })}
                  >
                    {workspaces.map(entry => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}{entry.hasPasscode ? ' (passcode)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {chosen?.hasPasscode && (
                  <div className="field-row">
                    <label htmlFor="qlab-passcode">Passcode</label>
                    <input
                      id="qlab-passcode"
                      type="password"
                      value={passcode}
                      onChange={e => setQLabAddress({ passcode: e.target.value })}
                    />
                  </div>
                )}
                <div className="qlab-actions">
                  <button className="qlab-button qlab-primary" data-action="qlab-live" disabled={busy || chosen === null} onClick={() => void importQLabLive()}>
                    Import from QLab
                  </button>
                  {chosen?.version && <span className="qlab-hint">QLab {chosen.version}</span>}
                </div>
              </>
            )}
          </section>

          {busy && <p className="qlab-progress" role="status">Reading the show…</p>}
          {error !== null && <p className="qlab-error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  )
}
