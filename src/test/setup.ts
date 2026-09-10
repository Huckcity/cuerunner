// Global window.winslab mock — mirrors the preload bridge shape
Object.defineProperty(window, 'winslab', {
  value: {
    app: {
      rendererCrash: vi.fn(() => Promise.resolve(null)),
      onMainError: vi.fn(() => () => {}),
      onCloseRequested: vi.fn(() => () => {}),
      onMenuAction: vi.fn(() => () => {}),
      confirmClose: vi.fn(() => Promise.resolve())
    },
    audio: {
      readFile: vi.fn(() => Promise.resolve(new ArrayBuffer(0))),
      pickFile: vi.fn(() => Promise.resolve(null))
    },
    midi: {
      listPorts: vi.fn(() => Promise.resolve([])),
      send: vi.fn(() => Promise.resolve({ ok: true }))
    },
    osc: {
      send: vi.fn(() => Promise.resolve({ ok: true })),
      startListener: vi.fn(() => Promise.resolve())
    },
    script: {
      readFile: vi.fn(() => Promise.resolve('')),
      shell: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', code: 0, signal: null }))
    },
    workspace: {
      open: vi.fn(() => Promise.resolve(null)),
      openPath: vi.fn(),
      openDemo: vi.fn(),
      save: vi.fn(() => Promise.resolve(null)),
      saveAs: vi.fn(() => Promise.resolve(null)),
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
