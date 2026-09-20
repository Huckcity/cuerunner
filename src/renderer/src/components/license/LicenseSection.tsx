import { useState } from 'react'
import { useStore } from '../../store'
import './License.css'

/**
 * The license this machine holds, and the field that changes it.
 *
 * Keys are verified in the main process against a key built into the app, so nothing
 * is asked of the network and a venue with no internet unlocks the same as any other.
 * What the operator sees here is exactly what that process will act on.
 */
export function LicenseSection() {
  const license = useStore(s => s.license)
  const setLicense = useStore(s => s.setLicense)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const activate = async (): Promise<void> => {
    setBusy(true)
    const result = await window.cuerunner.license.activate(draft)
    setBusy(false)
    setLicense(result.status)
    setError(result.ok ? null : result.error ?? 'That key was refused.')
    if (result.ok) setDraft('')
  }

  const deactivate = async (): Promise<void> => {
    setLicense(await window.cuerunner.license.deactivate())
    setError(null)
  }

  return (
    <>
      {license.state === 'active' && (
        <>
          <div className="field-row">
            <label>License</label>
            <span className="settings-info">Licensed to {license.license.licensee}</span>
          </div>
          <div className="field-row">
            <label>Key id</label>
            <span className="settings-info">{license.license.id}</span>
          </div>
          <div className="field-row">
            <label>Issued</label>
            <span className="settings-info">{license.license.issued}</span>
          </div>
          <div className="field-row">
            <label>Expires</label>
            <span className="settings-info">{license.license.expires ?? 'never'}</span>
          </div>
          <div className="field-row">
            <label />
            <div className="license-actions">
              <button className="license-action" onClick={deactivate}>Deactivate</button>
            </div>
          </div>
          <p className="license-note">
            Deactivating puts this machine back to the free app. Your shows are untouched.
          </p>
        </>
      )}

      {license.state !== 'active' && (
        <>
          <p className="inspector-hint" data-scope="panel">
            The cue stack is free, and always will be. Pro adds the show around it: scenes
            and the desk, cues that fire from a console, the monitor, wireless mics, and
            the script with its tablet view.
          </p>

          {license.state === 'expired' && (
            <>
              <p className="license-warn">
                The key for this machine expired on {license.license.expires}.
              </p>
              {/* Under the sentence that says the key ended, and in the voice the
                  Deactivate note already uses: what the ending leaves working. */}
              <p className="license-note">
                The Pro half is off until a renewed key is entered; your shows and the
                cue stack keep working.
              </p>
            </>
          )}

          <div className="field-row">
            <label htmlFor="license-key">License key</label>
            <textarea
              id="license-key"
              className="license-input"
              value={draft}
              spellCheck={false}
              placeholder="Paste the key from your purchase"
              onChange={e => {
                setDraft(e.target.value)
                setError(null)
              }}
            />
          </div>

          {/* Directly under the field it belongs to: the reason a paste was refused is
              about what is in the box above it, not about the button below. */}
          {error !== null && <p className="license-error" role="alert">{error}</p>}

          <div className="field-row">
            <label />
            <div className="license-actions">
              <button
                className="license-action"
                data-primary="true"
                disabled={busy || draft.trim().length === 0}
                onClick={activate}
              >
                Activate
              </button>
            </div>
          </div>
          <p className="license-note">
            Checked on this machine, so a show computer never needs the internet.
          </p>
        </>
      )}
    </>
  )
}