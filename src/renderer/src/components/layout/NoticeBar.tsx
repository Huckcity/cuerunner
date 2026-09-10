import type { ReactNode } from 'react'

interface Props {
  /** What this bar is about; E2E and styling hook, e.g. "crash" or "recovery". */
  kind: 'crash' | 'recovery' | 'error'
  children: ReactNode
  /** Buttons for the decision a bar may need (Recover / Discard). */
  actions?: ReactNode
  onDismiss?: () => void
}

// A bar across the top of the window for things the operator has to know about and
// cannot read anywhere else: a crash that reset the session, unsaved work found on
// disk, a save that failed.
export function NoticeBar({ kind, children, actions, onDismiss }: Props) {
  return (
    <div className="app-notice" data-kind={kind} role="alert">
      <span className="app-notice-text">{children}</span>
      {actions && <span className="app-notice-actions">{actions}</span>}
      {onDismiss && (
        <button className="app-notice-dismiss" onClick={onDismiss}>Dismiss</button>
      )}
    </div>
  )
}
