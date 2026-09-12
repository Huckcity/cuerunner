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

/** Protocol version of the JSON command/event wire format between main and native. */
export const AUDIO_PROTOCOL_VERSION = 1

/** Default stream format. The engine reports what it actually achieved in `info()`. */
export const AUDIO_DEFAULT_SAMPLE_RATE = 48000
export const AUDIO_DEFAULT_BUFFER_FRAMES = 512
export const AUDIO_DEFAULT_CHANNELS = 2

/**
 * Bounds. The native engine may be configured lower, never higher; `info()` reports
 * the limits in force. They exist so a buggy or hostile caller cannot make the engine
 * allocate without limit, and so every scheduling verb has a definite failure.
 */
export const AUDIO_LIMITS = {
  /** Voices that can be scheduled or playing at once. */
  maxVoices: 64,
  /** A single start's crosspoint matrix. */
  maxCrosspoints: 64,
  /** Output channels a voice can address (the device may have fewer). */
  maxOutputChannels: 32,
  /** Points a single `waveform()` call may return (min/max pairs per bucket). */
  maxWaveformPoints: 4096,
  /** How far ahead of the current sample clock a start may be scheduled. */
  scheduleHorizonMs: 10_000,
  /** Pending (future-dated) operations a cue may accumulate before rejecting new ones. */
  maxPendingOpsPerCue: 16,
  /** Pending (future-dated) operations across all cues. */
  maxPendingOps: 256,
  /** Decoded float data held for reuse, and how many files it may span. */
  cacheMaxBytes: 512 * 1024 * 1024,
  cacheMaxFiles: 100,
  /** Decoded size above which a file is streamed and never cached. */
  cacheMaxFileBytes: 32 * 1024 * 1024,
  /** Audio kept decoded ahead of the play position per streaming voice. */
  streamPrerollMs: 2000,
  /** Hard cap on decoded-but-unplayed bytes per voice and across all voices. */
  streamMaxBytesPerVoice: 16 * 1024 * 1024,
  streamMaxTotalBytes: 128 * 1024 * 1024,
  /** Bytes in a waveform scan are read in these chunks; never whole-file resident. */
  scanChunkFrames: 8192
} as const

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const AUDIO_CHANNELS = {
  prepare: 'audio:prepare',
  probe: 'audio:probe',
  start: 'audio:start',
  stop: 'audio:stop',
  stopAll: 'audio:stopAll',
  seek: 'audio:seek',
  cancel: 'audio:cancel',
  fade: 'audio:fade',
  routing: 'audio:routing',
  progress: 'audio:progress',
  panic: 'audio:panic',
  clock: 'audio:clock',
  info: 'audio:info',
  devices: 'audio:devices',
  configure: 'audio:configure',
  waveform: 'audio:waveform',
  pickFile: 'audio:pickFile',
  /** Main pushes AudioEngineEvent[] here; preload subscribes with `onEvents`. */
  events: 'audio:events'
} as const

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
  return Math.max(1, Math.min(AUDIO_LIMITS.maxWaveformPoints, Math.floor(points)))
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

export type AudioEventType = 'ended' | 'error' | 'panic' | 'state'

export interface AudioEndedEvent {
  type: 'ended'
  cueId: string
  runId: string
  at: number
  reason: AudioEndReason
  loopsCompleted: number
}

export interface AudioErrorEvent {
  type: 'error'
  at: number
  /** Null when the fault belongs to the engine rather than one cue (device loss, spawn). */
  cueId: string | null
  runId: string | null
  code: AudioErrorCode
  message: string
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
  durationMs: number
  sampleRate: number
  channels: number
  /** True when the requested point count was clamped to the engine's limit. */
  truncated: boolean
}

/**
 * The renderer-facing bridge (`window.winslab.audio`). Main implements it in
 * src/main/audio/AudioEngine.ts + the IPC handlers; preload is a thin forwarder.
 */
export interface AudioEngineBridge {
  /**
   * Register a cue's file and measure it. Resolves with the metadata; does not start.
   * A small file is decoded into the cache here, an oversized one is marked streaming.
   */
  prepare(cueId: string, filePath: string): Promise<AudioMetadata>
  /**
   * Measure a media file without decoding it or touching the cache. Safe to call for
   * every cue in a workspace; `prepare` is still what warms a cue's media for playback.
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
  /** Drop the cue's future-dated verbs (a scheduled start, a scheduled stop/fade). */
  cancel(cueId: string, whenMs?: number): Promise<AudioCancelResult>
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
  /** Current sample-clock ms. */
  clock(): Promise<number>
  info(): Promise<AudioEngineInfo>
  devices(): Promise<AudioDeviceInfo[]>
  /** Apply device options. Rejects (with the reason) when the request cannot be honoured. */
  configure(options: DeviceOptions): Promise<AudioEngineInfo>
  waveform(filePath: string, points: number): Promise<AudioWaveform>
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
export interface AudioWaveformPayload {
  filePath: string
  points: number
}