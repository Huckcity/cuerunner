import type { ServiceStatus as Status } from '../../../../shared/show'
import './ServiceStatus.css'

/**
 * What state a service is in, in a word an operator would use. The state names are the
 * runtime's — stopped, starting, running, degraded, failed — and they are right for a
 * log; on a settings panel "stopped" reads as something went wrong when it only means
 * the operator has not switched it on.
 */
const WORD: Record<Status['state'], string> = {
  stopped: 'Off',
  starting: 'Starting',
  running: 'On',
  degraded: 'Trouble',
  failed: 'Failed'
}

interface Props {
  service: Status | undefined
  /** What to say when there is no service to report at all. */
  absent?: string
}

/**
 * What a service is doing, beside the switch that turns it on.
 *
 * It used to be a line of monospace under the fields — `stopped — disabled`,
 * `running — listening on 0.0.0.0:53000` — which reads as a log line the operator is
 * being shown rather than an answer to what they just did. The state is a pill, coloured
 * by whether it needs them, and the service's own detail follows it in plain text.
 */
export function ServiceStatus({ service, absent }: Props) {
  if (service === undefined) {
    return absent === undefined ? null : <p className="service-status-absent">{absent}</p>
  }
  // A service that is off says only that: its detail is the reason it is off, which is
  // the switch the operator is already looking at.
  const detail = service.state === 'stopped' ? '' : service.detail
  return (
    <div className="settings-service" data-service={service.id} data-state={service.state}>
      <span className="service-pill"><i />{WORD[service.state]}</span>
      {detail !== '' && <span className="service-detail">{detail}</span>}
    </div>
  )
}
