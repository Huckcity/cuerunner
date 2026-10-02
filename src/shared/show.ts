import type { MidiMessageKind, OscArg } from './cue'
import type { RedundancyStatus } from './redundancy'

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
  /** Operator-facing, e.g. "listening on port 53000" or "Shure API unreachable". */
  detail: string
  since: number
  error?: string
}

export interface ServiceEvent {
  kind: 'service'
  at: number
  service: ServiceStatus
}

// ── Redundant playback: the machine on the other side of the desk ────────────
//
// A second machine runs the same show and stands by to take it over when this one stops
// answering. What it has heard and what it is doing arrives as an event like everything
// else, so the monitor, the log and the settings tab read one object rather than three
// half-answers.

export interface RedundancyEvent {
  kind: 'redundancy'
  at: number
  /**
   * Everything the machine has to say, including the last change in who is driving —
   * `status.lastNotice`. It travels inside the status rather than beside it because the
   * window that has to act on it may have been reloading when it was made, and only the
   * status is still there afterwards.
   */
  status: RedundancyStatus
}

export type ShowEvent =
  | OscInEvent
  | MidiInEvent
  | DeviceEvent
  | AlertEvent
  | ServiceEvent
  | RedundancyEvent
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

// ── Scenes: who rides what, and what that does to the desk ──────────────────
//
// A scene says which of the show's controlled channels ride which fader. Recalling one
// tells the desk the difference in two facts: the membership first, then the mic's mute —
// and only for the channels the scene moves, so a recall is a handful of messages rather
// than a slam of every fader on the desk.

/**
 * One write the desk is asked for, ready for the transport that carries it.
 *
 * A MIDI one is a *sequence* rather than a message: what a desk takes as "open this fader"
 * is the desk's own arrangement, and on an SQ it is four NRPN controllers where the app's
 * generic convention sends one note.
 *
 * `sq-native` is not a message at all: the SQ's membership is written over the desk's own
 * control service by the main process, whose codec owns those frames, so the renderer sends
 * the intent — which channel, which fader, placed or cleared, and whether the channel rides
 * any fader after this write (the per-channel flag the capture measures).
 */
export type DeskMessage =
  | { kind: 'midi'; portName: string; messages: MidiMessageKind[] }
  | { kind: 'midi-tcp'; host: string; port: number; messages: MidiMessageKind[] }
  | { kind: 'osc'; host: string; port: number; address: string; args: number[] }
  | ({ kind: 'sq-native' } & SqMembershipIntent)

/**
 * One (channel, fader) pair as the SQ's native control service is asked to write it — the
 * intent the renderer sends, and the only thing it knows about those frames.
 *
 * Both numbers are 1-based as the show reads them (the strip's own number, the fader's own
 * number); the codec in main subtracts the one each frame carries. `rides` is the
 * per-channel flag: whether the channel rides any fader after this write, which the desk
 * keeps per channel rather than per pair.
 */
export interface SqMembershipIntent {
  /** The controlled channel's own number: its place in the show's channel list. */
  channel: number
  /** The fader's own number on the desk. */
  dca: number
  /** Whether this pair is being placed, or cleared. */
  placed: boolean
  /** Whether the channel rides any fader after this write. */
  rides: boolean
}

/** What the SQ's own service answers a membership write with. */
export interface SqMembershipAnswer {
  ok: boolean
  /** How many frames went out, when they did. */
  frames?: number
  /** Why nothing went, when nothing did. */
  error?: string
}

// ── The desk: how the show reaches it, and what it is told ──────────────────
//
// One connection for the whole show. What a fader is told is derived from its number, so a
// twelve-mic show is not twelve patches to type — which is what makes a new show runnable
// before anything has been configured: a fader carries the number its place derives, and an
// override says so where the desk numbers its DCAs differently. A mic's mute is the
// channel's own number, which is why the mute follows the profile's *channel* map rather
// than its fader map.

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
 * The desk's own buttons, as the desk numbers its mute groups and its notes.
 *
 * A console reports a key press only when the key does something the console can name, so
 * the buttons a show runs from are mute groups: one is assigned to a key at the desk, the
 * key toggles it, and the desk transmits the mute the group would have sent anyway. A mute
 * group is what a theatre show has spare — the muting is done with DCAs — so a show pays
 * nothing for it, and the operator presses a button on the desk with no MIDI setup at all.
 *
 * A key that latches is not always what a GO means, though: an SQ's soft key set to a MIDI
 * note transmits note on at `7F` and note off at `00` while the key is held, so a press
 * steps the show and nothing is left lit at the desk. The notes are the same fields one
 * route over: a number is a mute group where the key toggles one, and a MIDI note where the
 * key sends one. A note is only offered on a desk whose own traffic cannot be a note — the
 * app's DCA mutes are notes on an Avantis and on a `note` desk, and NRPN on an SQ.
 *
 * All four are null on a desk nobody has set up, and on a show run from the window.
 */
