import { useState } from 'react'
import { useStore } from '../../store'
import './License.css'

/**
 * The licence this machine holds, and the field that changes it.
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
    const result = await window.winslab.license.activate(draft)
    setBusy(false)
    setLicense(result.status)
    setError(result.ok ? null : result.error ?? 'That key was refused.')
    if (result.ok) setDraft('')
  }

  const deactivate = async (): Promise<void> => {
    setLicense(await window.winslab.license.deactivate())
    setError(null)
  }

  return (
    <>
      {license.state === 'active' && (
        <>
          <div className="field-row">
            <label>Licence</label>
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
            Deactivating returns this machine to the free feature set. Nothing in a show
            file changes.
          </p>
        </>
      )}

      {license.state !== 'active' && (
        <>
          <p className="inspector-hint">
            The free app runs the cue stack: audio, MIDI, OSC, network, script and group
            cues, the timeline, and the session log. WinsLab Pro adds the scenes view and
            the desk, cues that fire from OSC and MIDI, the show monitor, wireless and the
            mic plot, and the script panel with its tablet companion.
          </p>

          {license.state === 'expired' && (
            <p className="license-warn">
              The key for this machine expired on {license.license.expires}.
            </p>
          )}

          <div className="field-row">
            <label htmlFor="license-key">License key</label>
            <textarea
              id="license-key"
              className="license-input"
              value={draft}
              spellCheck={false}
              placeholder="(paste the key from your purchase)"
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
            The key is checked on this machine, so a show computer never needs the internet.
          </p>
        </>
      )}
    </>
  )
}