/**
 * The audio playback contract.
 *
 * One home for the shapes the renderer, the main process and the native engine all
 * speak. Nothing here may import from src/main, src/preload or src/renderer: it is
 * the seam those three meet on, and both tsconfigs include it.
 *
 * Verbs are execution verbs, not stream operations. The renderer asks the engine to
 * make sound happen at a frame on the sample clock; the engine owns the device, the
 * decoder, the mixer and the schedule. No audio bytes cross the seam — file paths do.
 *
 * Time is milliseconds on the engine's sample clock (see `clock()`), never epoch and
 * never a wall clock: the renderer reads the clock once, adds its intended delay, and
 * every `whenMs` is absolute on that timeline. A `whenMs` in the past means "now".
 */

/**
 * Protocol version of the JSON command/event wire format between main and native.
 *
 * 2 added the engine session identity (`clock()` replies, `info()`, every event), which
 * a build must not silently do without: the renderer's clock epoch is meaningless
 * against an engine that cannot say which session a reading came from.
 *
 * 3 opens every connection with a greeting that declares this number and the verb and
 * event sets that go with it (`AUDIO_WIRE`). The client reads it before it writes
 * anything, so an engine built against another meaning of the number is refused while the
 * connection is still empty, rather than after it has already answered a verb and its
 * events have been interpreted. The greeting is a new message kind, which is why the
 * meaning changed with it: an engine that does not greet speaks a build from before it.
 */
export const AUDIO_PROTOCOL_VERSION = 4

/** The type a request field carries on the wire. */
export type AudioWireFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array'

/**
 * One field of a request: the type it must have, and either that the verb cannot do what
 * its name says without it, or the value the engine takes when it is absent. `nullable`
 * marks the fields a request may carry `null` for, where null is a meaning of its own
 * (to the end of the file, automatic routing, "default", leave as it is); a null anywhere
 * else is refused. `fields` declares what is inside an object, or inside each element of
 * an array of them — every present field is checked against its own declaration, at every
 * depth.
 *
 * A `null` default is "absent means ...": the same meanings as above, named once.
 */
export type AudioWireField =
  | {
      type: AudioWireFieldType
      required: true
      nullable?: true
      fields?: Record<string, AudioWireField>
    }
  | {
      type: AudioWireFieldType
      required: false
      nullable?: true
      default: string | number | boolean | null
      fields?: Record<string, AudioWireField>
    }

/** One zero-based matrix connection, as a request carries it. */
const AUDIO_WIRE_CROSSPOINT = {
  inputChannel: { type: 'number', required: false, default: -1 },
  outputChannel: { type: 'number', required: false, default: -1 },
  gain: { type: 'number', required: false, default: 1 }
} as const satisfies Record<string, AudioWireField>

/** What a `start` asks the engine to play, field for field. */
const AUDIO_WIRE_START_OPTIONS = {
  startTime: { type: 'number', required: false, default: 0 },
  /** A time in the file; null (or absent) plays to the end of the file. */
  endTime: { type: 'number', required: false, nullable: true, default: null },
  loopCount: { type: 'number', required: false, default: 0 },
  rate: { type: 'number', required: false, default: 1 },
  trim: { type: 'number', required: false, default: 1 },
  volume: { type: 'number', required: false, default: 1 },
  pan: { type: 'number', required: false, default: 0 },
  fadeInDuration: { type: 'number', required: false, default: 0 },
  /** Null/absent is automatic routing; `[]` is a deliberately silent voice. */
  outputs: { type: 'array', required: false, nullable: true, default: null, fields: AUDIO_WIRE_CROSSPOINT }
} as const satisfies Record<string, AudioWireField>

/** What `configure()` accepts: null, and every sub-field of it, means leave as it is. */
const AUDIO_WIRE_DEVICE_OPTIONS = {
  backend: { type: 'string', required: false, default: null },
  deviceId: { type: 'string', required: false, nullable: true, default: null },
  sampleRate: { type: 'number', required: false, nullable: true, default: null },
  channels: { type: 'number', required: false, nullable: true, default: null },
  exclusive: { type: 'boolean', required: false, default: null },
  bufferFrames: { type: 'number', required: false, nullable: true, default: null }
} as const satisfies Record<string, AudioWireField>

/**
 * Every event the engine sends, and the top-level fields each type carries — the native
 * truth `eventLine()` writes and this reader checks against. The recognition rule both
 * ends of the stream follow: a type is known when this declaration names it, a field when
 * the declaration names it for that type. Values are not declared and not checked: a name
 * the reader cannot look up is what a report is for, not a value it dislikes. Every event
 * is flat, so the top-level names are the whole check.
 *
 * The `satisfies` holds one direction — a name that is not a field of its own interface —
 * and `EventSetCheck`, applied where the declaration is built, holds the other: an array
 * type can say which names it may hold, never that every one of them appears, so
 * completeness is checked against this declaration's own type rather than stated beside it.
 */
