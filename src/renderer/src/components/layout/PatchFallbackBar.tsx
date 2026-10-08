import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { useOutputDevices } from '../../hooks/useOutputDevices'
import { describePatchFallback } from '../../../../shared/audioRouting'
import './PatchFallbackBar.css'

/**
 * Says which of the show's output patches are not playing where they were made to, where they
 * play instead and why: a show opened on a machine without one of its interfaces, a device
 * that would not open, one lost mid-show. Each patch that fell back plays on the show's own
 * device's outputs of the same numbers — heard, but maybe not where it should be — and the
 * operator is told so the moment it happens, and in the log. The bar goes when every patch is
 * back on its device; dismissed, it stays away until the list of fallbacks changes.
 */
export function PatchFallbackBar() {
  const { fallbacks } = useOutputDevices()
  const openSettings = useStore(s => s.openSettings)
  const appendLog = useStore(s => s.appendLog)
  const [dismissed, setDismissed] = useState('')
  const logged = useRef(new Set<string>())

  const lines = fallbacks.map(describePatchFallback)
  const key = lines.join('\n')

  useEffect(() => {
    // Each fallback is written to the log once, when it begins: the bar can be dismissed and
    // the show goes on, and the log is where the night is read back.
    const fresh = lines.filter(line => !logged.current.has(line))
    for (const line of fresh) logged.current.add(line)
    for (const line of [...logged.current]) if (!lines.includes(line)) logged.current.delete(line)
    if (fresh.length > 0) appendLog(fresh.map(line => ({ level: 'error' as const, message: `Output patch fell back — ${line}` })))
    // `key` is the list itself; `lines` is rebuilt from it on every render.
  }, [key, appendLog])

  if (fallbacks.length === 0 || dismissed === key) return null

  return (
    <div className="patch-fallback-bar" role="alert" data-count={fallbacks.length}>
      <div className="patch-fallback-bar-text">
        {fallbacks.length === 1
          ? <span>{`Output patch fell back. ${lines[0]}.`}</span>
          : (
            <>
              <span>{`${fallbacks.length} output patches fell back to ${fallbacks[0].to}.`}</span>
              <ul className="patch-fallback-list">
                {fallbacks.map((fallback, index) => (
                  <li key={fallback.patchId} data-patch={fallback.patchId}>{lines[index]}</li>
                ))}
              </ul>
            </>
          )}
      </div>
      <div className="patch-fallback-bar-actions">
        <button className="patch-fallback-settings" onClick={() => openSettings('audio')}>Audio settings</button>
        <button className="patch-fallback-dismiss" onClick={() => setDismissed(key)}>Dismiss</button>
      </div>
    </div>
  )
}
