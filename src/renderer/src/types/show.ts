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
 * What the show has done to this channel, kept for the report read the next morning.
 *
 * It is a group of its own rather than part of `battery` on purpose: a channel that has
 * gone quiet publishes no reading — nobody is hearing it — but it still has a night
 * behind it, and that is precisely the pack someone wants to ask about.
 */
export interface DeviceHistory {
  /** The lowest battery percent seen since the app started, once one has been reported. */
  lowestPercent?: number
  /** When that reading was taken. */
  lowestAt?: number
  /** How many times this channel has gone quiet. */
  dropouts: number
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
  /** What the night has done to this channel, once anything has been heard from it. */
  history?: DeviceHistory
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
  /**
   * The desk channel this mic feeds — the DCA or input it is grouped under — or null when
   * the show does not drive the desk from here. Optional on disk: a plot saved before
   * scenes existed has none.
   */
  deskChannelId?: string | null
}

// ── Scenes: who is on, and what that does to the desk ───────────────────────
//
// A scene is who is open on stage. Recalling one tells the desk the difference: only the
// groups whose state actually changes are sent, so a scene recall is a handful of
// messages rather than a slam of every fader on the desk.

export type DeskMessage =
  | { kind: 'midi'; portName: string; message: MidiMessageKind }
  | { kind: 'osc'; host: string; port: number; address: string; args: number[] }

/** A group on the desk — a DCA, a mute group — and how it is opened and closed. */
export interface DeskChannel {
  id: string
  /** What the desk calls it: "DCA 2 — Ensemble". */
  label: string
  /** How the desk is told to close it. Null leaves the group alone on a recall. */
  mute: DeskMessage | null
  /** How the desk is told to open it. */
  unmute: DeskMessage | null
}

export interface MicScene {
  id: string
  name: string
  /** The packs that are open in this scene. Everything else the plot knows about closes. */
  live: string[]
  notes: string
}

export interface ScenesSettings {
  channels: DeskChannel[]
  list: MicScene[]
  /**
   * Locked for the performance: the matrix still recalls scenes, and nothing in the show
   * can be edited — a stray click at curtain up must not change who is open.
   */
  locked: boolean
}

export interface RfPlot {
  performers: RfPerformer[]
  packs: RfPack[]
}

/**
 * A pack changing hands. Recorded because the show report is read the next morning, and
 * "who was wearing 12 at 20:14" is a question a swap log answers and a live panel cannot.
 */
export interface RfSwap {
  at: number
  packId: string
  packLabel: string
  /**
   * Names as they were when the swap happened: renaming someone in the plot afterwards
   * must not rewrite what the report says happened on the night.
   */
  from: string | null
  to: string | null
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
  /** The swaps made this session, newest last, capped. */
  swaps: RfSwap[]
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
  presence: PresenceSettings
  script: ScriptSettings
  companion: CompanionSettings
  scenes: ScenesSettings
}

// ── The script, and the tablet reading it ───────────────────────────────────
//
// A script lives open beside the cue stack, and cues are pinned to the lines they fire
// on. The companion serves that view — and the running order with it — over the local
// network, so the tablet on the music stand needs no app of its own.

export interface ScriptSettings {
  /** Path to the script document. Empty means none is loaded. */
  path: string
  /** Point size in the panel and on the companion, so it reads from a music stand. */
  fontSize: number
}

/**
 * What the script panel is given when it asks for a document: its lines, or the reason
 * it cannot be shown. The refusal is a result rather than an error because "that PDF is
 * not a script" is a thing to put on the screen, not a failure to recover from.
 */
export type ScriptDocument =
  | { ok: true; lines: string[] }
  | { ok: false; error: string }

export interface CompanionSettings {
  enabled: boolean
  port: number
  /**
   * Shared secret carried in the URL. Anyone on the network with it can watch the show;
   * nobody without it can, and nothing on the companion can change anything.
   */
  token: string
}

/** What the tablet is shown. Published by the renderer, served by the companion. */
export interface CompanionCue {
  id: string
  number: string
  name: string
  type: string
  parentId: string | null
  /** Line of the script this cue fires on, when it is pinned to one. */
  scriptLine: number | null
}

export interface CompanionState {
  /** When this snapshot was published, so a stale page can say so. */
  at: number
  workspaceName: string
  /** The cue GO would fire next. */
  nextCue: CompanionCue | null
  running: Array<{ id: string; number: string; name: string; state: string }>
  cues: CompanionCue[]
  script: { path: string; lines: string[] } | null
  alerts: Array<{ id: number; level: AlertLevel; message: string }>
}

// ── Presence: what is on the show network ───────────────────────────────────
//
// Some of the show is only ever visible as a name on the network: an audio interface,
// a Dante endpoint, an amplifier. None of them answer a poll, so the service browses
// for them the way the machine already does, and reports what answers and what stops.

export interface PresenceSettings {
  enabled: boolean
  /**
   * mDNS service types to browse. The defaults are what Dante devices advertise; any
   * other gear a show uses can be added by its own service type.
   */
  services: string[]
  /** Seconds without an announcement before a device counts as gone. */
  goneAfterSeconds: number
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
    swaps: [],
    thresholds: defaultRfThresholds()
  }
}

export function defaultShowSettings(): ShowSettings {
  return {
    oscIn: { enabled: true, port: DEFAULT_OSC_IN_PORT },
    // No port can be assumed to exist, and opening every input would answer to the
    // whole room's traffic. The operator picks the ports.
    midiIn: { enabled: false, portNames: [] },
    rf: defaultRfSettings(),
    presence: defaultPresenceSettings(),
    script: defaultScriptSettings(),
    companion: defaultCompanionSettings(),
    scenes: defaultScenesSettings()
  }
}

export function defaultScriptSettings(): ScriptSettings {
  return { path: '', fontSize: 13 }
}

/** A show with no scenes still has a desk; the list starts empty rather than guessed at. */
export function defaultScenesSettings(): ScenesSettings {
  return { channels: [], list: [], locked: false }
}

/** The companion is off until it is asked for: it puts the show on the network. */
export function defaultCompanionSettings(): CompanionSettings {
  return { enabled: false, port: 53100, token: '' }
}

/** Browsing the network is off until the operator asks for it: it is the noisiest
 *  service here, and a show that has no Dante in it should not have the traffic. */
export function defaultPresenceSettings(): PresenceSettings {
  return {
    enabled: false,
    services: ['_netaudio-arc._udp.local', '_netaudio-cmc._udp.local'],
    goneAfterSeconds: 30
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
      swaps: rf?.swaps ?? defaults.rf.swaps,
      thresholds: { ...defaults.rf.thresholds, ...rf?.thresholds }
    },
    presence: { ...defaults.presence, ...settings?.presence },
    script: { ...defaults.script, ...settings?.script },
    companion: { ...defaults.companion, ...settings?.companion },
    scenes: {
      channels: settings?.scenes?.channels ?? defaults.scenes.channels,
      list: settings?.scenes?.list ?? defaults.scenes.list,
      locked: settings?.scenes?.locked ?? defaults.scenes.locked
    }
  }
}
