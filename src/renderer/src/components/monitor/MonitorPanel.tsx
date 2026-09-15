import { useStore } from '../../store'
import type { MidiMessageKind } from '../../types/cue'
import type { DeviceState, ShowEvent } from '../../types/show'
import './MonitorPanel.css'

function describeMidi(message: MidiMessageKind): string {
  switch (message.kind) {
    case 'noteOn':
    case 'noteOff':
      return `${message.kind} ch${message.channel} ${message.note}/${message.velocity}`
    case 'cc':
      return `cc ch${message.channel} ${message.controller}/${message.value}`
    case 'programChange':
      return `programChange ch${message.channel} ${message.program}`
    case 'sysex':
      return `sysex ${message.data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}`
  }
}

/** One line of what came in from the show, in the terms the operator thinks in. */
export function describeEvent(event: ShowEvent): string {
  switch (event.kind) {
    case 'osc': {
      const head = `${event.address} from ${event.from}`
      const args = event.args.map(arg => String(arg.value)).join(', ')
      return args.length === 0 ? head : `${head} ${args}`
    }
    case 'midi':
      return describeMidi(event.message)
    case 'device':
      return `${event.device.name} ${event.device.online ? 'online' : 'offline'}`
    case 'alert':
      return `${event.alert.level}: ${event.alert.message}`
    case 'service':
      return event.service.detail
        ? `${event.service.label} ${event.service.state}: ${event.service.detail}`
        : `${event.service.label} ${event.service.state}`
    case 'redundancy':
      // The status line already says what this machine is and what it has heard; the
      // log adds what it last did about it, which is the part an operator reads back
      // the next morning.
      return event.status.lastEvent
        ? `${event.status.detail}; ${event.status.lastEvent}`
        : event.status.detail
  }
}

/**
 * A device's readout is only what it reported: a wired pack has no RF line and a
 * receiver with telemetry off has no battery, so neither gets a placeholder. The
 * order is fixed so a device's line does not reshuffle as fields come and go.
 */
function describeDevice(device: DeviceState): string {
  const parts: string[] = []
  if (device.battery) {
    parts.push(`${device.battery.percent}%`)
    if (device.battery.minutes !== undefined) parts.push(`≈${device.battery.minutes}m`)
  }
  if (device.rf) parts.push(device.rf.unit === 'dBm' ? `${device.rf.level} dBm` : `${device.rf.level}%`)
  if (device.audio) parts.push(`${device.audio.level}%`)
  if (device.frequency !== undefined) parts.push(`${device.frequency.toFixed(3)} MHz`)
  if (device.audio?.muted) parts.push('muted')
  return parts.join(' ')
}

interface Props {
  onClose: () => void
}

/**
 * What the show is made of right now: the services listening for it, the devices on the
 * network, and the alarms standing against either. What came in and when is history,
 * and history is the log's.
 */
export function MonitorPanel({ onClose }: Props) {
  const services = useStore(s => s.showServices)
  const devices = useStore(s => s.showDevices)
  const alerts = useStore(s => s.showAlerts)
  const dismissAlert = useStore(s => s.dismissAlert)

  // Whether a restart worked is reported by the service's next state event, not by
  // this promise, so there is nothing to show here — but the rejection still has to
  // be handled.
  const restart = (id: string): void => {
    window.winslab.show.restart(id).catch(() => {})
  }

  return (
    <div className="monitor-panel">
      <div className="monitor-header">
        <span className="monitor-title">Show monitor</span>
        <span className="monitor-count">
          {`${services.length} ${services.length === 1 ? 'service' : 'services'} · ${devices.length} ${devices.length === 1 ? 'device' : 'devices'}`}
        </span>
        <div className="monitor-actions">
          <button className="monitor-btn" onClick={onClose} title="Hide monitor">
            ✕
          </button>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="monitor-alerts">
          {alerts.map(alert => (
            <div key={alert.id} className="monitor-alert" data-level={alert.level}>
              <span className="monitor-alert-message">{alert.message}</span>
              <button
                className="monitor-alert-dismiss"
                onClick={() => dismissAlert(alert.id)}
                title="Dismiss alert"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="monitor-body">
        <div className="monitor-column monitor-services">
          <div className="monitor-column-title">Services</div>
          {services.length === 0 ? (
            <div className="monitor-empty">No services.</div>
          ) : (
            services.map(service => (
              <div key={service.id} className="monitor-service" data-state={service.state}>
                <span className="monitor-service-name">{service.label}</span>
                <span className="monitor-service-detail">{service.detail}</span>
                {(service.state === 'failed' || service.state === 'degraded') && (
                  <button
                    className="monitor-service-restart"
                    onClick={() => restart(service.id)}
                    title={`Restart ${service.label}`}
                  >
                    Restart
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="monitor-column monitor-devices">
          <div className="monitor-column-title">Devices</div>
          {devices.length === 0 ? (
            <div className="monitor-empty">No devices.</div>
          ) : (
            devices.map(device => (
              <div key={device.id} className="monitor-device" data-online={String(device.online)}>
                <span className="monitor-device-name">{device.name}</span>
                <span className="monitor-device-readout">{describeDevice(device)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
