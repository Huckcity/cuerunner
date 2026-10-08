// The transport, over OSC: what a tablet, a lighting console or a QLab remote says when it
// wants the show to go, stop or move, rather than to fire one cue a trigger was written for.
//
// Two namespaces are answered, on the port the show already listens on. Cuerunner's own is
// `/cuerunner/…`. QLab's is the bare one — `/go`, `/stop`, `/cue/12/start` — with or without
// the `/workspace/{id}` prefix QLab's own remotes put in front of it, because the port is
// already QLab's (53000) and a remote that was set up for QLab should run this show without
// being reprogrammed. Nothing here is QLab's code: it is the address grammar their published
// OSC dictionary documents, read for interoperability.
//
// The parse is pure and lives in `shared` so the two processes that act on it read one
// grammar: the window runs the transport, and main answers the panic itself, because a panic
// that had to wait for a wedged window would be no use in the case it exists for.

/** What a remote asked the transport to do. A cue is named by its number, as the list shows it. */
export type RemoteCommand =
  | { kind: 'go' }
  | { kind: 'stop' }
  | { kind: 'panic' }
  /** Holds the whole show where it stands, lets it go on, or whichever it is not. */
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'toggle-pause' }
  | { kind: 'select-next' }
  | { kind: 'select-previous' }
  /** Moves the selection to the cue and fires it, as GO from there would. */
  | { kind: 'cue-go'; cue: RemoteCueRef }
  /** Fires the cue where it is, leaving the selection alone. */
  | { kind: 'cue-start'; cue: RemoteCueRef }
  | { kind: 'cue-stop'; cue: RemoteCueRef }
  | { kind: 'cue-select'; cue: RemoteCueRef }
  /** Moves a running audio cue's playhead, seconds into the cue's own region. */
  | { kind: 'cue-seek'; cue: RemoteCueRef; seconds: number }
  /** Holds one playing audio cue, lets it go on, or whichever it is not. */
  | { kind: 'cue-pause'; cue: RemoteCueRef }
  | { kind: 'cue-resume'; cue: RemoteCueRef }
  | { kind: 'cue-toggle-pause'; cue: RemoteCueRef }

/**
 * Which cue a `/cue/…` address names: a number as the list shows it, or the cue the
 * selection is standing on — QLab's `selected` and `playhead`, which in this app are the
 * same cue, the one GO fires next.
 */
export type RemoteCueRef = { by: 'number'; number: string } | { by: 'selected' }

/** The prefix Cuerunner's own namespace lives under. */
export const REMOTE_PREFIX = '/cuerunner'

// QLab's remotes address one workspace by its id; this app has one show open, so the
// prefix names it whatever id it carries.
const WORKSPACE_PREFIX = /^\/workspace\/[^/]+(?=\/)/

/**
 * The verbs, in the forms the two dictionaries write them. QLab writes camelCase
 * (`hardStop`), and remotes built for other apps write it lower-case or with an underscore
 * (`hardstop`, `hard_stop`); the comparison is made on the letters alone so all three are one.
 */
function verb(word: string): string {
  return word.toLowerCase().replace(/[_-]/g, '')
}

