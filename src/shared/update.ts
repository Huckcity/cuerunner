// Updating the app, as a show tool has to: the operator decides, and the show decides first.
//
// A show machine is a machine whose sound must not stop, so the rules here are the opposite of
// a consumer app's. Nothing is downloaded or installed while anything in the show is running,
// nothing restarts the app but the operator, and the one thing that happens on its own is the
// install a quit was going to do anyway. A machine with no network is an ordinary machine —
// backstage often has none — so a check that cannot reach the server says nothing at all, and
// an update whose bytes or signature do not match what was published is refused with a sentence
// rather than installed.
//
// Everything in this module is plain data and pure functions: the lockout window, which install
// can replace itself, and what an updater's failure means. Main runs the updater; the window
// draws what main reports.

/**
 * Where the update feed is: the download host the site's cards point at. The release pipeline
 * writes each platform's `latest*.yml` here beside the installers (`.github/workflows/build.yml`,
 * the mirror step), and each feed names its files under that release's own immutable
 * `versions/<tag>/` folder, so a feed and the file it names cannot come from two releases.
 */
export const UPDATE_FEED_URL = 'https://pub.cuerunner.app/latest/'

/**
 * What each platform's updater reads from the feed, and which file it installs from what that
 * feed offers. These are electron-updater's own choices — the channel file its provider asks for
 * on that platform, and the extension its updater looks for — written down so the release
 * pipeline, the suite's fake feed and the app agree on them, and held to the library's real
 * provider by `src/main/update/platformFeed.test.ts`.
 *
 * Windows reads `latest.yml` and installs the NSIS `.exe`; macOS reads `latest-mac.yml` and
 * installs the `.zip` (Squirrel replaces an app from a zip of it, never from the dmg beside it);
 * Linux reads `latest-linux.yml` and installs the AppImage, passing over the .deb the same feed
 * lists. A 64-bit ARM Linux machine reads `latest-linux-arm64.yml`, which this pipeline does not
 * publish: its check finds no release and says nothing.
 */
export const PLATFORM_FEEDS = {
  win32: { feed: 'latest.yml', installs: 'exe', passesOver: [] as string[] },
  darwin: { feed: 'latest-mac.yml', installs: 'zip', passesOver: ['pkg', 'dmg'] },
  linux: { feed: 'latest-linux.yml', installs: 'AppImage', passesOver: ['rpm', 'deb', 'pacman'] }
} as const

export type FeedPlatform = keyof typeof PLATFORM_FEEDS

/** The feed facts for a platform this app ships on, or null for one it does not. */
export function platformFeed(platform: string): (typeof PLATFORM_FEEDS)[FeedPlatform] | null {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux' ? PLATFORM_FEEDS[platform] : null
}

/** Where an operator whose copy cannot replace itself is sent: the site's download section. */
export const UPDATE_DOWNLOAD_PAGE = 'https://cuerunner.app/#download'

/** How long after launch the first check runs, so it never competes with a show being opened. */
export const UPDATE_LAUNCH_DELAY_MS = 20_000

/** How often the daily check asks whether a day has passed. */
export const UPDATE_TICK_MS = 60 * 60 * 1000

/** A day: how stale the last check may be before the next one runs. */
export const UPDATE_DAILY_MS = 24 * 60 * 60 * 1000

/** The longest release notes the window is handed: anything past this is cut, not refused. */
export const UPDATE_NOTES_MAX_CHARS = 64 * 1024

/**
 * How this copy of the app was installed, which decides whether it can replace itself.
 * The three the release pipeline publishes a feed for can (`nsis`, `dmg`, `appimage`); a
 * system package belongs to the package manager that installed it, and a build run out of a
 * source tree belongs to whoever is building it.
 */
export type UpdateInstall = 'nsis' | 'dmg' | 'appimage' | 'deb' | 'rpm' | 'pacman' | 'development' | 'unknown'

/** Whether an install of this kind downloads and installs its own updates. */
export function canSelfUpdate(install: UpdateInstall): boolean {
  return install === 'nsis' || install === 'dmg' || install === 'appimage'
}

/**
 * Why an install of this kind does not replace itself, in the sentence the window shows; null
 * for the kinds that do.
 */
