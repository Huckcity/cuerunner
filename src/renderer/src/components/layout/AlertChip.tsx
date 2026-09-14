import { useStore } from '../../store'
import type { ShowAlert } from '../../types/show'
import { isRfAlert } from '../rf/RfPanel'
import type { ShowStrip } from './TransportBar'
import './AlertChip.css'

const RANK: Record<ShowAlert['level'], number> = { critical: 2, warning: 1, info: 0 }

/**
 * The alarm the operator should see first, and how many others are standing. Info
 * alerts are the monitor's business, not the transport's. Within a level the newest
 * wins: it is the one nobody has looked at yet.
 */
export function topAlert(alerts: ShowAlert[]): { alert: ShowAlert; others: number } | null {
  const standing = alerts.filter(alert => alert.level !== 'info')
  if (standing.length === 0) return null
  const alert = standing.reduce((best, next) =>
    RANK[next.level] > RANK[best.level] ||
    (RANK[next.level] === RANK[best.level] && next.at >= best.at)
      ? next
      : best)
  return { alert, others: standing.length - 1 }
}

interface Props {
  /** Opens the panel that owns the alarm, so its dismiss and its context are one click away. */
  onShow: (strip: ShowStrip) => void
}

/**
 * Standing alarms, in the transport bar: the one place on screen that is there whatever
 * the operator has open. The panels keep the full list and the dismiss buttons.
 */
export function AlertChip({ onShow }: Props) {
  const alerts = useStore(s => s.showAlerts)
  const top = topAlert(alerts)
  if (!top) return null

  const owner: ShowStrip = isRfAlert(top.alert) ? 'rf' : 'monitor'
  return (
    <button
      className="alert-chip"
      data-level={top.alert.level}
      onClick={() => onShow(owner)}
      title={`${top.others + 1} standing ${top.others === 0 ? 'alarm' : 'alarms'} — open ${owner === 'rf' ? 'Wireless' : 'the show monitor'}`}
    >
      <span className="alert-chip-message">{top.alert.message}</span>
      {top.others > 0 && <span className="alert-chip-more">+{top.others}</span>}
    </button>
  )
}