/** A numeric argument, from an int, a float or a number written as a string. */
function numberArg(args: ReadonlyArray<{ value: number | string | boolean }>): number | null {
  const first = args[0]
  if (first === undefined) return null
  const value = typeof first.value === 'string' ? Number(first.value) : first.value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function cueRef(segment: string): RemoteCueRef | null {
  if (segment === '') return null
  const lower = segment.toLowerCase()
  if (lower === 'selected' || lower === 'playhead') return { by: 'selected' }
  return { by: 'number', number: segment }
}

/**
 * What an address asks for, or null when it is not a transport address at all — which is
 * most of what a show hears: a console's own state, a fader, a trigger written for one cue.
 *
 * The panic is parsed here like everything else, and it is main's to act on (see
 * `remotePanicFromEvent`); the window leaves it alone.
 */
export function parseRemote(
  address: string,
  args: ReadonlyArray<{ value: number | string | boolean }> = []
): RemoteCommand | null {
  let path = address.replace(WORKSPACE_PREFIX, '')
  if (path === REMOTE_PREFIX || path.startsWith(`${REMOTE_PREFIX}/`)) {
    path = path.slice(REMOTE_PREFIX.length)
  }
  const parts = path.split('/')
  // An address starts with a slash, so the first part is always empty.
  if (parts[0] !== '' || parts.length < 2) return null
  const words = parts.slice(1)

  if (words.length === 1) {
    switch (verb(words[0])) {
      case 'go': return { kind: 'go' }
      case 'stop': return { kind: 'stop' }
      // QLab's hard stop is this app's STOP: everything is cut where it stands.
      case 'hardstop': return { kind: 'stop' }
      case 'panic': return { kind: 'panic' }
      case 'pause': return { kind: 'pause' }
      case 'resume': return { kind: 'resume' }
      // QLab's `togglePause`, and the `pause_toggle` other remotes send.
      case 'togglepause':
      case 'pausetoggle':
        return { kind: 'toggle-pause' }
      default: return null
    }
  }

  if (words.length === 2 && (verb(words[0]) === 'select' || verb(words[0]) === 'playhead')) {
    const which = verb(words[1])
    if (which === 'next') return { kind: 'select-next' }
    if (which === 'previous' || which === 'prev') return { kind: 'select-previous' }
    // QLab's `/select/{number}`: a cue to stand on.
    if (verb(words[0]) === 'select') {
      const cue = cueRef(words[1])
      return cue === null ? null : { kind: 'cue-select', cue }
    }
    return null
  }

  if (words[0] === 'cue' && words.length >= 3) {
    // The number is everything between `/cue/` and the verb: a number with a slash in it
    // is unusual, but it is still the number the operator typed.
    const cue = cueRef(words.slice(1, -1).join('/'))
    if (cue === null) return null
    switch (verb(words[words.length - 1])) {
      case 'go': return { kind: 'cue-go', cue }
      case 'start': return { kind: 'cue-start', cue }
      case 'stop':
      case 'hardstop':
        return { kind: 'cue-stop', cue }
      case 'select': return { kind: 'cue-select', cue }
      case 'pause': return { kind: 'cue-pause', cue }
      case 'resume': return { kind: 'cue-resume', cue }
      case 'togglepause':
      case 'pausetoggle':
        return { kind: 'cue-toggle-pause', cue }
      case 'seek': {
        const seconds = numberArg(args)
        return seconds === null || seconds < 0 ? null : { kind: 'cue-seek', cue, seconds }
      }
      default: return null
    }
  }

  return null
}

/** Whether a show's OSC input answers the transport namespace: on unless it was turned off. */
export function remoteEnabled(oscIn: { remote?: boolean }): boolean {
  return oscIn.remote !== false
}

// ── Who may talk to the show ───────────────────────────────────────────────

/**
 * The host part of a sender as the socket reports it: an IPv4 address that reached a
 * dual-stack socket arrives as `::ffff:10.0.0.5`, which is the same machine the operator
 * typed as `10.0.0.5`.
 */
export function senderHost(address: string): string {
  const trimmed = address.trim()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed)
  return (mapped ? mapped[1] : trimmed).toLowerCase()
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

/**
 * Whether an allowlist entry is one this build can read: an address (`10.0.0.5`, `::1`) or
 * an IPv4 range written as a prefix (`10.0.0.0/24`). The settings field says which entry it
 * cannot read rather than letting one quietly match nothing.
 */
export function isAllowEntry(entry: string): boolean {
  const text = entry.trim()
  if (text === '') return false
  const cidr = /^([\d.]+)\/(\d{1,2})$/.exec(text)
  if (cidr) return ipv4ToNumber(cidr[1]) !== null && Number(cidr[2]) <= 32
  if (ipv4ToNumber(text) !== null) return true
  // An IPv6 address is accepted as written and compared exactly.
  return /^[0-9a-f:]+$/i.test(text) && text.includes(':')
}

function entryMatches(entry: string, host: string): boolean {
  const text = senderHost(entry)
  const cidr = /^([\d.]+)\/(\d{1,2})$/.exec(text)
  if (cidr) {
    const base = ipv4ToNumber(cidr[1])
    const sender = ipv4ToNumber(host)
    const bits = Number(cidr[2])
    if (base === null || sender === null || bits > 32) return false
    if (bits === 0) return true
    const block = 2 ** (32 - bits)
    return Math.floor(base / block) === Math.floor(sender / block)
  }
  return text === host
}

/**
 * Whether a datagram from this sender is the show's to hear. `host` is the address the
 * socket reported, without its port. An empty list is everyone — the show that has not been
 * told otherwise listens to the whole network, as it always has. A list is a closed door to
 * everyone not on it, triggers and remote alike: a sender that may not GO the show may not
 * fire its cues either.
 */
export function senderAllowed(host: string, allowFrom: readonly string[] | undefined): boolean {
  if (allowFrom === undefined || allowFrom.length === 0) return true
  const sender = senderHost(host)
  return allowFrom.some(entry => entryMatches(entry, sender))
}