export function selfUpdateRefusal(install: UpdateInstall): string | null {
  switch (install) {
    case 'deb':
      return 'This copy was installed from the .deb package, which cannot replace itself: download the new .deb and install it over this one. Your settings stay where they are.'
    case 'rpm':
    case 'pacman':
      return 'This copy was installed by the system’s package manager, which cannot be bypassed: install the new version the way this one was installed.'
    case 'development':
      return 'This is a development build, run from its source tree: it updates when the source does.'
    case 'unknown':
      return 'This copy was not installed by one of Cuerunner’s installers, so it cannot replace itself: download the new version and install it.'
    default:
      return null
  }
}

/** A time of day, as the settings carry it: `HH:MM`, 24-hour, this machine's local time. */
export type ClockTime = string

/** The machine's update settings: kept beside the licence, never in a show. */
export interface UpdateSettings {
  /** Check on launch and once a day. Off means only the operator's own Check now. */
  check: boolean
  /** A window of the day when nothing is checked at all — the hours the show runs. */
  lockout: {
    enabled: boolean
    from: ClockTime
    to: ClockTime
  }
  /** No checks while a show file is open in Show Mode. */
  lockInShowMode: boolean
}

export function defaultUpdateSettings(): UpdateSettings {
  return {
    check: true,
    lockout: { enabled: false, from: '18:00', to: '23:30' },
    lockInShowMode: true
  }
}

/** Minutes past midnight for an `HH:MM`, or null for anything that is not one. */
export function parseClockTime(text: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim())
  if (match === null) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** `HH:MM` for minutes past midnight. */
export function formatClockTime(minutes: number): ClockTime {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * The settings as this build reads them, from whatever a file held: every field its own kind
 * and range, and a field that is not falls back to the default rather than refusing the file —
 * a machine with a damaged settings file still checks, which is the safe direction.
 */
export function normalizeUpdateSettings(stored: unknown): UpdateSettings {
  const defaults = defaultUpdateSettings()
  const record = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const raw = record(stored)
  const lockout = record(raw.lockout)
  const time = (value: unknown, fallback: ClockTime): ClockTime => {
    if (typeof value !== 'string') return fallback
    const minutes = parseClockTime(value)
    return minutes === null ? fallback : formatClockTime(minutes)
  }
  return {
    check: typeof raw.check === 'boolean' ? raw.check : defaults.check,
    lockout: {
      enabled: typeof lockout.enabled === 'boolean' ? lockout.enabled : defaults.lockout.enabled,
      from: time(lockout.from, defaults.lockout.from),
      to: time(lockout.to, defaults.lockout.to)
    },
    lockInShowMode: typeof raw.lockInShowMode === 'boolean' ? raw.lockInShowMode : defaults.lockInShowMode
  }
}

/** Whether a minute of the day falls in a window that may run past midnight. Empty when from = to. */
export function inClockWindow(minute: number, from: number, to: number): boolean {
  if (from === to) return false
  return from < to ? minute >= from && minute < to : minute >= from || minute < to
}

/** What the window last told main about the show: the facts the rules are decided on. */
export interface UpdateShowState {
  /** A cue is running, paused or waiting: the show is not idle. */
  busy: boolean
  /** The window is in Show Mode. */
  showMode: boolean
  /** The show in the window is a file on disk, rather than a new untitled one. */
  showOpen: boolean
}

export function idleShowState(): UpdateShowState {
  return { busy: false, showMode: false, showOpen: false }
}

/**
 * Why checks are locked out at this moment, as the sentence the window shows, or null when
 * they are not. The time window is the machine's local clock; Show Mode counts only with a
 * show file open, because an empty window in Show Mode is nobody's show.
 */
export function lockoutReason(settings: UpdateSettings, minuteOfDay: number, show: UpdateShowState): string | null {
  if (settings.lockout.enabled) {
    const from = parseClockTime(settings.lockout.from)
    const to = parseClockTime(settings.lockout.to)
    if (from !== null && to !== null && inClockWindow(minuteOfDay, from, to)) {
      return `Update checks are locked out from ${settings.lockout.from} to ${settings.lockout.to}.`
    }
  }
  if (settings.lockInShowMode && show.showMode && show.showOpen) {
    return 'Update checks are locked out while a show file is open in Show Mode.'
  }
  return null
}

/** The sentence a download or an install meets while the show is running. */
export const HELD_FOR_SHOW =
  'Held: something in the show is running. Nothing is downloaded or installed during a show — ask again once the show is idle.'

/** The sentence a download meets when the show starts under it. */
export const STOPPED_FOR_SHOW =
  'The download stopped because the show started. Nothing was installed; ask for it again once the show is idle.'

/** Where the update stands, as the window draws it. */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'held'
  | 'refused'
  | 'offline'
  | 'failed'

/** A newer version the feed offers. */
export interface AvailableUpdate {
  version: string
  /** The release notes the feed carries, as Markdown; empty when it carries none. */
  notes: string
  releaseDate: string | null
}

/** Everything the window draws about updates, pushed by main whenever it changes. */
export interface UpdateStatus {
  /** The version running now. */
  current: string
  install: UpdateInstall
  phase: UpdatePhase
  available: AvailableUpdate | null
  /** 0–1 while downloading, null when the size is not known yet. */
  progress: number | null
  /** The sentence the phase carries: why it is held, refused, offline or failed. */
  message: string | null
  /** When the last check that reached the server finished, epoch ms. */
  lastCheckedAt: number | null
  /** Why checks are locked out right now, or null. */
  lockout: string | null
  settings: UpdateSettings
}

/** What an updater's failure is, for the rule that decides what the operator is told. */
export type UpdateFailureKind = 'offline' | 'missing' | 'integrity' | 'signature' | 'fault'

export interface UpdateFailure {
  kind: UpdateFailureKind
  /** The sentence for the operator. */
  sentence: string
}

/** The network failures that mean "no connection", by code or by Chromium's net error. */
const OFFLINE_CODES = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ECONNABORTED'
]

