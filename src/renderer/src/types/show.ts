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

/** One transmitter, and the receiver channel it is patched to. */
export interface RfPack {
  id: string
  label: string
  /** Channel id as the telemetry reports it, or null when nothing feeds this pack. */
  channelId: string | null
  performerId: string | null
  notes: string
}

// ── Scenes: who is on, and what that does to the desk ───────────────────────
//
// A scene is who is open on stage. Recalling one tells the desk the difference: only the
// groups whose state actually changes are sent, so a scene recall is a handful of
// messages rather than a slam of every fader on the desk.

/**
 * One DCA's open or close, ready for the transport that carries it.
 *
 * A MIDI one is a *sequence* rather than a message: what a desk takes as "open this fader"
 * is the desk's own arrangement, and on an SQ it is four NRPN controllers where the app's
 * generic convention sends one note.
 */
export type DeskMessage =
  | { kind: 'midi'; portName: string; messages: MidiMessageKind[] }
  | { kind: 'midi-tcp'; host: string; port: number; messages: MidiMessageKind[] }
  | { kind: 'osc'; host: string; port: number; address: string; args: number[] }

// ── The desk: how the show reaches it, and what it is told ──────────────────
//
// One connection for the whole show. A DCA's message is derived from its number, so a
// twelve-mic show is not twelve patches to type — which is what makes a new show runnable
// before anything has been configured: a strip drives the DCA of its number, and a DCA is
// sent the note or address of its own.

export type DeskKind = 'none' | 'midi' | 'osc' | 'midi-tcp'

/**
 * What the desk takes as an open and as a close.
 *
 * `note` is the app's own arrangement — a note on to open, a note off to close — and what
 * a desk nobody has asked about takes. `sq` and `avantis` are the two ranges whose
 * documents have been read: an SQ mutes with NRPN on page 02 and has eight DCAs, an
 * Avantis mutes with a note-on whose velocity says which half of the pair it is, on the
 * channel four above its own.
 */
export type DeskProfile = 'note' | 'sq' | 'avantis'

/**
 * The desk's own buttons, as the desk numbers its mute groups.
 *
 * A console reports a key press only when the key does something the console can name, so
 * the buttons a show runs from are mute groups: one is assigned to a key at the desk, the
 * key toggles it, and the desk transmits the mute the group would have sent anyway. A mute
 * group is what a theatre show has spare — the muting is done with DCAs — so a show pays
 * nothing for it, and the operator presses a button on the desk with no MIDI setup at all.
 *
 * Both are null on a desk nobody has set up, and on a show run from the window.
 */
export interface DeskButtons {
  /** The mute group assigned to the desk's GO button. */
  go: number | null
  /** The mute group assigned to the desk's BACK button. */
  back: number | null
}

/**
 * Where the desk is and how it is spoken to. The address of the desk itself is the one
 * thing the app cannot know, so it is a field rather than a guess; everything else has a
 * default that works.
 */
export interface DeskSettings {
  kind: DeskKind
  /**
   * What the desk takes as an open and a close. A workspace saved before profiles existed
   * has none, and the migration fills in `note` — which is what that show was already
   * sending, so an update moves nothing on the desk.
   */
  profile: DeskProfile
  /** MIDI output port, when the show drives the desk over MIDI. */
  midiPort: string
  /**
   * The desk's MIDI channel, 1–16 as the desk's own setup screen shows it. Where the DCAs
   * are addressed is derived from it, because that is the desk's rule and not the
   * operator's: an Avantis answers for its DCAs four channels above its own.
   */
  midiChannel: number
  /** Desk address for the kinds that reach it over the network. */
  host: string
  /** OSC port. */
  port: number
  /**
   * MIDI-over-TCP port. 51325 is what an SQ and an Avantis both serve their MIDI on, and
   * it is the only port either documents — so a show pointed at a desk needs no more
   * than its address.
   */
  tcpPort: number
  /**
   * The address a DCA is sent to, `{n}` standing in for its number: "/dca/{n}/on". A
   * pattern with no `{n}` in it has the number appended.
   */
  address: string
  /**
   * The desk's own buttons. Optional on disk: a workspace saved before a desk could be run
   * from has none, and the migration fills in a show with no buttons — which is what it had.
   */
  buttons: DeskButtons
}