const AUDIO_WIRE_EVENTS = {
  ended: {
    type: { type: 'string' },
    cueId: { type: 'string' },
    runId: { type: 'string' },
    at: { type: 'number' },
    reason: { type: 'string' },
    loopsCompleted: { type: 'number' },
    sessionId: { type: 'string' }
  },
  error: {
    type: { type: 'string' },
    at: { type: 'number' },
    // The fault belongs to the engine rather than to one cue, so both ids are null here:
    // a meaning of its own, which is what `nullable` marks and what a wrong kind is not.
    cueId: { type: 'string', nullable: true },
    runId: { type: 'string', nullable: true },
    code: { type: 'string' },
    message: { type: 'string' },
    sessionId: { type: 'string' }
  },
  panic: {
    type: { type: 'string' },
    at: { type: 'number' },
    fadeMs: { type: 'number' },
    sessionId: { type: 'string' }
  },
  state: {
    type: { type: 'string' },
    at: { type: 'number' },
    active: { type: 'boolean' },
    cueId: { type: 'string', nullable: true },
    runId: { type: 'string', nullable: true },
    playing: { type: 'boolean' },
    // Null on a purely global transition.
    state: { type: 'string', nullable: true },
    sessionId: { type: 'string' }
  }
} as const satisfies {
  readonly [Name in AudioEventType]: WireEventFields<Extract<AudioEngineEvent, { type: Name }>>
}

/** The wire kind a field's own TypeScript type is written as — the five the requests use. */
type WireKindOf<T> = Exclude<T, null> extends string
  ? 'string'
  : Exclude<T, null> extends number
    ? 'number'
    : Exclude<T, null> extends boolean
      ? 'boolean'
      : Exclude<T, null> extends readonly unknown[]
        ? 'array'
        : 'object'

/**
 * One field of an event: the kind it must have, and `nullable` exactly where the interface
 * allows `null`. Both directions are the type's own — a field that omits `nullable` where
 * `null` is allowed, and one that declares it where `null` is not, fail to compile.
 *
 * What this buys is the fact a coercion used to invent: `reason: null` on an `ended` event
 * passed every check and was normalised to `'complete'`, so a line carrying no reason read
 * as a natural finish. A field present with the wrong kind — or with a null the interface
 * does not allow — is now reported where the other two directions already are.
 */
type WireEventField<T> = null extends T
  ? { readonly type: WireKindOf<Exclude<T, null>>; readonly nullable: true }
  : { readonly type: WireKindOf<T>; readonly nullable?: never }

/** Every field an event interface carries, with the kind each one's own type writes it as. */
type WireEventFields<T> = { [K in keyof T]-?: WireEventField<T[K]> }

/** The fields of an event interface that the declared set leaves out — nothing at all while
 *  the two agree. */
type MissingEventFields<Declared extends { [Name in AudioEventType]: object }> = {
  [Name in AudioEventType]: Exclude<keyof Extract<AudioEngineEvent, { type: Name }>, keyof Declared[Name]>
}[AudioEventType]

/** The fields the declared set carries that the interface has not got — nothing at all while
 *  the two agree. */
type ExtraEventFields<Declared extends { [Name in AudioEventType]: object }> = {
  [Name in AudioEventType]: Exclude<keyof Declared[Name], keyof Extract<AudioEngineEvent, { type: Name }>>
}[AudioEventType]

/**
 * `unknown` while the declared set names every field of every event interface and nothing
 * else; the fields left out or carried that no interface has otherwise, which makes `events`
 * unsatisfiable at `AUDIO_WIRE` and names itself. The kinds are held by the `satisfies` on
 * the declaration above, so a field or a type added to the interfaces can never ship either
 * half stale.
 */
type EventSetCheck = [MissingEventFields<typeof AUDIO_WIRE_EVENTS>] extends [never]
  ? [ExtraEventFields<typeof AUDIO_WIRE_EVENTS>] extends [never]
    ? unknown
    : { extraEventFields: ExtraEventFields<typeof AUDIO_WIRE_EVENTS> }
  : { missingEventFields: MissingEventFields<typeof AUDIO_WIRE_EVENTS> }

/**
 * The wire's declaration: the protocol number, every verb with the fields each one
 * reads, and every event with the fields each type carries. This is the one home of the
 * verb and event sets. The native engine cannot import this module, so it carries the
 * same table as data (`native/audio/src/protocol.cpp`), prints it for `--protocol`, and
 * refuses a request whose required field is missing or mistyped;
 * `src/main/audio/audioWire.test.ts` holds the two to each other, so a verb, an event or
 * a field edited at one end alone fails there.
 *
 * Verb and field names are frozen, and so are the declared defaults: a well-formed
 * request that omits an optional field gets the default, never a refusal.
 *
 * `--protocol` prints the bounds both ends share (`AUDIO_LIMITS`) beside the verbs in
 * the same JSON. They are not part of this number's meaning — the version still means
 * this verb, event and field set, so an engine built before they joined the printout
 * and declaring the same protocol stays acceptable at runtime; the two tables are held
 * equal at build time by the comparison test, never negotiated at connect.
 */
