import type {
  AudioCancelResult,
  AudioCommandResult,
  AudioEngineInfo,
  AudioMetadata,
  AudioPanicResult,
  AudioProbe,
  AudioSeekResult,
  AudioStartResult
} from '../shared/audio'
import { AUDIO_PROTOCOL_VERSION } from '../shared/audio'
import type { CuerunnerBridge } from '../shared/ipc'
import type { ReportEmailResult, ReportInput, ReportSaveResult } from '../shared/ipc/app'
import type { RedundancyConfigureResult } from '../shared/ipc/redundancy'
import type {
  RelinkedWorkspace,
  WorkspaceCompareResult,
  WorkspaceDemoResult,
  WorkspaceExportResult,
  WorkspaceImportResult,
  WorkspaceMergeResult,
  WorkspaceOpenPathResult,
  WorkspaceOpenResult,
  WorkspaceSaveResult
} from '../shared/ipc/workspace'
import type { RedundancySettings } from '../shared/redundancy'
import type { ScriptDocument } from '../shared/show'
import type { Workspace } from '../shared/workspace'

/**
 * The least a declared answer can carry: a show with no cues and none of the optional
 * sections, and no files missing. The three members below answer with it because their
 * callers read the shape rather than call counts, and a test that cares what the answer
 * holds hands its own to `mockResolvedValue`.
 */
function emptyWorkspace(): Workspace {
  return {
    version: 1,
    id: 'test-workspace',
    name: 'Test Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: []
  }
}

/**
 * The engine's own record, as the mock reports it. `info()` and a `configure()` that took
 * answer with the same description of the running engine, so both readers are given the
 * whole of it rather than whatever half a mock was written with. A fresh object per call,
 * because a test that writes to what it was handed must not change what the next one is
 * handed — one shared fixture would leak across calls and across test files.
 */
function engineInfo(): AudioEngineInfo {
  return {
    name: 'Test engine',
    version: '0.0.0',
    protocol: AUDIO_PROTOCOL_VERSION,
    sessionId: 'test-session',
    backend: 'silent',
    deviceId: null,
    deviceName: 'Silent',
    sampleRate: 48000,
    channels: 2,
    format: 'f32',
    exclusive: false,
    bufferFrames: 512,
    periodFrames: 512,
    latencyMs: null,
    latencySource: 'unknown',
    active: false,
    activeVoices: 0,
    activeCues: [],
    cache: {
      entries: 0, bytes: 0, limitBytes: 0, maxFiles: 0, maxFileBytes: 0,
      hits: 0, misses: 0, evictions: 0, bypassed: 0, pinnedEntries: 0, pinnedBytes: 0
    },
    media: {
      activeVoices: 0, streamingVoices: 0, residentBytes: 0, streamBufferBytes: 0,
      streamBufferLimitBytes: 0, decodeQueueDepth: 0, decodeUnderruns: 0, xruns: 0,
      droppedFileChunks: 0
    },
    lastError: null,
    warnings: []
  }
}

/** A machine that has never been paired: off, live, and alone. */
const redundancySettings = {
  enabled: false,
  name: 'test-machine',
  id: 'test-machine-id',
  role: 'live',
  port: 53110,
  peerHost: '',
  peerPort: 53110,
  token: '',
  timeoutMs: 3000,
  takeover: 'manual'
} satisfies RedundancySettings