/** A DCA on the desk: a number, what the show calls it, and how it is driven. */
export interface Dca {
  id: string
  /** What the show calls it: "DCA 2", or "Chorus" when it is a group's fader. */
  label: string
  /**
   * What this DCA is addressed by on the desk, instead of the number its place derives:
   * the note on a desk that takes notes, the NRPN parameter on an SQ. Null is derived.
   */
  note: number | null
  /** The address to send to instead of the one its number derives. Null is derived. */
  address: string | null
}

/**
 * Who is open in one scene.
 *
 * An applied ensemble is membership rather than a copy of it: adding a performer to the
 * chorus puts them in every scene the chorus is applied to. A member a scene closes
 * anyway is an exclusion, so the two stay independent — which is what keeps a scene a
 * handful of decisions instead of a roster.
 */
export interface MicScene {
  id: string
  name: string
  /** Performers open here on their own, whether or not they are in an ensemble. */
  live: string[]
  /** The ensembles applied here: every member is open unless this scene excludes them. */
  ensembles: string[]
  /** Members of an applied ensemble this scene closes anyway. */
  excluded: string[]
  notes: string
}

export interface ScenesSettings {
  list: MicScene[]
}

// ── Channels, the cast and the desk ─────────────────────────────────────────
//
// A show is set up in four lists: the channels on the console, the performers on stage
// and where their mics are patched, the ensembles that group them, and the DCAs the desk
// is told to open and close. Scenes runs that setup and says who is open in each scene;
// nothing here moves the desk on its own.

/**
 * A channel strip on the console: one input, named for what is on the other end of it.
 * Its number is its place in the list, so a show that starts with twelve has twelve of
 * them and adding one appends the thirteenth.
 */
export interface ShowChannel {
  id: string
  /** What the console calls the strip: a performer, an instrument, a position. */
  name: string
  /**
   * The DCA it drives. A strip starts on the DCA of its own number — the mic-per-fader
   * arrangement a wireless show is set up as — and one that shares a fader with others is
   * assigned by hand.
   */
  dcaId: string | null
}

/**
 * One performer: a role in the show, not a physical mic. Which pack they are currently
 * wearing is the plot's business (`RfPack.performerId`); where their mic is patched is
 * theirs, and the DCA that opens for them is their channel's — so a performer keeps the
 * same desk routing across a pack swap, because the desk never knew packs were involved.
 */
export interface Performer {
  id: string
  name: string
  role: string
  notes: string
  /** The channel their mic is patched to, or null while they are not on the desk yet. */
  channelId: string | null
}

/**
 * A named group of performers — the chorus, the band. It is a grouping and nothing else:
 * it exists to be applied to a scene so a handful of mics move together, and it is not
 * desk routing, which is the channel's business. Membership is the list here rather than
 * a pointer on each performer, because a performer can belong to more than one ensemble
 * and an ensemble that is deleted should take its membership with it.
 */
export interface Ensemble {
  id: string
  name: string
  members: string[]
}

/**
 * The show's setup: the channels on the console, who is in the cast and where their mics
 * are patched, the ensembles that group them, and the DCAs those channels open.
 */
export interface CastSettings {
  channels: ShowChannel[]
  performers: Performer[]
  ensembles: Ensemble[]
  dcas: Dca[]
}

export interface RfPlot {
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
  /** How the show reaches the desk, and what a DCA's own number means to it. */
  desk: DeskSettings
  rf: RfSettings
  presence: PresenceSettings
  script: ScriptSettings
  companion: CompanionSettings
  scenes: ScenesSettings
  cast: CastSettings
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
    // No packs and no sources: an operator who wants either adds it, and the demo rack
    // is one click away for anyone who wants to see what the panel does.
    plot: { packs: [] },
    sources: [],
    swaps: [],
    thresholds: defaultRfThresholds()
  }
}

/** How many DCAs a show can drive, and how many a channel drives by its number. */
export const DCA_LIMIT = 12
export const CHANNEL_START_COUNT = 12

/**
 * What a DCA's own number sounds like on a desk that has never been told otherwise: the
 * DCA is opened and closed at one address, the way most desks take a mute, and it is the
 * address that carries the number.
 */
export const DEFAULT_DESK_ADDRESS = '/dca/{n}/on'
export const DEFAULT_DESK_PORT = 8000
/** The MIDI-over-TCP port both Allen & Heath ranges document, and serve. */
export const DEFAULT_DESK_TCP_PORT = 51325