export const AUDIO_WIRE = {
  protocol: AUDIO_PROTOCOL_VERSION,
  verbs: {
    /** Register a cue's file and measure it. */
    prepare: {
      cueId: { type: 'string', required: true },
      filePath: { type: 'string', required: true }
    },
    /** Measure a file without decoding it into the cache. */
    probe: {
      filePath: { type: 'string', required: true }
    },
    start: {
      cueId: { type: 'string', required: true },
      /** Absolute sample-clock ms; 0 means now. */
      whenMs: { type: 'number', required: false, default: 0 },
      options: { type: 'object', required: true, fields: AUDIO_WIRE_START_OPTIONS }
    },
    stop: {
      cueId: { type: 'string', required: true },
      fadeMs: { type: 'number', required: false, default: 0 },
      whenMs: { type: 'number', required: false, default: 0 }
    },
    stopAll: {
      fadeMs: { type: 'number', required: false, default: 0 }
    },
    seek: {
      cueId: { type: 'string', required: true },
      positionMs: { type: 'number', required: false, default: 0 },
      whenMs: { type: 'number', required: false, default: 0 }
    },
    release: {
      cueId: { type: 'string', required: true },
      whenMs: { type: 'number', required: false, default: 0 },
      /** A time in the file; null (or absent) plays the release out to the end of it. */
      endMs: { type: 'number', required: false, nullable: true, default: null }
    },
    cancel: {
      cueId: { type: 'string', required: true },
      whenMs: { type: 'number', required: false, default: 0 }
    },
    /** Hold a cue's voice where it stands; every timed thing about it waits with it. */
    pause: {
      cueId: { type: 'string', required: true },
      whenMs: { type: 'number', required: false, default: 0 }
    },
    /** Let a held voice go on, moved on by however long it was held. */
    resume: {
      cueId: { type: 'string', required: true },
      whenMs: { type: 'number', required: false, default: 0 }
    },
    fade: {
      cueId: { type: 'string', required: true },
      param: { type: 'string', required: false, default: 'volume' },
      value: { type: 'number', required: false, default: 0 },
      durationMs: { type: 'number', required: false, default: 0 },
      curve: { type: 'string', required: false, default: 'linear' },
      whenMs: { type: 'number', required: false, default: 0 }
    },
    routing: {
      cueId: { type: 'string', required: true },
      /** Null/absent is automatic routing, `[]` is a deliberately silent voice. */
      outputs: { type: 'array', required: false, nullable: true, default: null, fields: AUDIO_WIRE_CROSSPOINT }
    },
    progress: {
      cueId: { type: 'string', required: true }
    },
    panic: {
      fadeMs: { type: 'number', required: false, default: 0 }
    },
    clock: {},
    info: {},
    devices: {},
    configure: {
      /** Null/absent, and every sub-field of it, means "leave the device as it is". */
      options: { type: 'object', required: false, nullable: true, default: null, fields: AUDIO_WIRE_DEVICE_OPTIONS }
    },
    waveform: {
      filePath: { type: 'string', required: true },
      points: { type: 'number', required: false, default: 512 },
      /** Both ends together name a window; either one alone is the whole file. */
      startMs: { type: 'number', required: false, default: null },
      endMs: { type: 'number', required: false, default: null }
    },
    onsets: {
      filePath: { type: 'string', required: true },
      sensitivity: { type: 'number', required: false, default: 1 },
      maxOnsets: { type: 'number', required: false, default: 0 },
      startMs: { type: 'number', required: false, default: null },
      endMs: { type: 'number', required: false, default: null }
    },
    silence: {
      filePath: { type: 'string', required: true },
      thresholdDb: { type: 'number', required: false, default: -60 }
    },
    /** Test hook: runs the real device-notification classification without hardware. */
    simulateDeviceNotification: {
      type: { type: 'string', required: true },
      deliberate: { type: 'boolean', required: false, default: false }
    },
    shutdown: {}
  },
  events: AUDIO_WIRE_EVENTS
} as const satisfies {
  protocol: number
  verbs: Record<string, Record<string, AudioWireField>>
  events: typeof AUDIO_WIRE_EVENTS & EventSetCheck
}

/** Every verb the wire carries, as a union of its names. */
export type AudioWireVerb = keyof typeof AUDIO_WIRE.verbs

/** What the declaration says about one event field: the kind it must have, and whether a
 *  `null` is a meaning of its own there. */
export interface DeclaredEventField {
  readonly type: AudioWireFieldType
  readonly nullable?: boolean
}

/** The fields the declaration carries for an event type, with each one's kind — or null when
 *  it names no such type. The recognition rule, read by every site that checks an engine
 *  event: a type is known when the declaration names it, a field when the declaration names
 *  it for that type, and a value when it is the kind the declaration writes — never a second
 *  list beside the declaration. */
export function declaredEventFields(type: unknown): Record<string, DeclaredEventField> | null {
  if (typeof type !== 'string' || !Object.hasOwn(AUDIO_WIRE.events, type)) return null
  return (AUDIO_WIRE.events as Record<string, Record<string, DeclaredEventField>>)[type]
}

/**
 * Whether a value is what a declared kind writes. The native engine carries its own copy of
 * this reading — `wireValueMatches` in `native/audio/src/protocol.cpp`, where a request's
 * field is held to the same kinds — and the declaration test holds the two tables (not the
 * two functions) to each other: what a field must be is declared once, and both ends read
 * the same declaration.
 */
export function admitsWireKind(kind: AudioWireFieldType, value: unknown): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
}

/** Default stream format. The engine reports what it actually achieved in `info()`. */
export const AUDIO_DEFAULT_SAMPLE_RATE = 48000
export const AUDIO_DEFAULT_BUFFER_FRAMES = 512
export const AUDIO_DEFAULT_CHANNELS = 2

/**
 * How a declared bound treats a request that asks past it.
 *
 * `refuse` — the request does not happen, and the answer says what refused it. The
 * schedule horizon and the streaming budget name the bound and its value; the other
 * refusals keep the wire's existing wording (an over-bound crosspoint matrix answers
 * `invalid`, "too many crosspoints", and a start with no free voice answers `limit`
 * without naming a bound).
 *
 * `clamp-and-report` — the engine applies what it can and publishes the achieved
 * figure, so a caller never assumes what it asked for is what it got: the device
 * figures and the cache/media counters in `info()`, a reply's `truncated`, and a
 * streaming voice's `streamBytes`.
 */
