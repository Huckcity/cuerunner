// Redundant playback: two machines running the same show, one driving it and one
// standing by to take it over.
//
// Both halves run the whole app. The window owns the cue stack and the audio service
// owns the sound, so what travels between the two machines is state rather than audio:
// which cue is running, how far into its file it has reached, what the operator has
// selected, and whether the two cue lists are the same show. Everything in this file is
// read by both processes — main owns the sockets, the window owns the show, and the two
// must not disagree about what a heartbeat means or how a takeover is worked out.
//
// The protocol is one JSON object per line over TCP. It is deliberately small enough to
// read: a machine says hello with who it is and which half it is configured as, then
// says so again five times a second with the state of its show attached, and either side
// may claim the show by saying it is driving under a higher term than its partner's.

import type { Cue } from '../renderer/src/types/cue'

/** Which half of the pair this machine is configured to be. */
export type RedundancyRole = 'live' | 'standby'

/** What a standby does when the machine driving the show stops answering. */
export type TakeoverMode = 'manual' | 'auto'

/** The wire version. A pair that does not agree on this does not talk. */
export const REDUNDANCY_PROTOCOL = 1

/**
 * How often each machine says it is alive. Five hundred milliseconds is the same beat
 * the app already sends between its window and its main process, and it is short enough
 * that a machine killed mid-number is noticed inside a bar of music.
 */
export const HEARTBEAT_MS = 500

/**
 * How long a partner may be silent before it is declared gone. Three seconds is the
 * timeout the app already gives a window that has stopped answering, for the same
 * reason: long enough to ride out a pause and a burst of work, short enough that the
 * operator hears the show carried on rather than the silence.
 */
export const DEFAULT_TIMEOUT_MS = 3000

/** Below one second a machine is declared dead by its own garbage collection. */
export const MIN_TIMEOUT_MS = 1000
/** Past thirty seconds the backup is decoration: a show depends on hearing the failure. */
export const MAX_TIMEOUT_MS = 30_000

/** The port a partner dials when nobody has chosen one. */
export const DEFAULT_REDUNDANCY_PORT = 53110

/**
 * The longest line either side will believe. A state digest for a large show is a few
 * kilobytes; anything past this is not a partner having a bad day, and buffering it
 * would be the backup being taken down by whoever found the port.
 */
export const MAX_MESSAGE_BYTES = 64 * 1024

/**
 * One machine's half of the arrangement, kept with the machine rather than with the
 * show. Two machines run the same workspace file, so a role or a partner's address
 * written into the show would be read as the same answer by both of them.
 */
export interface RedundancySettings {
  /** Off until the operator asks for it: a pair is a decision, not a default. */
  enabled: boolean
  /** What the partner calls this machine in its status and its log. */
  name: string
  /**
   * Stable for the life of the machine's installation. It is how two sockets between
   * the same pair — each end dials the other — are resolved to one, and how a tie
   * between two machines claiming the show is settled.
   */
  id: string
  role: RedundancyRole
  /** The port this machine listens on for its partner. */
  port: number
  /** The partner's address. Empty means no partner is dialled yet: this machine listens. */
  peerHost: string
  peerPort: number
  /**
   * Shared secret, checked before anything else is believed. Two machines in a venue
   * network may be joined by anything that finds the port; this is the one thing that
   * says the machine at the other end is the one on the other side of the desk.
   */
  token: string
  /** How long the partner may be silent before it is declared gone. */
  timeoutMs: number
  takeover: TakeoverMode
}

export function defaultRedundancySettings(name = '', id = ''): RedundancySettings {
  return {
    enabled: false,
    name,
    id,
    role: 'live',
    port: DEFAULT_REDUNDANCY_PORT,
    peerHost: '',
    peerPort: DEFAULT_REDUNDANCY_PORT,
    token: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    takeover: 'manual'
  }
}

