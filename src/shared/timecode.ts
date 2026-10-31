/**
 * SMPTE timecode: the frame rates a show meets, the arithmetic between a frame count and
 * the label on the clock, and the shapes main and the window share for generating and
 * following it.
 *
 * Everything here is pure. A position is carried as a frame count from 00:00:00:00 at the
 * rate it was read at, because a frame count is what can be compared, added to and
 * interpolated; the four-field label is only ever made from one for display, and parsed
 * into one on the way in. Drop-frame is the one rate where the two are not the same
 * numbers: 29.97 fps runs 0.1% slow against a 30-frame label, so the label skips frames
 * 00 and 01 at the top of every minute except each tenth, and the count does not.
 *
 * Nothing in this module may import from src/main, src/preload or src/renderer.
 */

/** The rates a show's timecode can run at, in the order the window offers them. */
export const TIMECODE_RATES = ['24', '25', '29.97df', '29.97', '30'] as const

export type TimecodeRate = (typeof TIMECODE_RATES)[number]

export interface TimecodeRateInfo {
  /** Frames in one second of the label: 24, 25 or 30. */
  nominal: number
  /** Frames in one second of real time: 30000/1001 for the two 29.97 rates. */
  fps: number
  /** Whether the label skips frames to stay on the wall clock. */
  dropFrame: boolean
  /** How the window names it. */
  label: string
}

const RATE_INFO: Record<TimecodeRate, TimecodeRateInfo> = {
  '24': { nominal: 24, fps: 24, dropFrame: false, label: '24 fps' },
  '25': { nominal: 25, fps: 25, dropFrame: false, label: '25 fps' },
  '29.97df': { nominal: 30, fps: 30000 / 1001, dropFrame: true, label: '29.97 drop-frame' },
  '29.97': { nominal: 30, fps: 30000 / 1001, dropFrame: false, label: '29.97 non-drop' },
  '30': { nominal: 30, fps: 30, dropFrame: false, label: '30 fps' }
}

export function rateInfo(rate: TimecodeRate): TimecodeRateInfo {
  return RATE_INFO[rate]
}

export function isTimecodeRate(value: unknown): value is TimecodeRate {
  return typeof value === 'string' && (TIMECODE_RATES as readonly string[]).includes(value)
}

/** The four fields on the clock. */
export interface Timecode {
  hours: number
  minutes: number
  seconds: number
  frames: number
}

// Drop-frame's own constants: a ten-minute block holds 17982 frames (nine minutes of 1798
// and one of 1800), and every minute that is not a tenth starts two labels late.
const DF_FRAMES_PER_10_MIN = 17982
const DF_FRAMES_PER_MIN = 1798

/** How many frames one day of the label holds; a position wraps at midnight. */
export function framesPerDay(rate: TimecodeRate): number {
  const info = RATE_INFO[rate]
  if (info.dropFrame) return DF_FRAMES_PER_10_MIN * 6 * 24
  return info.nominal * 60 * 60 * 24
}

/** A frame count brought into one day, so 24:00:00:00 is midnight again and −1 is the frame before it. */
export function wrapFrames(frames: number, rate: TimecodeRate): number {
  const day = framesPerDay(rate)
  const whole = Math.floor(frames)
  return ((whole % day) + day) % day
}

/**
 * Whether the four fields name a frame the rate has. Drop-frame refuses frames 00 and 01
 * of the first second of any minute that is not a multiple of ten: those labels do not
 * exist, and a trigger written on one would be a trigger nothing can ever reach.
 */
export function isValidTimecode(tc: Timecode, rate: TimecodeRate): boolean {
  const info = RATE_INFO[rate]
  const fields = [tc.hours, tc.minutes, tc.seconds, tc.frames]
  if (!fields.every(field => Number.isInteger(field) && field >= 0)) return false
  if (tc.hours > 23 || tc.minutes > 59 || tc.seconds > 59 || tc.frames >= info.nominal) return false
  if (info.dropFrame && tc.seconds === 0 && tc.frames < 2 && tc.minutes % 10 !== 0) return false
  return true
}