export type AudioLimitRegime = 'refuse' | 'clamp-and-report'

/** One bound both ends share: the value it is enforced at, and the regime it is in. */
export interface AudioLimit {
  value: number
  regime: AudioLimitRegime
}

/**
 * The bounds both ends share — the one declaration of them: each bound's name, value
 * and regime exist here and nowhere else. The value is the engine's own default; a
 * command-line setting may move what is in force, and `info()` carries the in-force
 * figure for the bounds it reports — the cache's `limitBytes`, `maxFiles` and
 * `maxFileBytes`, the streaming total as `media.streamBufferLimitBytes`, and the
 * achieved device figures (rate, channels, buffer, exclusivity) — while the rest are
 * visible in the figures each regime names below. The regime is what the engine does
 * at it.
 *
 * The native engine cannot import this module, so it carries the same table as data
 * (`native/audio/src/wsaudio.h`), reads it at every enforcement site and flag default,
 * and prints it for `--protocol`; `src/main/audio/audioWire.test.ts` holds the two to
 * each other, so a name, value or regime edited at one end alone fails there.
 *
 * The regimes: voices, crosspoints and the schedule horizon refuse — a request the
 * engine cannot hold, or a schedule a show must not have moved under it. The cache
 * bounds and a streaming voice's ring clamp and report the achieved figure, and the
 * total streaming budget refuses rather than allocate past it. They exist so a buggy
 * or hostile caller cannot make the engine allocate without limit, and so every
 * scheduling verb has a definite failure.
 */
export const AUDIO_LIMITS = {
  /** Voices that can be scheduled or playing at once. */
  maxVoices: { value: 64, regime: 'refuse' },
  /** A single start's crosspoint matrix. */
  maxCrosspoints: { value: 64, regime: 'refuse' },
  /** Output channels a voice can address (the device may have fewer). */
  maxOutputChannels: { value: 32, regime: 'clamp-and-report' },
  /** Points a single `waveform()` call may return (min/max pairs per bucket). */
  maxWaveformPoints: { value: 4096, regime: 'clamp-and-report' },
  /** How far ahead of the current sample clock a verb carrying `whenMs` may be placed. */
  scheduleHorizonMs: { value: 10_000, regime: 'refuse' },
  /** Decoded float data held for reuse, and how many files it may span. */
  cacheMaxBytes: { value: 512 * 1024 * 1024, regime: 'clamp-and-report' },
  cacheMaxFiles: { value: 100, regime: 'clamp-and-report' },
  /** Decoded size above which a file is streamed and never cached. */
  cacheMaxFileBytes: { value: 32 * 1024 * 1024, regime: 'clamp-and-report' },
  /** Decoded-but-unplayed bytes a streaming voice's ring may hold. */
  streamMaxBytesPerVoice: { value: 16 * 1024 * 1024, regime: 'clamp-and-report' },
  /** Decoded-but-unplayed bytes across every streaming voice. */
  streamMaxTotalBytes: { value: 128 * 1024 * 1024, regime: 'refuse' }
} as const satisfies Record<string, AudioLimit>

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const AUDIO_CHANNELS = {
  prepare: 'audio:prepare',
  probe: 'audio:probe',
  start: 'audio:start',
  stop: 'audio:stop',
  stopAll: 'audio:stopAll',
  seek: 'audio:seek',
  /** Ends a voice's loop and plays it out to the end of the file. */
  release: 'audio:release',
  cancel: 'audio:cancel',
  /** Holds a voice where it stands, and lets it go on. */
  pause: 'audio:pause',
  resume: 'audio:resume',
  fade: 'audio:fade',
  routing: 'audio:routing',
  progress: 'audio:progress',
  panic: 'audio:panic',
  clock: 'audio:clock',
  info: 'audio:info',
  devices: 'audio:devices',
  configure: 'audio:configure',
  waveform: 'audio:waveform',
  /** Times where notes or hits begin, for placing a slice boundary. */
  onsets: 'audio:onsets',
  /** Where a file's sound starts and stops, for trimming the silence at its edges. */
  silence: 'audio:silence',
  pickFile: 'audio:pickFile',
  /** Main pushes AudioEngineEvent[] here; preload subscribes with `onEvents`. */
  events: 'audio:events'
} as const

/**
 * The level below which a sample counts as silence, in dBFS.
 *
 * A digital master's own dither and a quiet room's floor sit under it; a hissy tape rip
 * sits over it, and that is the scan saying there is no silence at the file's edges to
 * trim — which is true, and better than cutting into the hiss. The engine scans with
 * this number and the UI names it, which is why it lives here rather than in either of
 * them.
 */
export const AUDIO_SILENCE_THRESHOLD_DB = -60

/** Fade shapes, matching the Web Audio behaviour the renderer was built against. */
export type AudioFadeCurve = 'linear' | 'sCurve' | 'logarithmic'

/** A live parameter a `fade()` can move. */
export type AudioFadeParam = 'volume' | 'pan' | 'trim' | 'rate'

export type AudioFormat = 'wav' | 'mp3' | 'ogg' | 'flac' | 'm4a' | 'aiff' | 'unknown'

/**
 * One zero-based matrix connection: source channel `inputChannel` feeds device channel
 * `outputChannel` at `gain`. A voice's matrix is `AudioCrosspoint[]`.
 */
export interface AudioCrosspoint {
  inputChannel: number
  outputChannel: number
  gain: number
}

