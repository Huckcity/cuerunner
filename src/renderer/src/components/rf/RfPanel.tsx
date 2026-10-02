import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import type { DeviceState, RfPack, RfPlot, RfThresholds, ShowAlert } from '../../../../shared/show'
import { demoPacks, demoPerformers, demoSource } from '../../utils/rfDemo'
import { buildReport, reportText } from '../../utils/rfPlot'
import { formatClock } from '../../utils/cueDefaults'
import './RfPanel.css'

export type RfPackState = 'ok' | 'low' | 'critical' | 'offline' | 'silent' | 'unpatched'

// Sorting is the point of the panel: the pack in trouble is the one you see first.
// A dying pack outranks a silent one — it still needs a swap before the next entrance —
// and two kinds of silence are told apart: a pack whose channel nothing has reported
// yet is waiting (the rack is still booting, or the transmitter is off), while one the
// service has aged out is gone. A pack with no channel at all is a patch waiting to be
// made, so it sinks to the bottom rather than reading as trouble.
const BAND_ORDER: Record<RfPackState, number> = {
  critical: 0,
  offline: 1,
  silent: 2,
  low: 3,
  ok: 4,
  unpatched: 5
}

// The rf service names every device after the channel it reports, so a pack finds its
// telemetry by the channel id alone.
const RF_DEVICE_PREFIX = 'rf:'

/** True for an alarm raised against a wireless channel rather than the wider show. */
export function isRfAlert(alert: ShowAlert): boolean {
  return alert.deviceId?.startsWith(RF_DEVICE_PREFIX) ?? false
}

// dBm is negative and the useful band is narrow: -90 is open circuit and -40 is the
// transmitter sitting on the receiver's antenna. Pinning the window keeps two packs
// comparable at a glance instead of rescaling the bars per row. Whole percents only:
// the bar and the number beside it must not disagree over floating-point dust.
export function rfPercent(dbm: number): number {
  return Math.round(Math.min(100, Math.max(0, ((dbm + 90) / 50) * 100)))
}

/**
 * A pack's band, first match wins. No channel at all is unpatched — a patch waiting to
 * be made, not an alarm. A channel nothing has reported for is silent: the pack exists
 * and is assigned, and hearing nothing from it is a fact rather than a verdict. An
 * offline device is the service's own verdict — it already waited out
 * `offlineAfterSeconds` — so the panel does no ageing of its own. A pack that is present
 * but in trouble is critical.
 */
export function packState(
  pack: RfPack,
  device: DeviceState | undefined,
  thresholds: RfThresholds
): RfPackState {
  if (!pack.channelId) return 'unpatched'
  // Assigned but nothing heard yet: the honest reading is "waiting", not "unpatched" —
  // the pack exists and someone is wearing it.
  if (!device) return 'silent'
  if (!device.online) return 'offline'
  if (device.battery && device.battery.percent <= thresholds.batteryCritical) return 'critical'
  if (
    (device.battery && device.battery.percent <= thresholds.batteryWarning) ||
    (device.rf && (device.rf.weak ?? device.rf.level <= thresholds.rfWarningDbm))
  ) {
    return 'low'
  }
  return 'ok'
}

/** One bar: the fill carries its own percentage so the CSS has nothing to compute. */
function Bar({ percent }: { percent: number }) {
  return (
    <span className="rf-bar-track">
      <span className="rf-bar" data-level={percent} style={{ width: `${percent}%` }} />
    </span>
  )
}

// A reading the device did not report leaves the cell empty rather than drawing a
// zero-height bar beside a zero: absence is not a measurement.
function batteryCell(device: DeviceState | undefined) {
  const percent = device?.battery?.percent
  if (percent === undefined) return null
  return (
    <>
      <Bar percent={percent} />
      <span className="rf-bar-value">{percent}%</span>
    </>
  )
}

function rfCell(device: DeviceState | undefined) {
  const rf = device?.rf
  if (!rf) return null
  return (
    <>
      <Bar percent={rfPercent(rf.level)} />
      <span className="rf-bar-value">{rf.unit === 'dBm' ? `${rf.level} dBm` : `${rf.level}%`}</span>
    </>
  )
}

