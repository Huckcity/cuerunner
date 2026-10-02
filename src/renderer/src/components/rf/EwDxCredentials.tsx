import { useEffect, useState } from 'react'
import type { EwDxCredentialResult, EwDxCredentialStatus } from '../../../../shared/ipc/show'
import './EwDxCredentials.css'

interface Props {
  sourceId: string
  /** What the show names for this receiver, to tell whether a remembered move is still about it. */
  target: string
  /** Puts the cursor in the password box: a receiver was just added and this is what it needs next. */
  autoFocus?: boolean
  /**
   * Changes when the Wireless service does. A receiver's certificate is first seen by the
   * first connection, which happens after the password is saved, so the row has to look
   * again when the service moves rather than only when it is opened.
   */
  serviceKey: string
}

/** First four and last two groups of a SHA-256: enough to compare with a receiver's own screen. */
export function shortFingerprint(fingerprint: string): string {
  const groups = fingerprint.split(':')
  return groups.length > 8 ? `${groups.slice(0, 4).join(':')}…${groups.slice(-2).join(':')}` : fingerprint
}

/**
 * What it takes to let this machine into an EW-DX receiver: the password WSM set when
 * third-party access was turned on, and — once a connection has seen it — the certificate
 * the receiver was trusted with.
 *
 * Neither belongs to the show. The password is kept on this machine and never comes back
 * to the window, which is why the box is only ever empty or being typed into: it shows
 * whether one is held, not what it is. Everything it says is from main.
 */
export function EwDxCredentials({ sourceId, target, autoFocus, serviceKey }: Props): React.JSX.Element {
  const [held, setHeld] = useState<EwDxCredentialStatus | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  /** Why the last change was not taken, directly under the field it is about. */
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    window.cuerunner.show.ewDxCredentials(sourceId).then(
      status => {
        if (current) setHeld(status)
      },
      () => undefined
    )
    return () => {
      current = false
    }
  }, [sourceId, serviceKey])

  const take = (result: EwDxCredentialResult): boolean => {
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setError(null)
    setHeld(result)
    return true
  }

  const save = async (): Promise<void> => {
    if (busy || password === '') return
    setBusy(true)
    try {
      if (take(await window.cuerunner.show.ewDxSetPassword(sourceId, password))) setPassword('')
    } finally {
      setBusy(false)
    }
  }

  const trustAgain = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      take(await window.cuerunner.show.ewDxTrustAgain(sourceId))
    } finally {
      setBusy(false)
    }
  }

  const inputId = `ewdx-password-${sourceId}`

  return (
    <div className="ewdx-credentials" data-source={sourceId}>
      <div className="field-row">
        <label htmlFor={inputId}>Password</label>
        <input
          id={inputId}
          type="password"
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          value={password}
          placeholder={held?.hasPassword ? 'Saved on this machine' : 'From WSM'}
          aria-invalid={error !== null || undefined}
          onChange={e => {
            setPassword(e.target.value)
            setError(null)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') void save()
          }}
        />
        <button className="inspector-btn" disabled={busy || password === ''} onClick={() => void save()}>
          Save
        </button>
      </div>
      {error !== null && <p className="ewdx-error" role="alert">{error}</p>}
      {held !== null && !held.hasPassword && error === null && (
        <p className="inspector-hint">Turn on third-party access in WSM first.</p>
      )}
      {held?.hasPassword === true && !held.encrypted && (
        <p className="inspector-hint">Stored without encryption: this machine has no keychain.</p>
      )}

      {held?.serial != null && (
        <>
          <div className="field-row">
            <label>Serial</label>
            <span className="ewdx-serial">{held.serial}</span>
          </div>
          {/* Only while the show still names the address it moved from: an address typed since
              is the operator saying where it is, and the memory of a move is not about it. */}
          {held.moved !== null && held.moved.from === target.trim() && (
            <p className="inspector-hint">Now at {held.moved.to}; the show names {held.moved.from}.</p>
          )}
        </>
      )}

      {held?.fingerprint != null && (
        <>
          <div className="field-row">
            <label>Certificate</label>
            <span className="ewdx-fingerprint" title={held.fingerprint}>{shortFingerprint(held.fingerprint)}</span>
            <button className="inspector-btn" disabled={busy} onClick={() => void trustAgain()}>
              Trust again
            </button>
          </div>
          <p className="inspector-hint">Trust again if you replaced the receiver.</p>
        </>
      )}
    </div>
  )
}