/** Fills in what a machine's own file has never carried, and refuses nonsense. */
export function normalizeRedundancySettings(
  settings: Partial<RedundancySettings> | undefined,
  fallback: { name: string; id: string }
): RedundancySettings {
  const defaults = defaultRedundancySettings(fallback.name, fallback.id)
  const value = settings ?? {}
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : defaults.enabled,
    name: typeof value.name === 'string' && value.name.trim() !== '' ? value.name.trim() : defaults.name,
    id: typeof value.id === 'string' && value.id !== '' ? value.id : defaults.id,
    role: value.role === 'standby' ? 'standby' : 'live',
    port: port(value.port, defaults.port),
    peerHost: typeof value.peerHost === 'string' ? value.peerHost.trim() : defaults.peerHost,
    peerPort: port(value.peerPort, defaults.peerPort),
    token: typeof value.token === 'string' ? value.token : defaults.token,
    timeoutMs: clamp(
      typeof value.timeoutMs === 'number' ? value.timeoutMs : defaults.timeoutMs,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS
    ),
    takeover: value.takeover === 'auto' ? 'auto' : 'manual'
  }
}

function port(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) return fallback
  return value
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.round(value), min), max)
}

/**
 * What one cue looks like to the machine that is standing by: enough to decide whether
 * it can be picked up, and where in its file the show had reached.
 */
export interface MirrorCue {
  cueId: string
  number: string
  name: string
  type: string
  /** The phase the live machine is in. A cue in its post-wait has already done its work. */
  state: 'pre-wait' | 'playing' | 'post-wait'
  /** Position inside the file, ms. Only a cue the engine is playing has one. */
  positionMs: number | null
  durationMs: number | null
}

/**
 * The show itself, as the two machines can compare it. The hash is over cue identity —
 * id, number and name — because that is what a takeover needs to agree on; two machines
 * whose cue lists differ are running different shows and must say so rather than
 * guessing which cue the other one meant.
 */
export interface ShowMirror {
  id: string
  name: string
  /** How many cues the machine has. */
  cues: number
  hash: string
}

/** Everything the partner needs to know about this machine's show. */
export interface RedundancyDigest {
  /**
   * When this machine wrote the digest, ms since its own epoch. It is never compared
   * across machines — the two clocks have no relationship — and is carried so a status
   * can say how old a mirror is on the machine that holds it.
   */
  at: number
  show: ShowMirror
  /** The cue GO would fire next: the operator's place in the show, mirrored. */
  selectedId: string | null
  running: MirrorCue[]
  /** Files this machine has warmed in its audio engine, for a takeover with no wait. */
  prepared: number
}

/**
 * A cheap fingerprint of a cue list. FNV-1a over each cue's identity: it costs nothing
 * on a two-hundred cue show and it is only ever used to say "these are not the same
 * list", never to prove that they are.
 */
export function cueListHash(cues: Array<Pick<Cue, 'id' | 'number' | 'name'>>): string {
  let hash = 0x811c9dc5
  for (const cue of cues) {
    const text = `${cue.id}\u0000${cue.number}\u0000${cue.name}\u0001`
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }
  return hash.toString(16).padStart(8, '0')
}

// ── The wire ─────────────────────────────────────────────────────────────────
//
// Four messages, one JSON object per line. A machine says who it is once, says it is
// still there five times a second with its show attached, refuses a partner it does not
// recognise, and says goodbye on the way out.

export interface HelloMessage {
  t: 'hello'
  protocol: number
  id: string
  name: string
  role: RedundancyRole
  /** Whether this machine is currently the one running the show. */
  driving: boolean
  /** Bumped every time a machine takes the show; the higher term is the one driving. */
  term: number
  token: string
}

export interface BeatMessage {
  t: 'beat'
  seq: number
  term: number
  driving: boolean
  /** The machine's show as it stood when the beat went out. */
  digest: RedundancyDigest | null
}

export interface ByeMessage {
  t: 'bye'
  reason: string
}

export interface RefuseMessage {
  t: 'refuse'
  reason: string
}

export type PeerMessage = HelloMessage | BeatMessage | ByeMessage | RefuseMessage

/** One message, framed for the wire: a line of JSON. */
export function encodeMessage(message: PeerMessage): string {
  return `${JSON.stringify(message)}\n`
}