/**
 * The readout line is only what the transmitter reported: a channel with no frequency
 * or mute state shows nothing rather than a placeholder, and the order is fixed so a
 * row does not reshuffle as fields come and go.
 */
function readout(device: DeviceState | undefined): string {
  const parts: string[] = []
  if (device?.frequency !== undefined) parts.push(`${device.frequency.toFixed(3)} MHz`)
  if (device?.audio?.muted) parts.push('muted')
  return parts.join(' ')
}

interface Props {
  onClose: () => void
}

export function RfPanel({ onClose }: Props) {
  const rf = useStore(s => s.showSettings.rf)
  const cast = useStore(s => s.showSettings.cast)
  const devices = useStore(s => s.showDevices)
  const alerts = useStore(s => s.showAlerts)
  const updateRfSettings = useStore(s => s.updateRfSettings)
  const updateCastSettings = useStore(s => s.updateCastSettings)
  const dismissAlert = useStore(s => s.dismissAlert)
  const appendLog = useStore(s => s.appendLog)

  // Two views of the same plot: what the packs are doing now, and what the night did to
  // them. The second one is what gets read the next morning, so it is a view rather
  // than something you have to export before closing the app.
  const [mode, setMode] = useState<'live' | 'report'>('live')
  const openShowSettings = useStore(s => s.openShowSettings)
  // The plot editor is a tab of Show Settings rather than a second dialog over this
  // panel: a pack assignment is show content, and everything that edits the show's setup
  // is edited in one place.
  const editPlot = (): void => openShowSettings('mic-plot')

  const report = useMemo(
    () => buildReport(rf.plot, cast.performers, devices, rf.swaps),
    [rf.plot, cast.performers, devices, rf.swaps]
  )

  const copyReport = (): void => {
    navigator.clipboard.writeText(reportText(report, Date.now())).catch(() => {
      // A clipboard the app cannot reach is worth saying once, in the log where the
      // operator will look if the paste comes out empty.
      appendLog([{ level: 'error', message: 'Could not copy the wireless report to the clipboard' }])
    })
  }

  // Only the alarms raised against a wireless channel belong here; the monitor keeps
  // the rest of the show's troubles.
  const rfAlerts = alerts.filter(isRfAlert)

  const plot: RfPlot = rf.plot
  // The plot is who is wearing what, and it is optional: a channel that is reporting but is
  // in no pack's plot is still a pack somebody can see, under the name its receiver gives
  // it, until they decide it is worth a performer. Without this a receiver found on the
  // network would show nothing at all until a plot had been typed in.
  const claimed = new Set(plot.packs.flatMap(pack => (pack.channelId ? [RF_DEVICE_PREFIX + pack.channelId] : [])))
  const strays: RfPack[] = devices
    .filter(device => device.service === 'rf' && device.id.startsWith(RF_DEVICE_PREFIX) && !claimed.has(device.id))
    .map(device => ({
      id: device.id,
      label: device.name,
      channelId: device.id.slice(RF_DEVICE_PREFIX.length),
      performerId: null,
      notes: ''
    }))
  const rows = [...plot.packs, ...strays]
    .map((pack, index) => {
      const channelId = pack.channelId
      const device = channelId
        ? devices.find(d => d.id === RF_DEVICE_PREFIX + channelId)
        : undefined
      return { pack, index, device, state: packState(pack, device, rf.thresholds), inPlot: index < plot.packs.length }
    })
    // A stable sort keeps a band's packs in plot order: a row only moves when its own
    // band changes, never because a neighbour's did.
    .sort((a, b) => BAND_ORDER[a.state] - BAND_ORDER[b.state] || a.index - b.index)

  // The demo rack is offered only while the plot is empty — it is how the feature is
  // seen before there is a show, not a control the show needs — so it brings its own
  // cast and packs, and replaces the source list rather than adding a rack beside a
  // real one.
  const addDemo = (): void => {
    updateRfSettings({ sources: [demoSource()], plot: { packs: demoPacks() } })
    updateCastSettings({ performers: demoPerformers(cast.channels) })
  }

  return (
    <div className="rf-panel">
      <div className="rf-header">
        <span className="rf-title">Wireless</span>
        <span className="rf-count">{rows.length === 0 ? 'empty' : `${rows.length} packs`}</span>
        <div className="rf-actions">
          <button
            className="rf-btn rf-mode"
            data-active={mode === 'report'}
            onClick={() => setMode(current => current === 'live' ? 'report' : 'live')}
            title={mode === 'live' ? 'What the night did to each pack' : 'Back to live readings'}
          >
            {mode === 'live' ? 'Report' : 'Live'}
          </button>
          {mode === 'report' && (
            <button className="rf-btn rf-copy" onClick={copyReport} title="Copy the report">
              Copy
            </button>
          )}
          <button
            className="rf-btn rf-edit"
            onClick={editPlot}
            title="Who is wearing which pack, and who is in the cast"
          >
            Edit plot…
          </button>
          <button className="rf-btn" onClick={onClose} title="Hide wireless">
            ✕
          </button>
        </div>
      </div>

      {rfAlerts.length > 0 && (
        <div className="rf-alerts">
          {rfAlerts.map(alert => (
            <div key={alert.id} className="rf-alert" data-level={alert.level}>
              <span className="rf-alert-message">{alert.message}</span>
              <button
                className="rf-alert-dismiss"
                onClick={() => dismissAlert(alert.id)}
                title="Dismiss alert"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rf-list">
        {mode === 'report' ? (
          report.length === 0 ? (
            <div className="rf-empty">
              <span>No packs in the plot yet. Enter the cast and their packs to keep a report.</span>
            </div>
          ) : (
            report.map(row => (
              <div key={row.packId} className="rf-report-row">
                <span className="rf-report-label">{row.label}</span>
                <span className="rf-report-who">{row.performer ?? 'unassigned'}</span>
                <span className="rf-report-role">{row.role ?? ''}</span>
                <span className="rf-report-battery">
                  {row.lowestPercent === null
                    ? 'no reading'
                    : `lowest ${row.lowestPercent}%${row.lowestAt === null ? '' : ` at ${formatClock(row.lowestAt)}`}`}
                </span>
                <span className="rf-report-dropouts">
                  {row.dropouts === 0
                    ? 'no dropouts'
                    : `${row.dropouts} dropout${row.dropouts === 1 ? '' : 's'}`}
                </span>
                <span className="rf-report-swaps">
                  {row.swaps.length === 0
                    ? ''
                    : `${row.swaps.length} swap${row.swaps.length === 1 ? '' : 's'}`}
                </span>
              </div>
            ))
          )
        ) : rows.length === 0 ? (
          <div className="rf-empty">
            <span>No packs in the plot. Enter them, or load the demo rack.</span>
            <button className="rf-edit-btn" onClick={editPlot}>
              Edit plot…
            </button>
            <button className="rf-demo-btn" onClick={addDemo}>
              Add demo rack
            </button>
          </div>
        ) : (
          rows.map(({ pack, device, state, inPlot }) => {
            const performer = cast.performers.find(p => p.id === pack.performerId)
            return (
              <div key={pack.id} className="rf-row" data-state={state} data-plot={inPlot}>
                <span className="rf-name">{pack.label}</span>
                {/* A channel in no plot has no one to be unassigned from: saying so on a
                    show with no plot at all would be noise on every row. */}
                <span className="rf-performer">{inPlot ? (performer?.name ?? 'unassigned') : ''}</span>
                <span className="rf-role">{performer?.role ?? ''}</span>
                <span className="rf-battery">{batteryCell(device)}</span>
                <span className="rf-rf">{rfCell(device)}</span>
                <span className="rf-readout">{readout(device)}</span>
                <span className="rf-notes">{pack.notes}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