/**
 * What a start asks the engine to play. Every field has a default in
 * `defaultAudioStartOptions()`; `outputs: null` is automatic routing (source channels
 * map to output channels in order, mono doubling to the first pair), `[]` is a voice
 * that is deliberately silent, and a list is an explicit matrix.
 */
export interface AudioStartOptions {
  /** Offset into the file, in ms. */
  startTime: number
  /** Exclusive end, in ms, or null to play to the end of the file. */
  endTime: number | null
  /** 0 = once; N = N repeats (N+1 plays); -1 = until stopped. */
  loopCount: number
  /** Playback rate; must be > 0. */
  rate: number
  /** Linear trim applied with `volume`. */
  trim: number
  /** Voice level, 0..1 (faders may exceed for gain, the engine clamps to sane bounds). */
  volume: number
  /** Stereo pan, -1 (left) .. 1 (right), applied to output channels 0/1. */
  pan: number
  /** Fade-in length in ms; 0 means the voice starts at its level. */
  fadeInDuration: number
  outputs: AudioCrosspoint[] | null
}

export function defaultAudioStartOptions(): AudioStartOptions {
  return {
    startTime: 0,
    endTime: null,
    loopCount: 0,
    rate: 1,
    trim: 1,
    volume: 1,
    pan: 0,
    fadeInDuration: 0,
    outputs: null
  }
}

export function isAudioFadeParam(value: string): value is AudioFadeParam {
  return value === 'volume' || value === 'pan' || value === 'trim' || value === 'rate'
}

/** Waveform points are clamped here on both sides of the seam. */
export function clampWaveformPoints(points: number): number {
  if (!Number.isFinite(points)) return 0
  return Math.max(1, Math.min(AUDIO_LIMITS.maxWaveformPoints.value, Math.floor(points)))
}

/**
 * `prepare()` measures a file without decoding it into memory. `decodedBytes` is what
 * is resident for it right now: the full decoded size for a cached small file, 0 for a
 * streamed one.
 */
export interface AudioMetadata {
  cueId: string
  filePath: string
  format: AudioFormat
  durationMs: number
  sampleRate: number
  channels: number
  /** Total source frames when known, null for a stream whose length is not stated. */
  frames: number | null
  fileBytes: number
  /** True when this file will be decoded as it plays rather than cached whole. */
  streaming: boolean
  /** True when a decoded copy was already resident (a genuine cache promotion). */
  cacheHit: boolean
  decodedBytes: number
}

/**
 * Metadata-only media probe: container headers, no decoder pass, no cache entry, no
 * counters. This is what a workspace footprint is measured with — asking about every cue
 * in the show costs a header read each and changes nothing.
 */
export interface AudioProbe {
  filePath: string
  format: AudioFormat
  /** 0 when the container states no length. */
  durationMs: number
  sampleRate: number
  channels: number
  /** Null when the length is not stated. */
  frames: number | null
  fileBytes: number
  /** Frames x channels x 4 — what it would cost resident; null when the length is unknown. */
  decodedBytes: number | null
  /** True when this file would stream rather than be cached. */
  streaming: boolean
  /** A decoded copy is resident right now; probing does not promote or touch it. */
  resident: boolean
}

/** What a cue is doing right now. `scheduled` is a future start that has not begun. */
export type AudioVoiceState = 'scheduled' | 'playing' | 'fading' | 'stopped'

/** Why a run stopped. `complete` is a natural end; anything else was commanded or a fault. */
export type AudioEndReason = 'complete' | 'stopped' | 'replaced' | 'cancelled' | 'device-lost' | 'error'

export interface AudioProgress {
  cueId: string
  runId: string
  state: AudioVoiceState
  /** True while the run can still make sound (scheduled, playing or fading). */
  playing: boolean
  /** Position in the file, ms — the waveform playhead. */
  elapsedMs: number
  durationMs: number
  /** 0..1 position inside the file. */
  fraction: number
  /** 0..1 across the whole run including loop repeats — the cue-row bar. */
  runFraction: number
  loopsCompleted: number
  /** Sample-clock ms the run was scheduled to start at. */
  startedAtMs: number
}

/** What a `start` resolves to: the identity every later event for this run carries. */
export interface AudioStartResult {
  cueId: string
  runId: string
  state: AudioVoiceState
  /** Sample-clock ms the run starts at (the scheduled time, or now if it was past). */
  startAtMs: number
}

export interface AudioCommandResult {
  ok: true
  /** Sample-clock ms the command was accepted at. */
  at: number
  /** Whether an active voice was affected. */
  applied: boolean
}

export interface AudioCancelResult {
  ok: true
  at: number
  /** Future-dated operations dropped before they fired. */
  canceled: number
}

export interface AudioSeekResult {
  ok: true
  at: number
  positionMs: number
  state: AudioVoiceState
}

export interface AudioPanicResult {
  ok: true
  at: number
  stoppedVoices: number
}

/**
 * Every event type the wire carries: the union of the interfaces below. `AUDIO_WIRE.events`
 * is the one home of the set and of the fields each type carries, and it must name every
 * member of this union and nothing else — held where the declaration is built. An interface
 * added to `AudioEngineEvent` therefore joins this union by existing, and the declaration
 * has to carry it before the suite can compile.
 */
export type AudioEventType = AudioEngineEvent['type']

export interface AudioEndedEvent {
  type: 'ended'
  cueId: string
  runId: string
  at: number
  reason: AudioEndReason
  loopsCompleted: number
  /** The engine session that produced it; a new id means the engine was replaced. */
  sessionId: string
}

