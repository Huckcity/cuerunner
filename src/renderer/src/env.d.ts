/// <reference types="vite/client" />

import type { OscArg } from './types/cue'
import type { Workspace } from './types/workspace'
import type { ShowEvent, ShowSettings, ShowSnapshot } from './types/show'

interface WinslabBridge {
  getPathForFile: (file: File) => string
  app: {
    onCloseRequested: (callback: () => void) => () => void
    onMenuAction: (callback: (action: 'undo' | 'redo') => void) => () => void
    confirmClose: () => Promise<void>
    rendererCrash: () => Promise<{ reason: string; at: number } | null>
    onMainError: (callback: (message: string) => void) => () => void
    drainMainErrors: () => Promise<string[]>
  }
  audio: {
    readFile: (filePath: string) => Promise<ArrayBuffer>
    pickFile: () => Promise<string | null>
  }
  midi: {
    listPorts: () => Promise<string[]>
    listInputPorts: () => Promise<string[]>
    send: (cmd: { portName: string; messages: any[] }) => Promise<{ ok: boolean; error?: string }>
  }
  osc: {
    send: (cmd: { host: string; port: number; address: string; args: OscArg[] }) => Promise<{ ok: boolean; error?: string }>
  }
  show: {
    snapshot: () => Promise<ShowSnapshot>
    configure: (settings: ShowSettings) => Promise<void>
    command: (
      service: string,
      action: string,
      payload?: unknown
    ) => Promise<{ ok: boolean; result?: unknown; error?: string }>
    restart: (service: string) => Promise<{ ok: boolean; result?: unknown; error?: string }>
    onEvents: (callback: (events: ShowEvent[]) => void) => () => void
  }
  script: {
    readFile: (
      relativePath: string,
      workspacePath: string | null,
      base?: string
    ) => Promise<{ code: string; path: string }>
    shell: (
      command: string,
      options?: { timeout?: number; cwd?: string; env?: Record<string, string> }
    ) => Promise<{ stdout: string; stderr: string; code: number | null; signal: string | null }>
  }
  workspace: {
    open: () => Promise<{ path: string; workspace: Workspace } | null>
    openPath: (filePath: string) => Promise<{ path: string; workspace: Workspace }>
    openDemo: () => Promise<Workspace>
    save: (workspace: Workspace, existingPath: string | null) => Promise<string | null>
    saveAs: (workspace: Workspace) => Promise<string | null>
    recent: () => Promise<string[]>
    autosave: (workspace: Workspace, sourcePath: string | null) => Promise<void>
    recovery: () => Promise<{ workspace: Workspace; savedAt: number; sourcePath: string | null } | null>
    clearRecovery: () => Promise<void>
    setTitle: (title: string) => Promise<void>
    confirmClose: (workspaceName: string) => Promise<0 | 1 | 2>
  }
}

declare global {
  interface Window {
    winslab: WinslabBridge
  }
}
