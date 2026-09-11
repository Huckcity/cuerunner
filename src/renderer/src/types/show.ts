import type { MidiMessageKind, OscArg } from './cue'

// The show services are everything around the cue stack: the devices on stage, the
// consoles they talk to, and the alarms when one of them stops answering. Everything
// a service learns arrives here as one of these events, so the renderer has a single
// shape to render whether the news came over OSC, MIDI, a polled HTTP API or mDNS.

export interface OscInEvent {
  kind: 'osc'
  at: number
  /** Sender address, as far as the socket knows it: "192.168.1.24:8000". */
  from: string
  address: string
  args: OscArg[]
}

export interface MidiInEvent {
  kind: 'midi'
  at: number
  /** Input port name the message arrived on. */
  device: string
  message: MidiMessageKind
}

export type AlertLevel = 'info' | 'warning' | 'critical'

export interface ShowAlert {
  id: number
  at: number
  level: AlertLevel
  /** Service id, so an alarm can be traced back to the thing that raised it. */
  source: string
  message: string
  deviceId?: string
}

export interface AlertEvent {
  kind: 'alert'
  at: number
  alert: ShowAlert
}

/** A battery reading from a transmitter, scaled by whatever the receiver reports. */
export interface BatteryState {
  /** 0-100. */
  percent: number
  /** Runtime left, when the device estimates one. */
  minutes?: number
  charging?: boolean
}

/**
 * A device as the show sees it right now. Optional groups are present only when the
 * device reports that measurement — a wired IEM pack has no RF reading, and a receiver
 * whose battery telemetry is off has no battery.
 */
export interface DeviceState {
  /** Stable across polls and restarts: "<service>:<hardware id>". */
  id: string
  service: string
  name: string
  model?: string
  online: boolean
  lastSeen: number
  battery?: BatteryState
  /** Signal strength, in the unit the device reports it in. */
  rf?: { level: number; unit: 'dBm' | 'percent' }
  /** Audio level for the channel, 0-100, in the unit the device reports it in. */
  audio?: { level: number; muted?: boolean }
  /** Carrier frequency in MHz. */
  frequency?: number
  /** Anything else worth showing in the panel, already formatted. */
  detail?: Record<string, string>
}

export interface DeviceEvent {
  kind: 'device'
  at: number
  device: DeviceState
}

export type ServiceState = 'stopped' | 'starting' | 'running' | 'degraded' | 'failed'

export interface ServiceStatus {
  id: string
  label: string
  state: ServiceState
  /** Operator-facing, e.g. "listening on 0.0.0.0:53000" or "Shure API unreachable". */
  detail: string
  since: number
  error?: string
}

export interface ServiceEvent {
  kind: 'service'
  at: number
  service: ServiceStatus
}

export type ShowEvent = OscInEvent | MidiInEvent | DeviceEvent | AlertEvent | ServiceEvent
export type ShowEventKind = ShowEvent['kind']

/** What the renderer gets when it asks for the current world, not the history of it. */
export interface ShowSnapshot {
  /** When the snapshot was taken: a renderer discards events older than this. */
  at: number
  services: ServiceStatus[]
  devices: DeviceState[]
  alerts: ShowAlert[]
  events: ShowEvent[]
}

export interface OscInSettings {
  enabled: boolean
  port: number
}

export interface MidiInSettings {
  enabled: boolean
  /** Input port names to open. Empty with `enabled` means every port. */
  portNames: string[]
}

// ── Wireless: the mic plot and the telemetry behind it ──────────────────────
//
// The plot is who wears what, and it is workspace content — it travels with the show.
// The telemetry is what the transmitters are doing right now, and it arrives from a
// source: a rack simulated in the main process, a JSON endpoint, or a file a bridge
// writes. Any receiver that can be made to emit the document below shows up here, and
// the alarms that matter — a pack about to die on someone with an entrance — are raised
// against the plot rather than against a channel number.

/** One performer: who is wearing a pack, and in which role. */
export interface RfPerformer {
  id: string
  name: string
  role: string
  notes: string
}

