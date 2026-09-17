/// <reference types="vite/client" />

// The window's bridge is the preload's, declared where both processes can read it:
// src/shared/ipc composes every namespace into one `CuerunnerBridge`, and the preload is
// checked against that type. Nothing per-domain is restated here — a signature written
// twice is the drift this file used to hold.

import type { CuerunnerBridge } from '../../shared/ipc'

declare global {
  interface Window {
    cuerunner: CuerunnerBridge
  }
}
