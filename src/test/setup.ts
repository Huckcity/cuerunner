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
      send: vi.fn(() => Promise.resolve())
    },
    osc: {
      send: vi.fn(() => Promise.resolve()),
      startListener: vi.fn(() => Promise.resolve())
    },
    script: {
      readFile: vi.fn(() => Promise.resolve(''))
    }
  },
  writable: true
})
