// The engine, faked for unit tests. The scheduler runs off `Date.now()` and the ticker
// below, so `vi.advanceTimersByTime` moves playback time exactly as a show would — and
// the same tests can advance it unevenly to prove scheduled times do not move with it.
import { vi } from 'vitest'
import { AUDIO_PROTOCOL_VERSION } from '../../../../shared/audio'
import type { AudioEngineClient } from '../audioEngineClient'

const subscribers = new Set<() => void>()
let ticker: number | null = null

const startTicker = (): void => {
  if (ticker !== null) return
  ticker = setInterval(() => {
    for (const cb of [...subscribers]) cb()
  }, 25) as unknown as number
}

export const audioEngine = {
  nowMs: () => Date.now(),
  // The fake engine's clock is the show's: one epoch, no restart.
  engineTime: (showMs: number) => showMs,
  showTime: (engineMs: number) => engineMs,
  syncClock: vi.fn(async () => Date.now()),
  onTick: (cb: () => void) => {
    subscribers.add(cb)
    startTicker()
    return () => {
      subscribers.delete(cb)
      if (subscribers.size === 0 && ticker !== null) {
        clearInterval(ticker)
        ticker = null
      }
    }
  },
  onEvent: vi.fn(() => () => {}),
  onSessionChange: vi.fn(() => () => {}),
  sessionWarnings: vi.fn(() => []),
  prepare: vi.fn(async (cueId: string, filePath: string) => ({
    cueId,
    filePath,
    format: 'wav' as const,
    durationMs: 0,
    sampleRate: 48000,
    channels: 2,
    frames: null,
    fileBytes: 0,
    streaming: false,
    cacheHit: false,
    decodedBytes: 0
  })),
  start: vi.fn(async (cueId: string, startAtMs: number) => ({
    cueId,
    runId: `run-${cueId}`,
    state: 'playing' as const,
    startAtMs
  })),
  stop: vi.fn(async (at: number) => ({ ok: true as const, at, applied: true })),
  stopAll: vi.fn(async (at: number) => ({ ok: true as const, at, applied: true })),
  seek: vi.fn(async (positionMs: number) => ({
    ok: true as const,
    at: Date.now(),
    positionMs,
    state: 'playing' as const
  })),
  cancel: vi.fn(async (at: number) => ({ ok: true as const, at, canceled: 0 })),
  routing: vi.fn(async (at: number) => ({ ok: true as const, at, applied: true })),
  fade: vi.fn(async (at: number) => ({ ok: true as const, at, applied: true })),
  progress: vi.fn(async () => null),
  panic: vi.fn(async (at: number) => ({ ok: true as const, at, stoppedVoices: 0 })),
  clock: vi.fn(async () => ({ clockMs: Date.now(), sessionId: 'test-session' })),
  info: vi.fn(async () => ({
    name: 'test',
    version: '0',
    protocol: AUDIO_PROTOCOL_VERSION,
    sessionId: 'test-session',
    backend: 'silent' as const,
    deviceId: null,
    deviceName: 'Default',
    sampleRate: 48000,
    channels: 2,
    format: 'f32',
    exclusive: false,
    bufferFrames: 512,
    periodFrames: null,
    latencyMs: null,
    latencySource: 'unknown' as const,
    active: false,
    activeVoices: 0,
    activeCues: [],
    cache: {
      entries: 0, bytes: 0, limitBytes: 0, maxFiles: 100, maxFileBytes: 0,
      hits: 0, misses: 0, evictions: 0, bypassed: 0, pinnedEntries: 0, pinnedBytes: 0
    },
    media: {
      activeVoices: 0, streamingVoices: 0, residentBytes: 0, streamBufferBytes: 0,
      streamBufferLimitBytes: 0, decodeQueueDepth: 0, decodeUnderruns: 0, xruns: 0,
      droppedFileChunks: 0
    },
    lastError: null,
    warnings: []
  })),
  devices: vi.fn(async () => []),
  configure: vi.fn(async () => {
    throw new Error('not configured in this test')
  }),
  waveform: vi.fn(async () => ({
    filePath: '',
    buckets: 0,
    values: [],
    durationMs: 0,
    sampleRate: 48000,
    channels: 2,
    truncated: false
  })),
  silence: vi.fn(async (filePath: string) => ({
    filePath,
    startMs: 0,
    endMs: 0,
    durationMs: 0,
    sampleRate: 48000,
    channels: 2,
    silent: true
  })),
  probe: vi.fn(async (filePath: string) => ({
    filePath,
    format: 'wav' as const,
    durationMs: 0,
    sampleRate: 48000,
    channels: 2,
    frames: null,
    fileBytes: 0,
    decodedBytes: null,
    streaming: false,
    resident: false
  })),
  pickFile: vi.fn(async () => null),
  getProgress: vi.fn(() => null)
} as unknown as AudioEngineClient