export interface AudioErrorEvent {
  type: 'error'
  at: number
  /** Null when the fault belongs to the engine rather than one cue (device loss, spawn). */
  cueId: string | null
  runId: string | null
  code: AudioErrorCode
  message: string
  sessionId: string
}

export type AudioErrorCode =
  | 'device'
  | 'decode'
  | 'format-unavailable'
  | 'not-prepared'
  | 'invalid'
  | 'limit'
  | 'engine'

export interface AudioPanicEvent {
  type: 'panic'
  at: number
  fadeMs: number
  sessionId: string
}

/**
 * A state transition. `active` is the engine-wide indicator the watchdog reads: true
 * while any voice is scheduled, playing or fading. `playing` is the per-cue answer;
 * `state` is null on a purely global transition.
 */
export interface AudioStateEvent {
  type: 'state'
  at: number
  active: boolean
  cueId: string | null
  runId: string | null
  playing: boolean
  state: AudioVoiceState | null
  sessionId: string
}

/**
 * One reading of the engine's sample clock, carrying the identity of the session that
 * produced it. The renderer keeps an epoch so its show clock is continuous across an
 * engine restart: `showNow = clockMs + epoch`, with the epoch absorbing the fact that
 * a respawned engine counts from zero again.
 */
export interface AudioClockReading {
  /** Sample-clock ms in the engine session that produced this reading. */
  clockMs: number
  /** Changes whenever the engine process is replaced. */
  sessionId: string
}

export type AudioEngineEvent = AudioEndedEvent | AudioErrorEvent | AudioPanicEvent | AudioStateEvent

/** What a device really advertises: channel count and rates are the hardware's. */
export interface AudioDeviceInfo {
  id: string
  name: string
  isDefault: boolean
  channels: number
  /** Current/default device rate. */
  defaultSampleRate: number
  minSampleRate: number
  maxSampleRate: number
  /** Rates the device advertises, when the backend enumerates them; may be empty. */
  sampleRates: number[]
  /** Native sample formats the device reports, e.g. ['f32', 's16']. */
  formats: string[]
  /** True when this backend can attempt exclusive access to this device. */
  exclusive: boolean
}

/** What `configure()` accepts. Null/absent means "leave as it is"; a request never silently falls back. */
export interface DeviceOptions {
  /**
   * The audio system to run the show through, e.g. `'auto'` for the platform's own
   * stack or `'asio'`. Absent leaves the engine as it is; a system neither the build
   * nor the machine can provide is an error, like every other field here.
   */
  backend?: string
  deviceId?: string | null
  sampleRate?: number | null
  channels?: number | null
  exclusive?: boolean
  bufferFrames?: number | null
}

export interface AudioActiveCue {
  cueId: string
  runId: string
  state: AudioVoiceState
  elapsedMs: number
  /**
   * The ring the engine's streaming voice holds, in bytes — the achieved figure when
   * the per-voice bound capped the configured pre-roll — or 0 for a cache-backed voice.
   * Optional because an engine built before this field was added declares the same
   * protocol and sends none; a caller treats that as unknown, not as zero.
   */
  streamBytes?: number
}

export interface AudioCacheStats {
  entries: number
  bytes: number
  limitBytes: number
  maxFiles: number
  maxFileBytes: number
  /** Served from cache without touching the disk again. */
  hits: number
  /** Decoded because it was not resident (cold loads). */
  misses: number
  evictions: number
  /** Prepares of oversized files that never entered the cache. */
  bypassed: number
  /** Entries held by an active or scheduled voice, which eviction must not touch. */
  pinnedEntries: number
  pinnedBytes: number
}

/** Total-media pressure, for the warnings the UI shows without loading anything. */
export interface AudioMediaStats {
  activeVoices: number
  streamingVoices: number
  /** Decoded bytes resident in the cache plus streaming pre-roll buffers. */
  residentBytes: number
  streamBufferBytes: number
  streamBufferLimitBytes: number
  decodeQueueDepth: number
  /** Frames the mixer had to fill with silence because a stream was not ready. */
  decodeUnderruns: number
  /** Device callbacks that could not be served in time. */
  xruns: number
  droppedFileChunks: number
}

export type AudioBackend =
  | 'wasapi'
  | 'asio'
  | 'coreaudio'
  | 'alsa'
  | 'pulseaudio'
  | 'jack'
  | 'silent'
  | 'offline'
  | 'none'
  | (string & {})

export type AudioLatencySource = 'measured' | 'estimated' | 'unknown'

/**
 * Honest engine state. `exclusive`, `sampleRate`, `channels` and the latency fields
 * describe what is actually running, not what was asked for. A requested setting that
 * could not be honoured is an error from `configure()`, never a quiet downgrade; the
 * `warnings` list carries anything the engine noticed on its own.
 */
export interface AudioEngineInfo {
  name: string
  version: string
  protocol: number
  /** The running engine's session identity; changes when the process is replaced. */
  sessionId: string
  backend: AudioBackend
  deviceId: string | null
  deviceName: string
  sampleRate: number
  channels: number
  /** Actual engine-to-device sample format, e.g. 'f32'. */
  format: string
  /** Actual exclusive-mode state. */
  exclusive: boolean
  /** Actual device buffer in frames, null when the backend does not expose one. */
  bufferFrames: number | null
  /** Actual period in frames where measurable. */
  periodFrames: number | null
  latencyMs: number | null
  latencySource: AudioLatencySource
  active: boolean
  activeVoices: number
  activeCues: AudioActiveCue[]
  cache: AudioCacheStats
  media: AudioMediaStats
  lastError: string | null
  warnings: string[]
}