const OFFLINE_PATTERN =
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_[A-Z_]+|NETWORK_[A-Z_]+|TIMED_OUT|ADDRESS_UNREACHABLE|PROXY_[A-Z_]+|TUNNEL_CONNECTION_FAILED|EMPTY_RESPONSE|SSL_[A-Z_]+|CERT_[A-Z_]+)|socket hang up|getaddrinfo|HttpError: 5\d\d|status code 5\d\d|\b50[234]\b/i

/** The first line of a message, bounded, for a sentence that has to quote one. */
function firstLine(message: string): string {
  const line = message.split('\n')[0].trim()
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

/**
 * What a failure the updater raised means. `code` is electron-updater's own (`ERR_…`) or the
 * socket's; the message is read as well because Squirrel on macOS and Chromium's network stack
 * say what happened only in words.
 */
export function classifyUpdateFailure(error: { code?: unknown; message?: unknown } | null | undefined): UpdateFailure {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : String(error ?? '')
  if (code === 'ERR_CHECKSUM_MISMATCH' || code === 'ERR_UPDATER_NO_CHECKSUM' || /checksum mismatch/i.test(message)) {
    return {
      kind: 'integrity',
      sentence:
        'Refused: the download did not match the checksum its release published, so it was deleted and nothing was installed.'
    }
  }
  if (
    code === 'ERR_UPDATER_INVALID_SIGNATURE' ||
    /not signed by the application owner|code ?signature|did not pass validation|SQRLCodeSignature|signature verification/i.test(message)
  ) {
    return {
      kind: 'signature',
      sentence:
        'Refused: the update is not signed by the publisher this copy was signed by, so it was deleted and nothing was installed.'
    }
  }
  if (OFFLINE_CODES.includes(code) || OFFLINE_CODES.some(each => message.includes(each)) || OFFLINE_PATTERN.test(message)) {
    return { kind: 'offline', sentence: 'The update server could not be reached, so nothing was checked.' }
  }
  if (
    code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' ||
    code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' ||
    /\b404\b/.test(message)
  ) {
    return { kind: 'missing', sentence: 'The update server has no release for this platform yet.' }
  }
  return { kind: 'fault', sentence: `The update could not be checked: ${firstLine(message) || 'the updater gave no reason'}.` }
}

/** Notes cut to what the window is handed: whole, or up to the bound with a line saying so. */
export function boundedNotes(notes: unknown): string {
  if (typeof notes !== 'string') {
    // electron-updater hands a list of `{ version, note }` when a feed carries several.
    if (Array.isArray(notes)) {
      return boundedNotes(
        notes
          .map(entry => (typeof entry === 'object' && entry !== null ? (entry as { note?: unknown }).note : null))
          .filter((note): note is string => typeof note === 'string')
          .join('\n\n')
      )
    }
    return ''
  }
  return notes.length > UPDATE_NOTES_MAX_CHARS ? `${notes.slice(0, UPDATE_NOTES_MAX_CHARS)}\n\n…` : notes
}