export interface DeskButtons {
  /** The mute group assigned to the desk's GO button. */
  go: number | null
  /** The mute group assigned to the desk's BACK button. */
  back: number | null
  /** The MIDI note the desk's GO key transmits, where the key sends one. */
  goNote: number | null
  /** The MIDI note the desk's BACK key transmits. */
  backNote: number | null
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
   * has none, and this build reads no such file: a desk section is read as it was written,
   * and `note` is what `defaultDeskSettings` gives a show that has never had one.
   */
  profile: DeskProfile
  /** MIDI output port, when the show drives the desk over MIDI. */
  midiPort: string
  /**
   * The desk's MIDI channel, 1–16 as the desk's own setup screen shows it.
   *
   * A recall addresses a mic's mute and its assignment on this channel, because that is
   * where every range puts its inputs. The block four channels above it — an Avantis's DCAs
   * and mute groups — is the desk's own: it is what a show's buttons are read from, and
   * nothing a recall writes goes there.
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
   * The address a mic's mute is sent to, `{n}` standing in for the channel's own number:
   * "/dca/{n}/on". A pattern with no `{n}` in it has the number appended. It carries a
   * *channel*'s number and never a fader's — a mute belongs to the mic (AD-26).
   */
  address: string
  /**
   * The desk's own buttons. Every field of the desk section is one the file carries: the
   * shape check reads the settings in both directions, so a document without this one is
   * refused rather than handed to a window that would read it.
   */
  buttons: DeskButtons
}

/**
 * A DCA on the desk: a fader, whose name is its place in the show.
 *
 * A fader is a number and nothing else — the fourth fader of the show is its fourth fader in
 * every scene and every copy of the show, and the grid, the log and the inspector all say it
 * the same way. A name would be a second identity to keep in step with the number the desk
 * is actually told, and the operator reads the number at the desk anyway.
 *
 * The desk number is what the fader is addressed by where the show's own numbering is not
 * the desk's — an SQ numbers its DCAs from zero, an Avantis calls its first one 36 — and
 * null is the number its place derives. It is one number for every route to that fader,
 * because it is the desk's fact and not the transport's.
 */
export interface Dca {
  id: string
  /**
   * What this DCA is addressed by on the desk, in the profile's own numbering, instead of
   * the number its place derives. Null is derived.
   */
  deskNumber: number | null
}

/**
 * The one thing a row of a scene holds: a channel of the console, or an ensemble over some
 * of them.
 *
 * Which of the two `kind` names decides what `memberId` points at. There is one member and
 * not a list because a row means one thing: several channels on one fader is what an
 * ensemble *is*, and what a scene says is the sum of what its rows each hold.
 */
export interface RowMember {
  kind: 'channel' | 'ensemble'
  /** The channel, or the ensemble, that `kind` names. */
  memberId: string
}

/**
 * What one scene does with one fader: the one thing it puts on it.
 *
 * A placement is the scene's own, and an ensemble placed on a row is membership rather than
 * a copy of it — a member added to the chorus rides every row the chorus is on, and a row
 * holding an ensemble opens all of it. Nothing that means two things can be written here,
 * so no edit has to choose and no recall has to decide which of them wins.
 *
 * A row holding nothing is not in the list at all: an empty row is a shell, and a scene that
 * speaks for a fader it has nothing to say about is one nobody can read.
 */
export interface SceneDcaPlacement extends RowMember {
  /** The fader this row is. */
  dcaId: string
}

/**
 * Who rides what in one scene.
 *
 * A scene owns the assignment: it says which channels ride which fader, and a channel it
 * names nowhere is closed. There is no scene-wide "who is open" list — a controlled channel
 * is open exactly when the scene places it, which is what makes a DCA a control group rather
 * than a mute group.
 */
export interface MicScene {
  id: string
  name: string
  /** The faders this scene speaks for, and the one thing it holds on each. */
  dcas: SceneDcaPlacement[]
  notes: string
}