/** One transmitter, and the receiver channel it is patched to. */
export interface RfPack {
  id: string
  label: string
  /** Channel id as the telemetry reports it, or null when nothing feeds this pack. */
  channelId: string | null
  performerId: string | null
  notes: string
}

export interface RfPlot {
  performers: RfPerformer[]
  packs: RfPack[]
}

export interface RfThresholds {
  /** Percent at or below which a pack is worth watching. */
  batteryWarning: number
  /** Percent at or below which a pack has to come off its performer. */
  batteryCritical: number
  /** dBm at or below which the RF path is failing. */
  rfWarningDbm: number
  /** Seconds without a report before a channel counts as gone. */
  offlineAfterSeconds: number
}

export type TelemetrySourceKind = 'demo' | 'http' | 'file'

export interface TelemetrySource {
  id: string
  label: string
  kind: TelemetrySourceKind
  /** URL for `http`, path for `file`. Unused by `demo`, which is generated in-process. */
  target: string
  pollMs: number
  timeoutMs: number
}

/**
 * The shape a source has to produce: `{ "channels": [ ... ] }`. These field names are
 * the contract — a bridge that emits them needs no further configuration, and a source
 * that reports nothing for a field simply leaves that reading out.
 */
export interface TelemetryChannel {
  id: string
  name?: string
  batteryPercent?: number
  batteryMinutes?: number
  charging?: boolean
  rfDbm?: number
  audioLevel?: number
  muted?: boolean
  frequencyMhz?: number
}

export interface TelemetryDocument {
  channels: TelemetryChannel[]
}

export interface RfSettings {
  plot: RfPlot
  sources: TelemetrySource[]
  thresholds: RfThresholds
}

/** The demo rack's channel ids, so the simulated rack and the demo plot agree. */
export const DEMO_SOURCE_ID = 'demo-rack'
export const DEMO_PACK_COUNT = 12
export function demoChannelId(index: number): string {
  return `demo-pack-${index}`
}

export const DEFAULT_POLL_MS = 2000
export const DEFAULT_TIMEOUT_MS = 1500

export interface ShowSettings {
  oscIn: OscInSettings
  midiIn: MidiInSettings
  rf: RfSettings
}

/** QLab listens for OSC on 53000, and so does every operator who has ever patched one. */
export const DEFAULT_OSC_IN_PORT = 53000

/** Twenty percent is worth a swap before the next entrance; ten percent dies mid-line. */
export function defaultRfThresholds(): RfThresholds {
  return {
    batteryWarning: 25,
    batteryCritical: 10,
    rfWarningDbm: -75,
    offlineAfterSeconds: 6
  }
}

export function defaultRfSettings(): RfSettings {
  return {
    // No plot and no sources: an operator who wants either adds it, and the demo rack
    // is one click away for anyone who wants to see what the panel does.
    plot: { performers: [], packs: [] },
    sources: [],
    thresholds: defaultRfThresholds()
  }
}

export function defaultShowSettings(): ShowSettings {
  return {
    oscIn: { enabled: true, port: DEFAULT_OSC_IN_PORT },
    // No port can be assumed to exist, and opening every input would answer to the
    // whole room's traffic. The operator picks the ports.
    midiIn: { enabled: false, portNames: [] },
    rf: defaultRfSettings()
  }
}

/** Fills in a section a workspace saved by an older build never wrote. */
export function normalizeShowSettings(settings: Partial<ShowSettings> | undefined): ShowSettings {
  const defaults = defaultShowSettings()
  const rf = settings?.rf
  return {
    oscIn: { ...defaults.oscIn, ...settings?.oscIn },
    midiIn: { ...defaults.midiIn, ...settings?.midiIn },
    rf: {
      plot: { ...defaults.rf.plot, ...rf?.plot },
      sources: rf?.sources ?? defaults.rf.sources,
      thresholds: { ...defaults.rf.thresholds, ...rf?.thresholds }
    }
  }
}
