import { useStore } from '../../store'
import './License.css'

/** Where the lock is being drawn: it fills a view, a strip, or sits inside a panel. */
export type ProLockVariant = 'view' | 'strip' | 'inspector' | 'section'

interface Props {
  /** What is locked, named as the app names it: "Scenes", "Wireless". */
  feature: string
  /** One line on what the feature does, so the lock is not a dead end. */
  blurb: string
  variant?: ProLockVariant
  /** Strips close themselves; a locked strip keeps that button. */
  onClose?: () => void
}

/**
 * What a Pro surface shows when this machine is not licensed.
 *
 * The feature is described rather than hidden, because a window with buttons that do
 * nothing is a bug report. Everything behind this is still in the app — it is the
 * licence that turns it on, not another download.
 */
export function ProLock({ feature, blurb, variant = 'section', onClose }: Props) {
  const license = useStore(s => s.license)
  const openSettings = useStore(s => s.openSettings)

  return (
    <div className="pro-lock" data-variant={variant} data-feature={feature} role="group" aria-label={feature}>
      {onClose && (
        <button className="pro-lock-close" aria-label={`Dismiss ${feature}`} onClick={onClose}>
          ✕
        </button>
      )}
      <div className="pro-lock-body">
        <span className="pro-chip pro-chip-lock">WinsLab Pro</span>
        <h2 className="pro-lock-title">{feature}</h2>
        <p className="pro-lock-blurb">{blurb}</p>
        {license.state === 'expired' && (
          <p className="pro-lock-state">
            The key for this machine expired on {license.license.expires}.
          </p>
        )}
        {license.state === 'invalid' && <p className="pro-lock-state">{license.error}</p>}
        <button className="pro-lock-unlock" onClick={() => openSettings('license')}>
          Enter license key
        </button>
      </div>
    </div>
  )
}

/** The marker on a button, tab or menu item whose feature is part of Pro. */
export function ProMark() {
  return <span className="pro-mark">Pro</span>
}