export interface ScenesSettings {
  list: MicScene[]
  /**
   * Whether a channel may ride more than one fader. On by default: a show with a chorus and
   * a band shares channels all the time. Off, the editor keeps one fader per channel and a
   * recall collapses any residual duplicate to the lowest-numbered DCA.
   */
  allowDuplicateAssignment: boolean
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
 *
 * A strip is a name and a number and nothing else: which fader it rides is the scene's
 * decision (AD-26), so there is no assignment on the channel at all.
 */
export interface ShowChannel {
  id: string
  /** What the console calls the strip: a performer, an instrument, a position. */
  name: string
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
 * A named group of strips — the chorus, the band. It is a grouping and nothing else: it
 * exists to be put on a scene row so a handful of mics move together, and it is not desk
 * routing, which is the channel's business.
 *
 * It holds strips rather than the people standing on them, because a group is a set of
 * faders: the show's cast may be nobody at all — a rack of playback channels is a group too
 * — and a group has to be buildable the moment a show has strips in it. What it opens is
 * what those strips open; a strip that leaves the console leaves every group it was in.
 * Membership is the list here rather than a pointer on each channel, because a channel can
 * belong to more than one group and a group that is deleted should take its membership with
 * it.
 */
export interface Ensemble {
  id: string
  name: string
  channelIds: string[]
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

export type TelemetrySourceKind = 'demo' | 'http' | 'file' | 'ew-dx'

export interface TelemetrySource {
  id: string
  label: string
  kind: TelemetrySourceKind
  /** URL for `http`, path for `file`, the receiver's address for `ew-dx`. Unused by `demo`, which is generated in-process. */
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
 * How many strips a show can drive where no desk profile states a ceiling: the widest
 * number any profile states, so the count control has a range to offer without the app
 * inventing one. A desk that does state its own inputs bounds the control instead, and a
 * show larger than either is reported rather than truncated.
 */
export const CHANNEL_LIMIT = 96

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
    // operator says which mute group or note their GO key is.
    buttons: { go: null, back: null, goNote: null, backNote: null }
  }
}

/** The DCAs a new show drives: twelve of them, numbered by their place. */
export function startingDcas(): Dca[] {
  return Array.from({ length: DCA_LIMIT }, (_, index) => ({
    // A fader is a position on the desk rather than an identity: the third DCA of a show
    // is its third DCA in every copy of that show. Minting a random id here was the one
    // thing that made two files of the same show differ — a show opened on two machines
    // and saved grew a diff over nothing — and nothing is keyed by these ids across
    // files: a show's cast, its scenes and its plot all travel in the same file.
    id: `dca-${index + 1}`,
    // The number its place derives is the number the profile's own map gives it, so a
    // show that has never been set up is addressed correctly on whatever desk it is on.
    deskNumber: null
  }))
}

/**
 * The twelve strips a new show opens on: a mic per fader, which is what a wireless show
 * is. Which fader each one rides is the scene's, so a new show's strips are placed by the
 * scenes that name them rather than by the strip itself.
 */
export function startingChannels(): ShowChannel[] {
  return Array.from({ length: CHANNEL_START_COUNT }, (_, index) => ({
    id: `channel-${index + 1}`,
    name: ''
  }))
}

/** A show with nobody cast yet still has a console, wired to a desk and to itself. */
export function defaultCastSettings(): CastSettings {
  return { channels: startingChannels(), performers: [], ensembles: [], dcas: startingDcas() }
}

/** What a show with nothing configured carries: one section per setting, each at its default. */
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

/**
 * The settings a document is read as: the sections it carries, over this build's defaults for
 * the ones it leaves out — which is the document the window holds, because no load fills a
 * section in and the window is where a file without one is completed. What compares or blends
 * two documents reads both sides through here, so a file that has never written a section is
 * not spelled as that whole section changing, and a document a merge builds carries the
 * sections this build declares rather than an empty settings object it would refuse.
 */
export function heldShowSettings(settings: ShowSettings | undefined): ShowSettings {
  return { ...defaultShowSettings(), ...settings }
}

export function defaultScriptSettings(): ScriptSettings {
  return { path: '', fontSize: 13 }
}

/** A show with no scenes still has a desk; the list starts empty rather than guessed at. */
export function defaultScenesSettings(): ScenesSettings {
  return { list: [], allowDuplicateAssignment: true }
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