/**
 * A bounded peak scan. `values` is interleaved min/max per bucket — [min0, max0,
 * min1, max1, …] — the same shape the waveform panel already draws, over the first
 * two channels. Never media bytes.
 */
export interface AudioWaveform {
  filePath: string
  buckets: number
  values: number[]
  /** The file's whole length, whatever part of it these buckets cover. */
  durationMs: number
  sampleRate: number
  channels: number
  /** True when the requested point count was clamped to the engine's limit. */
  truncated: boolean
  /** The part of the file the buckets cover, in ms from its start. */
  startMs: number
  endMs: number
  /**
   * True when the buckets were measured from taps rather than every sample — what a
   * region longer than about twenty-five minutes gets, so that drawing it costs a seek
   * per bucket instead of a pass over the media. A sampled envelope is only ever shown
   * where one bucket is more than a pixel of wall time, which is where a transient
   * inside it could not have been drawn anyway.
   */
  sampled: boolean
}

/**
 * Where notes or hits begin in a file, as times in milliseconds, ascending. The engine
 * analyses the decoded samples — an envelope would lose the quiet attacks, and a slice
 * boundary placed on a drowned one is worse than no boundary at all.
 *
 * A time is where the attack is, not where the analysis window started: the samples are
 * read in frames, and the frame's middle is the closest a 1024-sample window gets to the
 * moment the sound began.
 */
export interface AudioOnsets {
  filePath: string
  onsetsMs: number[]
  /** The file's whole length, whatever part of it was analysed. */
  durationMs: number
  sampleRate: number
  channels: number
  /** True when the cap on returned onsets was reached and the scan stopped early. */
  truncated: boolean
  /** The part of the file that was analysed, in ms from its start. */
  startMs: number
  endMs: number
}

/**
 * A file's audible extent: where its sound starts and where it ends, from a scan of the
 * decoded samples. Both are times in ms from the file's own start, so trimming silence
 * is a region like any other and nothing downstream has to know a scan happened.
 *
 * `silent` is a file that never crosses the threshold, from end to end. Its bounds are
 * the whole file rather than nothing at all: room tone and a quiet ambience have no
 * silence *at their edges* to trim, and a cue trimmed to no length at all would be a cue
 * the operator asked to hear and cannot.
 */
export interface AudioSilence {
  filePath: string
  /** Where the first sample above the threshold is, ms from the file's start. */
  startMs: number
  /** Where the last sample above the threshold ends, ms from the file's start. */
  endMs: number
  /** The whole length of what the scan read, ms. */
  durationMs: number
  sampleRate: number
  channels: number
  /** Nothing crossed the threshold; the bounds are the whole file. */
  silent: boolean
}

/**
 * A window into a file, in ms from its start. Both ends together, because half a window
 * is not one: a request with no region is the whole file.
 */
export interface AudioRegion {
  startMs: number
  endMs: number
}

/**
 * The renderer-facing bridge (`window.cuerunner.audio`). Main implements it in
 * src/main/audio/AudioEngine.ts + the IPC handlers; preload is a thin forwarder.
 */