/** The frame count a label names, from 00:00:00:00. The label is assumed valid. */
export function timecodeToFrames(tc: Timecode, rate: TimecodeRate): number {
  const info = RATE_INFO[rate]
  const labelled = ((tc.hours * 60 + tc.minutes) * 60 + tc.seconds) * info.nominal + tc.frames
  if (!info.dropFrame) return labelled
  const totalMinutes = tc.hours * 60 + tc.minutes
  return labelled - 2 * (totalMinutes - Math.floor(totalMinutes / 10))
}

/** The label a frame count reads as, wrapped into one day. */
export function framesToTimecode(frames: number, rate: TimecodeRate): Timecode {
  const info = RATE_INFO[rate]
  let n = wrapFrames(frames, rate)
  if (info.dropFrame) {
    const tens = Math.floor(n / DF_FRAMES_PER_10_MIN)
    const rest = n % DF_FRAMES_PER_10_MIN
    // The first minute of each ten-minute block keeps every label; each of the nine after
    // it is two labels short, which is the two skipped at its top.
    const skippedInBlock = rest < 2 ? 0 : 2 * Math.floor((rest - 2) / DF_FRAMES_PER_MIN)
    n += 18 * tens + skippedInBlock
  }
  const nominal = info.nominal
  return {
    hours: Math.floor(n / (nominal * 3600)),
    minutes: Math.floor(n / (nominal * 60)) % 60,
    seconds: Math.floor(n / nominal) % 60,
    frames: n % nominal
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * The label as the clock shows it: `01:00:00:00`, with the semicolon before the frames
 * that is how drop-frame is told apart at a glance — `01:00:00;00`.
 */
export function formatTimecode(tc: Timecode, rate: TimecodeRate): string {
  const separator = RATE_INFO[rate].dropFrame ? ';' : ':'
  return `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}${separator}${pad(tc.frames)}`
}

/** A frame count as its label. */
export function formatFrames(frames: number, rate: TimecodeRate): string {
  return formatTimecode(framesToTimecode(frames, rate), rate)
}

/**
 * Reads a label an operator typed. Four fields separated by `:`, `;`, `.` or `,` in any
 * mix, each one or two digits; fewer fields fill from the right, the way a desk's keypad
 * does, so `10:00` is ten seconds and `1:00:00:00` is an hour. Returns null for anything
 * the rate does not have — a frame past the rate, a drop-frame label that is skipped.
 */
export function parseTimecode(text: string, rate: TimecodeRate): Timecode | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const parts = trimmed.split(/[:;.,]/)
  if (parts.length > 4 || parts.some(part => !/^\d{1,2}$/.test(part))) return null
  const values = parts.map(Number)
  while (values.length < 4) values.unshift(0)
  const [hours, minutes, seconds, frames] = values
  const tc = { hours, minutes, seconds, frames }
  return isValidTimecode(tc, rate) ? tc : null
}

/** A typed label as a frame count, or null when it is not a frame the rate has. */
export function parseTimecodeFrames(text: string, rate: TimecodeRate): number | null {
  const tc = parseTimecode(text, rate)
  return tc === null ? null : timecodeToFrames(tc, rate)
}

/** Real time from 00:00:00:00 to a frame, in ms. Fractional frames are kept. */
export function framesToMs(frames: number, rate: TimecodeRate): number {
  return (frames * 1000) / RATE_INFO[rate].fps
}

/** The frame a moment in real time falls in, counted from 00:00:00:00. */
export function msToFrames(ms: number, rate: TimecodeRate): number {
  // A hair of tolerance, so a time computed from a frame comes back as that frame and not
  // the one before it: 1001/30 ms is not a number a double holds exactly.
  return Math.floor((ms * RATE_INFO[rate].fps) / 1000 + 1e-9)
}

/** The same moment, read at another rate: what a trigger written at 25 fps means at 30. */
export function convertFrames(frames: number, from: TimecodeRate, to: TimecodeRate): number {
  if (from === to) return frames
  return (frames * RATE_INFO[to].fps) / RATE_INFO[from].fps
}

// ── MIDI Time Code and Art-Net's rate codes ─────────────────────────────────
//
// MTC and ArtTimeCode both carry a two-bit rate: 24, 25, 29.97 drop-frame and 30. A
// 29.97 non-drop source has no code of its own and is sent as 30, which is why a receiver
// that wants to tell them apart has to measure the stream rather than read it.

export type TimecodeRateCode = 0 | 1 | 2 | 3

export function rateCode(rate: TimecodeRate): TimecodeRateCode {
  switch (rate) {
    case '24':
      return 0
    case '25':
      return 1
    case '29.97df':
      return 2
    case '29.97':
    case '30':
      return 3
  }
}

/** The rate a code names, taking 3 as 30 until something measures otherwise. */
export function rateFromCode(code: number): TimecodeRate {
  switch (code & 3) {
    case 0:
      return '24'
    case 1:
      return '25'
    case 2:
      return '29.97df'
    default:
      return '30'
  }
}

/**
 * The rate a code really is, once the stream has been timed. Only code 3 is ambiguous —
 * 30 and 29.97 non-drop share it — and the two are 0.1% apart, so the measurement decides
 * only when it is closer to one than the other by a clear margin.
 */
export function refineRate(code: TimecodeRate, measuredFps: number | null): TimecodeRate {
  if (measuredFps === null || !Number.isFinite(measuredFps)) return code
  if (code === '30' || code === '29.97') {
    const ntsc = 30000 / 1001
    return Math.abs(measuredFps - ntsc) < Math.abs(measuredFps - 30) ? '29.97' : '30'
  }
  return code
}

// ── What main and the window share ───────────────────────────────────────────

/** Where incoming timecode is read from. */
export type TimecodeSourceKind = 'none' | 'mtc' | 'ltc' | 'artnet'

/**
 * What the receiver is doing.
 *
 * `locked` is a stream arriving and being followed; `freewheel` is a stream that has
 * stopped arriving and is being carried on at its own rate for the hold time, so a cable
 * knocked or a dropout on the radio link does not stop the show; `stopped` is a source
 * that has said where it is and is standing still (a full-frame locate, or a hold that
 * ran out); `lost` is a stream that has gone for longer than the hold allows.
 */
export type TimecodeLockState = 'off' | 'waiting' | 'locked' | 'freewheel' | 'stopped' | 'lost'

/**
 * The machine's timecode settings. They live in the user-data folder rather than in the show:
 * which MIDI port the clock arrives on and which input the LTC cable is in are facts about
 * the rack this machine sits in. What the show does with the clock is the show's own
 * (`TimecodeShowSettings`), and travels in the file.
 */
export interface TimecodeSettings {
  source: TimecodeSourceKind
  /** MIDI input port MTC arrives on. Empty means the first one there is. */
  mtcPort: string
  /** The capture device LTC arrives on, as the engine names it. Empty means the default. */
  ltcDevice: string
  /** Zero-based channel of that device the LTC is on. */
  ltcChannel: number
  /** UDP port ArtTimeCode is heard on: 6454 is Art-Net's own. */
  artnetPort: number
}

/**
 * How the show follows the clock: written into the show file, so a show built against a
 * playback rig's timecode opens on another machine following it the same way. Optional on
 * disk, and absent while every field is its default — a show that never touched timecode
 * writes the bytes it always wrote.
 */
export interface TimecodeShowSettings {
  /**
   * The rate to read the stream at, or `auto` to take what the stream declares and
   * measure the rest (30 against 29.97 non-drop, and LTC's 24 against 25).
   */
  rate: TimecodeRate | 'auto'
  /** How long a stream that stops arriving is carried on before it is lost, ms. */
  holdMs: number
  /** Whether the cue list follows the incoming clock: locate, chase and hold. */
  chase: boolean
  /** Frames added to the incoming clock before anything reads it. */
  offsetFrames: number
  /** What the running cues do when the clock stops. */
  onStop: TimecodeOnStop
  /**
   * How far, in frames, the clock may jump forward and still count as running through
   * a trigger rather than locating past it: a stream that skipped a few frames in a
   * dropout fires what it skipped, a jump of minutes does not.
   */
  toleranceFrames: number
}

/**
 * What a chasing cue list does with the cues it is running when the clock stops: hold them
 * and pick them up again where the clock comes back, leave them running, or stop them.
 */
export type TimecodeOnStop = 'hold' | 'continue' | 'stop'

export const TIMECODE_ON_STOP: readonly TimecodeOnStop[] = ['hold', 'continue', 'stop']
export const TIMECODE_HOLD_MIN_MS = 0
export const TIMECODE_HOLD_MAX_MS = 10_000
export const TIMECODE_TOLERANCE_MAX_FRAMES = 300
/** The offset's reach: a day of 30 fps labels either way. */
export const TIMECODE_OFFSET_MAX_FRAMES = 30 * 60 * 60 * 24
export const ARTNET_PORT = 6454

export function defaultTimecodeSettings(): TimecodeSettings {
  return {
    source: 'none',
    mtcPort: '',
    ltcDevice: '',
    ltcChannel: 0,
    artnetPort: ARTNET_PORT
  }
}

function boundedInt(field: unknown, min: number, max: number, fallback: number): number {
  return typeof field === 'number' && Number.isFinite(field)
    ? Math.min(max, Math.max(min, Math.round(field)))
    : fallback
}

/** Settings read from disk or a window, with every field held to what it may be. */
export function normalizeTimecodeSettings(value: unknown): TimecodeSettings {
  const base = defaultTimecodeSettings()
  if (typeof value !== 'object' || value === null) return base
  const raw = value as Record<string, unknown>
  const source = raw.source
  return {
    source: source === 'mtc' || source === 'ltc' || source === 'artnet' || source === 'none' ? source : base.source,
    mtcPort: typeof raw.mtcPort === 'string' ? raw.mtcPort : base.mtcPort,
    ltcDevice: typeof raw.ltcDevice === 'string' ? raw.ltcDevice : base.ltcDevice,
    ltcChannel: boundedInt(raw.ltcChannel, 0, 31, base.ltcChannel),
    artnetPort: boundedInt(raw.artnetPort, 1, 65535, base.artnetPort)
  }
}

export function defaultTimecodeShowSettings(): TimecodeShowSettings {
  return {
    rate: 'auto',
    holdMs: 1000,
    chase: false,
    offsetFrames: 0,
    onStop: 'hold',
    toleranceFrames: 10
  }
}

/** A show's timecode as a window edits it, every field held to what it may be. */
export function normalizeTimecodeShowSettings(value: unknown): TimecodeShowSettings {
  const base = defaultTimecodeShowSettings()
  if (typeof value !== 'object' || value === null) return base
  const raw = value as Record<string, unknown>
  const onStop = raw.onStop
  return {
    rate: raw.rate === 'auto' || isTimecodeRate(raw.rate) ? raw.rate : base.rate,
    holdMs: boundedInt(raw.holdMs, TIMECODE_HOLD_MIN_MS, TIMECODE_HOLD_MAX_MS, base.holdMs),
    chase: typeof raw.chase === 'boolean' ? raw.chase : base.chase,
    offsetFrames: boundedInt(raw.offsetFrames, -TIMECODE_OFFSET_MAX_FRAMES, TIMECODE_OFFSET_MAX_FRAMES, base.offsetFrames),
    onStop: onStop === 'hold' || onStop === 'continue' || onStop === 'stop' ? onStop : base.onStop,
    toleranceFrames: boundedInt(raw.toleranceFrames, 0, TIMECODE_TOLERANCE_MAX_FRAMES, base.toleranceFrames)
  }
}

/** Whether a show's timecode says nothing the defaults do not: then the file carries no section. */
export function isDefaultTimecodeShow(settings: TimecodeShowSettings): boolean {
  const base = defaultTimecodeShowSettings()
  return (Object.keys(base) as (keyof TimecodeShowSettings)[]).every(key => settings[key] === base[key])
}

/** A show's timecode as the window holds it: a file that carries none follows with the defaults. */
export function heldTimecode(settings: TimecodeShowSettings | undefined): TimecodeShowSettings {
  return settings ?? defaultTimecodeShowSettings()
}

/**
 * What a file's timecode section says that this build cannot follow, once its fields have been
 * held to their kinds: a rate or a stop behaviour it has no word for. Null when there is none.
 */
export function timecodeShowRefusal(settings: TimecodeShowSettings): string | null {
  if (settings.rate !== 'auto' && !isTimecodeRate(settings.rate)) return `a timecode rate of “${String(settings.rate)}”`
  if (!TIMECODE_ON_STOP.includes(settings.onStop)) return `timecode that does “${String(settings.onStop)}” when it stops`
  if (!Number.isInteger(settings.offsetFrames) || !Number.isInteger(settings.toleranceFrames) || !Number.isInteger(settings.holdMs)) {
    return 'a timecode offset, tolerance or hold that is not a whole number'
  }
  return null
}

/** The incoming clock, as the window is told it. */
export interface TimecodeReceiverStatus {
  source: TimecodeSourceKind
  state: TimecodeLockState
  /**
   * The position at `at`, in frames of `rate` from 00:00:00:00 — fractional, because a
   * stream between frames is somewhere between them. Null until anything has arrived.
   * The show's offset is already in it.
   */
  frames: number | null
  /** Wall-clock ms (`Date.now()`) the position was read at. */
  at: number
  /** The rate being read at: the stream's own, refined by measurement, or the setting. */
  rate: TimecodeRate
  /** What the stream itself declared, before any measurement. */
  declaredRate: TimecodeRate | null
  /** The rate the stream measures at, frames per second, once there is enough of it. */
  measuredFps: number | null
  /** Whether the rate was measured rather than taken from the setting. */
  rateDetected: boolean
  /** 1 running forward, −1 running back, 0 standing still. */
  direction: 1 | -1 | 0
  /** Where the stream comes from, in words: the port, the input, the address. */
  detail: string
}

/** One generator a timecode cue is running. */
export interface TimecodeGeneratorStatus {
  cueId: string
  rate: TimecodeRate
  /** Position at `at`, frames. */
  frames: number
  at: number
  running: boolean
  outputs: string[]
}

export interface TimecodeStatus {
  receiver: TimecodeReceiverStatus
  generators: TimecodeGeneratorStatus[]
}

/**
 * The position a status reads at `now`: where it was, carried on at its rate while the
 * stream is running or freewheeling. A clock standing still, or one that has gone, stays
 * where it was last seen.
 */
export function positionAt(status: TimecodeReceiverStatus, now: number): number | null {
  if (status.frames === null) return null
  if (status.state !== 'locked' && status.state !== 'freewheel') return status.frames
  const fps = status.measuredFps ?? rateInfo(status.rate).fps
  return status.frames + (status.direction * (now - status.at) * fps) / 1000
}

export function idleReceiverStatus(source: TimecodeSourceKind = 'none'): TimecodeReceiverStatus {
  return {
    source,
    state: source === 'none' ? 'off' : 'waiting',
    frames: null,
    at: 0,
    rate: '25',
    declaredRate: null,
    measuredFps: null,
    rateDetected: false,
    direction: 0,
    detail: ''
  }
}

/** What a timecode cue asks main to run. */
export interface TimecodeGenerateRequest {
  cueId: string
  rate: TimecodeRate
  /** Where to start, frames. Ignored when `jam` is set and the clock is being received. */
  startFrames: number
  /** Where to stop, frames, or null to run until stopped. */
  endFrames: number | null
  /** Start from the clock being received, and carry it on through a dropout. */
  jam: boolean
  /** MIDI output port for MTC, or null for none. */
  mtcPort: string | null
  /** Engine output channel for LTC, zero-based, or null for none. */
  ltcChannel: number | null
  /** LTC level, dBFS. */
  ltcLevelDb: number
  /** Art-Net address ArtTimeCode is sent to, or null for none. */
  artnetHost: string | null
}

export type TimecodeGeneratorAction =
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'locate'; frames: number }
  | { action: 'stop' }