/**
 * The scene that is always in the view and never in the file: every mic closed. It is
 * what a desk wants pressed between numbers, and it is not a scene anyone edits because
 * there is nothing in an empty stage to move into or out of it.
 */
export const ALL_CLOSED_SCENE_ID = 'all-closed'

/**
 * The desk a show starts pointed at. Its own address is the one thing the app cannot
 * know — the desk is somewhere in the room — so this is the local machine, and the port
 * and the address pattern are what an operator changes once.
 */
export function defaultDeskSettings(): DeskSettings {
  return {
    kind: 'osc',
    // A desk nobody has described takes the arrangement this app has always sent: one
    // note, on to open and off to close. Naming the range is how an operator says which
    // desk is actually in the room.
    profile: 'note',
    midiPort: '',
    midiChannel: 1,
    host: '127.0.0.1',
    port: DEFAULT_DESK_PORT,
    tcpPort: DEFAULT_DESK_TCP_PORT,
    address: DEFAULT_DESK_ADDRESS,
    // A desk nobody has assigned a button on: the show runs from the window until the
    // operator says which mute group their GO key is.
    buttons: { go: null, back: null }
  }
}

/** The DCAs a new show drives: twelve of them, labelled by number. */
export function startingDcas(): Dca[] {
  return Array.from({ length: DCA_LIMIT }, (_, index) => ({
    id: crypto.randomUUID(),
    label: `DCA ${index + 1}`,
    note: null,
    address: null
  }))
}

/**
 * The twelve strips a new show opens on, each driving the DCA of its own number: a mic
 * per fader, which is what a wireless show is, so nothing has to be assigned before the
 * first scene moves the desk.
 */
export function startingChannels(dcas: Dca[]): ShowChannel[] {
  return Array.from({ length: CHANNEL_START_COUNT }, (_, index) => ({
    id: crypto.randomUUID(),
    name: '',
    dcaId: dcas[index]?.id ?? null
  }))
}

/** A show with nobody cast yet still has a console, wired to a desk and to itself. */
export function defaultCastSettings(): CastSettings {
  const dcas = startingDcas()
  return { channels: startingChannels(dcas), performers: [], ensembles: [], dcas }
}

export function defaultShowSettings(): ShowSettings {
  return {
    oscIn: { enabled: true, port: DEFAULT_OSC_IN_PORT },
    // No port can be assumed to exist, and opening every input would answer to the
    // whole room's traffic. The operator picks the ports.
    midiIn: { enabled: false, portNames: [] },
    desk: defaultDeskSettings(),
    rf: defaultRfSettings(),
    presence: defaultPresenceSettings(),
    script: defaultScriptSettings(),
    companion: defaultCompanionSettings(),
    scenes: defaultScenesSettings(),
    cast: defaultCastSettings()
  }
}

export function defaultScriptSettings(): ScriptSettings {
  return { path: '', fontSize: 13 }
}

/** A show with no scenes still has a desk; the list starts empty rather than guessed at. */
export function defaultScenesSettings(): ScenesSettings {
  return { list: [] }
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
  const cast = settings?.cast
  return {
    oscIn: { ...defaults.oscIn, ...settings?.oscIn },
    midiIn: { ...defaults.midiIn, ...settings?.midiIn },
    desk: {
      ...defaults.desk,
      ...settings?.desk,
      // A desk section written before a desk could be run from has no buttons, and one
      // half-filled by hand gets the other half: a button nobody assigned is null.
      buttons: { ...defaults.desk.buttons, ...settings?.desk?.buttons }
    },
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
      // A scene written before ensembles existed has an empty excluded list and no
      // ensembles applied — which reads exactly as it behaved.
      list: (settings?.scenes?.list ?? defaults.scenes.list).map(scene => ({
        ...scene,
        ensembles: scene.ensembles ?? [],
        excluded: scene.excluded ?? []
      }))
    },
    cast: {
      channels: cast?.channels ?? defaults.cast.channels,
      performers: cast?.performers ?? defaults.cast.performers,
      ensembles: cast?.ensembles ?? defaults.cast.ensembles,
      // A DCA written before overrides existed carries the messages it sent; the
      // migration reads those into the connection and these two fields.
      dcas: (cast?.dcas ?? defaults.cast.dcas).map(dca => ({
        id: dca.id,
        label: dca.label,
        note: dca.note ?? null,
        address: dca.address ?? null
      }))
    }
  }
}