// Global window.cuerunner mock — the preload's own bridge, checked against the composed
// type the preload implements (src/shared/ipc). A member added, renamed or removed there
// fails to compile here until this mock follows, which is the point of the annotation.
Object.defineProperty(window, 'cuerunner', {
  value: {
    platform: 'win32',
    getPathForFile: vi.fn(() => 'C:\\show\\track01.wav'),
    app: {
      rendererCrash: vi.fn(() => Promise.resolve(null)),
      onMainError: vi.fn(() => () => {}),
      drainMainErrors: vi.fn(() => Promise.resolve([])),
      composeReport: vi.fn((input: ReportInput) => Promise.resolve(`REPORT\n${input.description}`)),
      saveReport: vi.fn((): Promise<ReportSaveResult> => Promise.resolve({ ok: true, path: null })),
      emailReport: vi.fn((): Promise<ReportEmailResult> => Promise.resolve({ ok: true })),
      onCloseRequested: vi.fn(() => () => {}),
      onMenuAction: vi.fn(() => () => {}),
      confirmClose: vi.fn(() => Promise.resolve())
    },
    playback: {
      heartbeat: vi.fn(() => undefined),
      onPanic: vi.fn(() => () => {})
    },
    // Plain vi.fn methods shaped like the native service's verbs. The renderer never
    // decodes or streams media: it schedules commands and reads state back.
    audio: {
      prepare: vi.fn((): Promise<AudioMetadata> => Promise.resolve({
        cueId: 'cue', filePath: '', format: 'wav', durationMs: 0, sampleRate: 48000,
        channels: 2, frames: 0, fileBytes: 0, streaming: false, cacheHit: false, decodedBytes: 0
      })),
      start: vi.fn((): Promise<AudioStartResult> => Promise.resolve({
        cueId: 'cue', runId: 'run', state: 'playing', startAtMs: 0
      })),
      stop: vi.fn((): Promise<AudioCommandResult> => Promise.resolve({ ok: true, at: 0, applied: true })),
      stopAll: vi.fn((): Promise<AudioCommandResult> => Promise.resolve({ ok: true, at: 0, applied: true })),
      seek: vi.fn((): Promise<AudioSeekResult> => Promise.resolve({
        ok: true, at: 0, positionMs: 0, state: 'playing'
      })),
      release: vi.fn((): Promise<AudioCommandResult> => Promise.resolve({ ok: true, at: 0, applied: true })),
      onsets: vi.fn(() => Promise.resolve({
        filePath: '', onsetsMs: [], durationMs: 0, sampleRate: 48000, channels: 2,
        truncated: false, startMs: 0, endMs: 0
      })),
      silence: vi.fn(() => Promise.resolve({
        filePath: '', startMs: 0, endMs: 0, durationMs: 0, sampleRate: 48000, channels: 2, silent: true
      })),
      cancel: vi.fn((): Promise<AudioCancelResult> => Promise.resolve({ ok: true, at: 0, canceled: 0 })),
      routing: vi.fn((): Promise<AudioCommandResult> => Promise.resolve({ ok: true, at: 0, applied: true })),
      fade: vi.fn((): Promise<AudioCommandResult> => Promise.resolve({ ok: true, at: 0, applied: true })),
      progress: vi.fn(() => Promise.resolve(null)),
      panic: vi.fn((): Promise<AudioPanicResult> => Promise.resolve({ ok: true, at: 0, stoppedVoices: 0 })),
      clock: vi.fn(() => Promise.resolve({ clockMs: Date.now(), sessionId: 'test-session' })),
      info: vi.fn(() => Promise.resolve(engineInfo())),
      devices: vi.fn(() => Promise.resolve([])),
      configure: vi.fn(() => Promise.resolve(engineInfo())),
      waveform: vi.fn(() => Promise.resolve({
        filePath: '', buckets: 0, values: [], durationMs: 0, sampleRate: 48000, channels: 2,
        truncated: false, startMs: 0, endMs: 0, sampled: false
      })),
      probe: vi.fn((): Promise<AudioProbe> => Promise.resolve({
        filePath: '', format: 'wav', durationMs: 0, sampleRate: 48000, channels: 2,
        frames: null, fileBytes: 0, decodedBytes: null, streaming: false, resident: false
      })),
      onEvents: vi.fn(() => () => {}),
      pickFile: vi.fn(() => Promise.resolve(null))
    },
    midi: {
      listPorts: vi.fn(() => Promise.resolve([])),
      listInputPorts: vi.fn(() => Promise.resolve([])),
      status: vi.fn(() => Promise.resolve({ available: true, error: null })),
      send: vi.fn(() => Promise.resolve({ ok: true })),
      sendTcp: vi.fn(() => Promise.resolve({ ok: true }))
    },
    network: {
      request: vi.fn(() => Promise.resolve({
        ok: true, status: 200, statusText: 'OK', body: '', error: null
      })),
      cancel: vi.fn(() => Promise.resolve(false))
    },
    osc: {
      send: vi.fn(() => Promise.resolve({ ok: true }))
    },
    show: {
      snapshot: vi.fn(() => Promise.resolve({
        at: Date.now(), services: [], devices: [], alerts: [], events: []
      })),
      configure: vi.fn(() => Promise.resolve()),
      command: vi.fn(() => Promise.resolve({ ok: true })),
      restart: vi.fn(() => Promise.resolve({ ok: true })),
      // A machine that holds nothing for any receiver: the answer a fresh install gives.
      ewDxCredentials: vi.fn(() => Promise.resolve({ hasPassword: false, encrypted: true, fingerprint: null, serial: null, moved: null })),
      ewDxSetPassword: vi.fn(() => Promise.resolve({
        ok: true as const, hasPassword: true, encrypted: true, fingerprint: null, serial: null, moved: null
      })),
      ewDxTrustAgain: vi.fn(() => Promise.resolve({
        ok: true as const, hasPassword: true, encrypted: true, fingerprint: null, serial: null, moved: null
      })),
      ewDxForget: vi.fn(() => Promise.resolve({ hasPassword: false, encrypted: true, fingerprint: null, serial: null, moved: null })),
      // A network with no receivers on it: what a laptop at home finds.
      ewDxDiscover: vi.fn(() => Promise.resolve({ receivers: [], error: null })),
      onEvents: vi.fn(() => () => {})
    },
    license: {
      status: vi.fn(() => Promise.resolve({ state: 'unlicensed' as const })),
      activate: vi.fn(() => Promise.resolve({
        ok: false, error: 'Unit tests run unlicensed', status: { state: 'unlicensed' as const }
      })),
      deactivate: vi.fn(() => Promise.resolve({ state: 'unlicensed' as const })),
      onChanged: vi.fn(() => () => {})
    },
    redundancy: {
      settings: vi.fn(() => Promise.resolve({ ...redundancySettings })),
      configure: vi.fn((patch: Partial<RedundancySettings>): Promise<RedundancyConfigureResult> =>
        Promise.resolve({ ok: true, settings: { ...redundancySettings, ...patch } }))
    },
    script: {
      readFile: vi.fn(() => Promise.resolve({ ok: true as const, code: '', path: '' })),
      pickFile: vi.fn(() => Promise.resolve(null)),
      readDocument: vi.fn((): Promise<ScriptDocument> => Promise.resolve({ ok: true, lines: [] })),
      shell: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', code: 0, signal: null }))
    },
    workspace: {
      open: vi.fn((): Promise<WorkspaceOpenResult> => Promise.resolve({ ok: true, opened: null })),
      // These three answer with the shape their channel declares rather than nothing at
      // all: a test's handle on them is then checked against the answer the window reads,
      // not against the member's name, and one that forgets to stub still reads a show.
      openPath: vi.fn((): Promise<WorkspaceOpenPathResult> => Promise.resolve({
        ok: true,
        opened: {
          // A path main could have produced: an empty one would let a caller that reads the
          // path pass on a value no read can answer with.
          path: 'Test Show.cuerunner',
          workspace: emptyWorkspace(),
          missingMedia: [],
          loadNotes: []
        }
      })),
      openDemo: vi.fn((): Promise<WorkspaceDemoResult> =>
        Promise.resolve({ ok: true, workspace: emptyWorkspace() })),
      relink: vi.fn((): Promise<RelinkedWorkspace> => Promise.resolve({
        workspace: emptyWorkspace(),
        missingMedia: []
      })),
      save: vi.fn((): Promise<WorkspaceSaveResult> => Promise.resolve({ ok: true, saved: null })),
      saveAs: vi.fn((): Promise<WorkspaceSaveResult> => Promise.resolve({ ok: true, saved: null })),
      compare: vi.fn((): Promise<WorkspaceCompareResult> => Promise.resolve({ ok: true, comparison: null })),
      exportBundle: vi.fn((): Promise<WorkspaceExportResult> => Promise.resolve({ ok: true, exported: null })),
      merge: vi.fn((): Promise<WorkspaceMergeResult> => Promise.resolve({ ok: true, merged: null })),
      importBundle: vi.fn((): Promise<WorkspaceImportResult> => Promise.resolve({ ok: true, imported: null })),
      recent: vi.fn(() => Promise.resolve([])),
      autosave: vi.fn(() => Promise.resolve()),
      recovery: vi.fn(() => Promise.resolve({ ok: true as const, recovery: null })),
      clearRecovery: vi.fn(() => Promise.resolve()),
      setTitle: vi.fn(() => Promise.resolve()),
      confirmClose: vi.fn((): Promise<0 | 1 | 2> => Promise.resolve(0))
    }
  } satisfies CuerunnerBridge,
  writable: true
})

// A bare `localStorage` is how the renderer reads its own window storage, and in these
// tests it was Node's: Node defines `globalThis.localStorage` (undefined until the
// process is given --localstorage-file), and vitest only copies the window keys it has in
// its own list, so jsdom's storage never reached the global. Every read and write in the
// test — and in the component under test — hit that stub and, behind the dock's
// try/catch, quietly did nothing. vitest hangs its JSDOM instance off the global for the
// length of a test file; nothing types it, so the one access is asserted here.
const jsdomEnv = globalThis as unknown as { jsdom?: { window: Window } }
const jsdomWindow = jsdomEnv.jsdom?.window
if (jsdomWindow) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, {
      value: jsdomWindow[key], configurable: true, writable: true
    })
  }
}
