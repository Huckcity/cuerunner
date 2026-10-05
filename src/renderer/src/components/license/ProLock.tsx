import { useStore } from '../../store'
import { PRICING_URL } from '../../../../shared/support'
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
 * license that turns it on, not another download.
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
        <span className="pro-chip pro-chip-lock">Cuerunner Pro</span>
        <h2 className="pro-lock-title">{feature}</h2>
        <p className="pro-lock-blurb">{blurb}</p>
        {license.state === 'expired' && (
          <p className="pro-lock-state">
            The key for this machine expired on {license.license.expires}.
          </p>
        )}
        {license.state === 'invalid' && <p className="pro-lock-state">{license.error}</p>}
        <div className="pro-lock-actions">
          <button className="pro-lock-unlock" onClick={() => openSettings('license')}>
            Enter license key
          </button>
          {/* For whoever has no key to enter, which is most people who meet a lock. It
              opens in the browser: the window's own handler sends a new-window request to
              the operating system rather than drawing a page in the app. */}
          <a className="license-link pro-lock-pricing" href={PRICING_URL} target="_blank" rel="noreferrer">
            See what Pro costs
          </a>
        </div>
      </div>
    </div>
  )
}

/**
 * The marker on the one press that opens a Pro feature — the view switch, a dock tab, a
 * menu entry — and nowhere else. What the feature is and how to unlock it is the lock's
 * to say, once it is open.
 */
export function ProMark() {
  return <span className="pro-mark" title="Part of Cuerunner Pro">pro</span>
}