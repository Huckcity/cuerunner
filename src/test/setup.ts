// Global window.cuerunner mock — mirrors the preload bridge shape
Object.defineProperty(window, 'cuerunner', {
  value: {
    platform: 'win32',
    app: {
      rendererCrash: vi.fn(() => Promise.resolve(null)),
      onMainError: vi.fn(() => () => {}),
      drainMainErrors: vi.fn(() => Promise.resolve([])),
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
      prepare: vi.fn(() => Promise.resolve({
        cueId: 'cue', filePath: '', format: 'wav', durationMs: 0, sampleRate: 48000,
        channels: 2, frames: 0, fileBytes: 0, streaming: false, cacheHit: false, decodedBytes: 0
      })),
      start: vi.fn(() => Promise.resolve({
        cueId: 'cue', runId: 'run', state: 'playing', startAtMs: 0
      })),
      stop: vi.fn(() => Promise.resolve({ ok: true, at: 0, applied: true })),
      stopAll: vi.fn(() => Promise.resolve({ ok: true, at: 0, applied: true })),
      seek: vi.fn(() => Promise.resolve({ ok: true, at: 0, positionMs: 0, state: 'playing' })),
      release: vi.fn(() => Promise.resolve({ ok: true, at: 0, applied: true })),
      onsets: vi.fn(() => Promise.resolve({ filePath: '', onsetsMs: [], durationMs: 0, sampleRate: 48000, channels: 2, truncated: false })),
      silence: vi.fn(() => Promise.resolve({ filePath: '', startMs: 0, endMs: 0, durationMs: 0, sampleRate: 48000, channels: 2, silent: true })),
      cancel: vi.fn(() => Promise.resolve({ ok: true, at: 0, canceled: 0 })),
      routing: vi.fn(() => Promise.resolve({ ok: true, at: 0, applied: true })),
      fade: vi.fn(() => Promise.resolve({ ok: true, at: 0, applied: true })),
      progress: vi.fn(() => Promise.resolve(null)),
      panic: vi.fn(() => Promise.resolve({ ok: true, at: 0, stoppedVoices: 0 })),
      clock: vi.fn(() => Promise.resolve({ clockMs: Date.now(), sessionId: 'test-session' })),
      info: vi.fn(() => Promise.resolve({
        name: 'Test engine',
        version: '0.0.0',
        protocol: 2,
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
      })),
      devices: vi.fn(() => Promise.resolve([])),
      configure: vi.fn(() => Promise.resolve({
        name: 'Test engine', version: '0.0.0', protocol: 1, backend: 'silent'
      })),
      waveform: vi.fn(() => Promise.resolve({
        filePath: '', buckets: 0, values: [], durationMs: 0,
        sampleRate: 48000, channels: 2, truncated: false
      })),
      probe: vi.fn(() => Promise.resolve({
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
      onEvents: vi.fn(() => () => {})
    },
    license: {
      status: vi.fn(() => Promise.resolve({ state: 'unlicensed' })),
      activate: vi.fn(() => Promise.resolve({
        ok: false, error: 'Unit tests run unlicensed', status: { state: 'unlicensed' }
      })),
      deactivate: vi.fn(() => Promise.resolve({ state: 'unlicensed' })),
      onChanged: vi.fn(() => () => {})
    },
    redundancy: {
      // A machine that has never been paired: off, live, and alone.
      settings: vi.fn(() => Promise.resolve({
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
      })),
      configure: vi.fn((patch: Record<string, unknown>) => Promise.resolve({
        ok: true,
        settings: {
          enabled: false,
          name: 'test-machine',
          id: 'test-machine-id',
          role: 'live',
          port: 53110,
          peerHost: '',
          peerPort: 53110,
          token: '',
          timeoutMs: 3000,
          takeover: 'manual',
          ...patch
        }
      }))
    },
    script: {
      readFile: vi.fn(() => Promise.resolve({ code: '', path: '' })),
      pickFile: vi.fn(() => Promise.resolve(null)),
      readDocument: vi.fn(() => Promise.resolve({ ok: true, lines: [] })),
      shell: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', code: 0, signal: null }))
    },
    workspace: {
      open: vi.fn(() => Promise.resolve(null)),
      openPath: vi.fn(),
      openDemo: vi.fn(),
      relink: vi.fn(),
      save: vi.fn(() => Promise.resolve(null)),
      saveAs: vi.fn(() => Promise.resolve(null)),
      compare: vi.fn(() => Promise.resolve({ ok: true, comparison: null })),
      exportBundle: vi.fn(() => Promise.resolve({ ok: true, exported: null })),
      merge: vi.fn(() => Promise.resolve({ ok: true, merged: null })),
      importBundle: vi.fn(() => Promise.resolve({ ok: true, imported: null })),
      recent: vi.fn(() => Promise.resolve([])),
      autosave: vi.fn(() => Promise.resolve()),
      recovery: vi.fn(() => Promise.resolve(null)),
      clearRecovery: vi.fn(() => Promise.resolve()),
      setTitle: vi.fn(() => Promise.resolve()),
      confirmClose: vi.fn(() => Promise.resolve(0))
    }
  },
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