/**
 * A line as a message, or null when it is anything else. Every field the machine acts
 * on is checked here rather than at the point of use: a partner is a socket, and a
 * socket is not trusted.
 */
export function decodeMessage(line: string): PeerMessage | null {
  if (line.length > MAX_MESSAGE_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const message = value as Partial<PeerMessage>
  switch (message.t) {
    case 'hello':
      return isHello(message) ? message : null
    case 'beat':
      return isBeat(message) ? message : null
    case 'bye':
      return typeof message.reason === 'string' ? { t: 'bye', reason: message.reason } : null
    case 'refuse':
      return typeof message.reason === 'string' ? { t: 'refuse', reason: message.reason } : null
    default:
      return null
  }
}

/** A hello with every field this machine acts on accounted for. */
export function isHello(message: Partial<HelloMessage>): message is HelloMessage {
  return (
    typeof message.protocol === 'number' &&
    typeof message.id === 'string' &&
    message.id !== '' &&
    typeof message.name === 'string' &&
    (message.role === 'live' || message.role === 'standby') &&
    typeof message.driving === 'boolean' &&
    typeof message.term === 'number' &&
    typeof message.token === 'string'
  )
}

function isBeat(message: Partial<BeatMessage>): message is BeatMessage {
  if (typeof message.seq !== 'number' || typeof message.term !== 'number') return false
  if (typeof message.driving !== 'boolean') return false
  if (message.digest === null) return true
  return isDigest(message.digest)
}

function isDigest(value: unknown): value is RedundancyDigest {
  if (typeof value !== 'object' || value === null) return false
  const digest = value as Partial<RedundancyDigest>
  if (typeof digest.at !== 'number') return false
  if (digest.selectedId !== null && typeof digest.selectedId !== 'string') return false
  const show = digest.show as Partial<ShowMirror> | undefined
  if (!show || typeof show.id !== 'string' || typeof show.name !== 'string') return false
  if (typeof show.cues !== 'number' || typeof show.hash !== 'string') return false
  if (typeof digest.prepared !== 'number') return false
  return Array.isArray(digest.running) && digest.running.every(isMirrorCue)
}

function isMirrorCue(value: unknown): value is MirrorCue {
  if (typeof value !== 'object' || value === null) return false
  const cue = value as Partial<MirrorCue>
  return (
    typeof cue.cueId === 'string' &&
    typeof cue.number === 'string' &&
    typeof cue.name === 'string' &&
    typeof cue.type === 'string' &&
    (cue.state === 'pre-wait' || cue.state === 'playing' || cue.state === 'post-wait') &&
    (cue.positionMs === null || typeof cue.positionMs === 'number') &&
    (cue.durationMs === null || typeof cue.durationMs === 'number')
  )
}

/**
 * Which of the two sockets between a pair to keep. Both ends dial each other, so each
 * connection is resolved the same way from the two ids involved — the machine with the
 * lower id keeps the socket it opened, the other keeps the socket it accepted — and the
 * pair ends up agreeing on one connection rather than talking twice.
 */
export function prefersOutgoing(localId: string, remoteId: string): boolean {
  return localId < remoteId
}

// ── What the machine knows about its partner ────────────────────────────────

/** The partner as the operator is shown it: heard from, or not, and with what show. */
export interface PeerStatus {
  id: string
  name: string
  role: RedundancyRole
  driving: boolean
  term: number
  /** How long since anything arrived from the partner, ms, on this machine's clock. */
  silentMs: number
  alive: boolean
  /** Whether the partner has the same cue list open. */
  inSync: boolean
  /** Why the two are not in sync, or what the partner is running — one line. */
  note: string
  /** How many cues the partner says it is running. */
  running: number
  /** How many files the partner has warmed for a takeover. */
  prepared: number
}

/** What the operator is told about this machine and its partner, all in one place. */
export interface RedundancyStatus {
  at: number
  enabled: boolean
  role: RedundancyRole
  name: string
  /** True when this machine is the one running the show. */
  driving: boolean
  term: number
  /** Whether this machine's listener is bound. */
  listening: boolean
  /** The one line the monitor and the settings tab show. */
  detail: string
  peer: PeerStatus | null
  /** What this machine last did about its partner: a takeover, a stand-down, a refusal. */
  lastEvent: string | null
}

/**
 * A takeover, as the machine that decided it tells the window. Carried by the status
 * event that announces it, once, and acted on there: the window has the cue list, so it
 * is the window that works out what can be picked up and puts it back on the engine.
 */
export interface TakeoverNotice {
  at: number
  /** How long the partner had been silent when the decision was made. */
  silentMs: number
  /** What the live machine last reported, or null if it never reported anything. */
  digest: RedundancyDigest | null
  /** 'the live machine stopped answering' or 'the operator took the show'. */
  reason: string
  /** The term this machine claimed. The renderer adopts once per term. */
  term: number
}

/**
 * Whether the two machines have the same show. It is a comparison of the mirror the
 * partner publishes: the same workspace id, the same number of cues and the same
 * identity hash. Anything else means a takeover would be guessing, so it is said out
 * loud rather than hidden behind "connected".
 */
export function syncVerdict(
  local: RedundancyDigest | null,
  peer: RedundancyDigest | null
): { inSync: boolean; note: string } {
  if (!peer) return { inSync: false, note: 'no show reported yet' }
  if (!local) return { inSync: false, note: 'this machine has no show open' }
  if (local.show.id !== peer.show.id) {
    return { inSync: false, note: `a different show is open: "${peer.show.name}"` }
  }
  if (local.show.cues !== peer.show.cues || local.show.hash !== peer.show.hash) {
    return {
      inSync: false,
      note: `the cue lists differ (${local.show.cues} here, ${peer.show.cues} there) — save the show on the live machine`
    }
  }
  return { inSync: true, note: `${peer.show.cues} cues, the same show` }
}

/** What the machine has heard from its partner, as the service tracks it. */
export interface PeerFacts {
  hello: HelloMessage | null
  digest: RedundancyDigest | null
  /** The local clock reading of the last message of any kind from the partner. */
  lastHeardAt: number
  /** Whether the partner has ever been heard this session. */
  everHeard: boolean
}

export function peerStatus(
  facts: PeerFacts,
  local: { digest: RedundancyDigest | null; now: number; timeoutMs: number }
): PeerStatus | null {
  const hello = facts.hello
  if (!hello) return null
  const silentMs = Math.max(0, local.now - facts.lastHeardAt)
  const sync = syncVerdict(local.digest, facts.digest)
  return {
    id: hello.id,
    name: hello.name,
    role: hello.role,
    driving: hello.driving,
    term: hello.term,
    silentMs,
    alive: silentMs <= local.timeoutMs,
    inSync: sync.inSync,
    note: sync.note,
    running: facts.digest?.running.length ?? 0,
    prepared: facts.digest?.prepared ?? 0
  }
}

/**
 * Whether this machine should take the show. A standby takes it over when a partner it
 * had been hearing goes quiet, which is why a machine that has never heard anyone does
 * not seize a show nobody is running: there is nothing to pick up, and an idle backup
 * that starts driving on its own is a worse failure than one that says it is alone.
 */
export function shouldTakeOver(input: {
  enabled: boolean
  role: RedundancyRole
  takeover: TakeoverMode
  driving: boolean
  peerEverHeard: boolean
  peerAlive: boolean
}): boolean {
  if (!input.enabled) return false
  if (input.takeover !== 'auto') return false
  if (input.role !== 'standby' || input.driving) return false
  return input.peerEverHeard && !input.peerAlive
}

// ── Deterministic takeover ──────────────────────────────────────────────────

/** One cue the backup will put back on its own engine, at the position it had reached. */
export interface AdoptEntry {
  cueId: string
  number: string
  name: string
  /** How far into the cue's own region the cue is placed, ms. */
  seekMs: number
}

/** A cue that could not be picked up, and the reason the operator is given. */
export interface SkippedEntry {
  cueId: string
  label: string
  reason: string
}

/** What a takeover does, worked out before anything is fired. */
export interface TakeoverPlan {
  silentMs: number
  adopt: AdoptEntry[]
  skipped: SkippedEntry[]
  /** The cue the live machine had selected, when this machine has it too. */
  selectedId: string | null
  /** One line for the session log. */
  note: string
}

/**
 * What the backup can pick up.
 *
 * Only sound is carried forward: an audio cue the live machine was playing is placed at
 * the position it had reached, plus however long the machine has been quiet — the
 * position was true when the last beat arrived, and the show has been running since.
 * Everything else is named rather than faked. A MIDI or OSC cue has already reached its
 * desk and re-sending it would be a second note; a wait, a fade or a script was mid-way
 * through work that lives in the machine that died; a cue in its post-wait has already
 * finished and the show's next GO belongs to the cue after it. None of that is a
 * failure of the takeover, and all of it is written down.
 */
export function takeoverPlan(
  cues: Array<Pick<Cue, 'id' | 'number' | 'name' | 'type' | 'startTime' | 'duration'>>,
  digest: RedundancyDigest | null,
  silentMs: number
): TakeoverPlan {
  const adopt: AdoptEntry[] = []
  const skipped: SkippedEntry[] = []
  const quietMs = Number.isFinite(silentMs) ? Math.max(0, silentMs) : 0
  const running = digest?.running ?? []

  for (const entry of running) {
    const label = `${entry.number} · ${entry.name}`
    const cue = cues.find(candidate => candidate.id === entry.cueId)
    if (!cue) {
      skipped.push({ cueId: entry.cueId, label, reason: 'this machine does not have that cue' })
      continue
    }
    // The cue's type comes before its phase: nothing could ever pick a one-shot cue up
    // mid-flight, so that is the reason the operator is given even when the live machine
    // also had it half way through a post-wait.
    if (cue.type !== 'audio') {
      skipped.push({
        cueId: cue.id,
        label,
        reason: `a ${cue.type} cue that has already gone out cannot be picked up`
      })
      continue
    }
    if (entry.state === 'post-wait') {
      skipped.push({ cueId: cue.id, label, reason: 'it had finished and was waiting to hand over' })
      continue
    }
    if (entry.state === 'pre-wait') {
      skipped.push({ cueId: cue.id, label, reason: 'it had not started yet' })
      continue
    }
    if (entry.positionMs === null || !Number.isFinite(entry.positionMs)) {
      skipped.push({ cueId: cue.id, label, reason: 'the live machine never reported a position' })
      continue
    }

    const reached = entry.positionMs + quietMs
    // A cue that had reached its end before the takeover would have been silent here
    // anyway; starting it would be a sound the live machine never made.
    const length = cue.duration > 0 ? cue.duration : entry.durationMs
    if (typeof length === 'number' && length > 0 && reached >= cue.startTime + length) {
      skipped.push({ cueId: cue.id, label, reason: 'it had reached its end before the takeover' })
      continue
    }

    adopt.push({
      cueId: cue.id,
      number: entry.number,
      name: entry.name,
      seekMs: Math.max(0, reached - cue.startTime)
    })
  }

  const selectedId = digest?.selectedId && cues.some(cue => cue.id === digest.selectedId)
    ? digest.selectedId
    : null

  return {
    silentMs: quietMs,
    adopt,
    skipped,
    selectedId,
    note: describeTakeover(adopt, skipped, quietMs)
  }
}

/**
 * The line the operator reads after a takeover. It says what was picked up, what was
 * not, and how much of the show had gone by unheard — the three things that decide
 * whether the next GO is where they think it is.
 */
export function describeTakeover(adopt: AdoptEntry[], skipped: SkippedEntry[], silentMs: number): string {
  const quiet = `took the show over ${(silentMs / 1000).toFixed(1)} s after the live machine went quiet`
  if (adopt.length === 0 && skipped.length === 0) return `${quiet}; nothing was running`
  const picked = adopt.length === 0
    ? 'nothing was picked up'
    : `${adopt.length} ${adopt.length === 1 ? 'cue' : 'cues'} picked up at its position`
  if (skipped.length === 0) return `${quiet}; ${picked}`
  return `${quiet}; ${picked}, ${skipped.length} not: ${skipped.map(entry => entry.label).join(', ')}`
}