export interface AudioEngineBridge {
  /**
   * Register a cue's file and measure it. Resolves with the metadata; does not start.
   * A small file is decoded into the cache here, an oversized one is marked streaming.
   */
  prepare(cueId: string, filePath: string): Promise<AudioMetadata>
  /**
   * Measure a media file. Never touches the decoded cache, and never holds media of
   * its own. Safe to call for every cue in a workspace, with one caveat: a file whose
   * header states no length (an MP3 with no Xing/Info frame) has to be read to be
   * measured, so it costs a pass over the file — once. A long file is indexed by that
   * same first pass, which is what lets a later start deep inside it begin at once.
   * `prepare` is still what warms a cue's media for playback.
   */
  probe(filePath: string): Promise<AudioProbe>
  /**
   * Start (or restart) a cue. `whenMs` is absolute sample-clock ms; a value at or
   * before the current clock starts immediately, one beyond the horizon is rejected.
   * A start replaces any earlier run of the same cue (that run ends as 'replaced').
   */
  start(cueId: string, whenMs: number, options: AudioStartOptions): Promise<AudioStartResult>
  /**
   * Stop the cue's audible run at `whenMs` and drop any start scheduled for it that
   * has not begun. `fadeMs` fades to silence before the stop.
   */
  stop(cueId: string, fadeMs: number, whenMs?: number): Promise<AudioCommandResult>
  /** Stop every cue — the STOP-all verb. Cancels scheduled starts too. */
  stopAll(fadeMs: number): Promise<AudioCommandResult>
  /**
   * Move the position of a running cue without touching its envelope: no fade-in
   * retrigger, no volume/pan/trim reset. Unknown or stopped cues resolve with
   * `state: 'stopped'` and change nothing.
   */
  seek(cueId: string, positionMs: number, whenMs?: number): Promise<AudioSeekResult>
  /**
   * End a looping voice's loop and play it out to the end of the file, or to `endMs`
   * when one is named — a cue trimmed of its trailing silence plays out to where its
   * sound stops, not into the silence. `applied` is false when the cue was not looping
   * or its file has no stated length: there was nothing to release, and the caller is
   * told rather than having a change reported that did not happen.
   */
  release(cueId: string, whenMs?: number, endMs?: number): Promise<AudioCommandResult>
  /** Drop the cue's future-dated verbs (a scheduled start, a scheduled stop/fade). */
  cancel(cueId: string, whenMs?: number): Promise<AudioCancelResult>
  /**
   * Hold a cue's voice where it stands: silent, not moving through its file, and every
   * frame-stamped thing about it — a fade, a scheduled stop, a start not reached — waiting
   * with it. `applied` is false for a voice already held or a cue with nothing playing.
   */
  pause(cueId: string, whenMs?: number): Promise<AudioCommandResult>
  /** Let a held voice go on, its timed things moved on by the hold. */
  resume(cueId: string, whenMs?: number): Promise<AudioCommandResult>
  /**
   * Replace a running cue's routing matrix live, without restarting it: `null` is
   * automatic routing, `[]` is silent, a list is the new matrix. Applies from the
   * next sample the engine renders.
   */
  routing(cueId: string, outputs: AudioCrosspoint[] | null): Promise<AudioCommandResult>
  /** Move a live parameter over `durationMs`, starting at `whenMs`. */
  fade(
    cueId: string,
    param: AudioFadeParam,
    value: number,
    durationMs: number,
    curve: AudioFadeCurve,
    whenMs?: number
  ): Promise<AudioCommandResult>
  progress(cueId: string): Promise<AudioProgress | null>
  /** Fade every voice to silence and stop it. The main-process panic path calls this directly. */
  panic(fadeMs: number): Promise<AudioPanicResult>
  /** Current sample-clock ms, with the session identity it belongs to. */
  clock(): Promise<AudioClockReading>
  info(): Promise<AudioEngineInfo>
  devices(): Promise<AudioDeviceInfo[]>
  /** Apply device options. Rejects (with the reason) when the request cannot be honoured. */
  configure(options: DeviceOptions): Promise<AudioEngineInfo>
  /**
   * The peak envelope of a region of a file, in `points` buckets of interleaved
   * min/max. No region is the whole file. A region long enough that one of its buckets
   * is wider than a pixel of wall time comes back `sampled` — measured from taps rather
   * than every sample — and a shorter one is read in full.
   */
  waveform(filePath: string, points: number, region?: AudioRegion): Promise<AudioWaveform>
  /**
   * Where the notes and hits begin in a region of a file, for placing slice boundaries.
   * No region is the whole file, which on a long one is a scan of it: ask for the part
   * that is on screen. `sensitivity` 1 is the default, higher is stricter — fewer
   * onsets, for a file whose noise floor keeps crossing the threshold — and `maxOnsets`
   * caps the reply.
   */
  onsets(filePath: string, sensitivity?: number, maxOnsets?: number, region?: AudioRegion): Promise<AudioOnsets>
  /**
   * Where a file's sound starts and stops, from a scan of its samples. The whole file
   * is read — on a long one that is a pass over it, so ask when a cue is added or its
   * file changes, not on every frame. `thresholdDb` defaults to
   * `AUDIO_SILENCE_THRESHOLD_DB`; a value outside the engine's workable range is
   * clamped rather than refused, the way an oversized point count is.
   */
  silence(filePath: string, thresholdDb?: number): Promise<AudioSilence>
  /** Subscribe to engine events. Returns the unsubscribe function. */
  onEvents(callback: (events: AudioEngineEvent[]) => void): () => void
  /** File dialog for choosing a cue's media. */
  pickFile(): Promise<string | null>
}

/** Payloads for each invoke channel, for preload and the main handlers. */
export interface AudioPreparePayload {
  cueId: string
  filePath: string
}
export interface AudioProbePayload {
  filePath: string
}
export interface AudioStartPayload {
  cueId: string
  whenMs: number
  options: AudioStartOptions
}
export interface AudioStopPayload {
  cueId: string
  fadeMs: number
  whenMs?: number
}
export interface AudioStopAllPayload {
  fadeMs: number
}
export interface AudioSeekPayload {
  cueId: string
  positionMs: number
  whenMs?: number
}
export interface AudioReleasePayload {
  cueId: string
  whenMs?: number
  /** Where to play out to, in file ms; absent is the end of the file. */
  endMs?: number
}
export interface AudioHoldPayload {
  cueId: string
  whenMs?: number
}
export interface AudioCancelPayload {
  cueId: string
  whenMs?: number
}
export interface AudioRoutingPayload {
  cueId: string
  /** Null is automatic routing, an empty list is silence, otherwise the new matrix. */
  outputs: AudioCrosspoint[] | null
}
export interface AudioFadePayload {
  cueId: string
  param: AudioFadeParam
  value: number
  durationMs: number
  curve: AudioFadeCurve
  whenMs?: number
}
export interface AudioProgressPayload {
  cueId: string
}
export interface AudioPanicPayload {
  fadeMs: number
}
export interface AudioConfigurePayload {
  options: DeviceOptions
}
export interface AudioOnsetsPayload {
  filePath: string
  /** 1 is the default; higher is stricter, lower finds more. */
  sensitivity?: number
  maxOnsets?: number
  /** A window into the file; absent means the whole file. */
  startMs?: number
  endMs?: number
}
export interface AudioWaveformPayload {
  filePath: string
  points: number
  /** A window into the file; absent means the whole file. */
  startMs?: number
  endMs?: number
}
export interface AudioSilencePayload {
  filePath: string
  /** dBFS below which a sample is silence; absent leaves the decision to the engine. */
  thresholdDb?: number
}