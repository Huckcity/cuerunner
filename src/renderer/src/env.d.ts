/// <reference types="vite/client" />

import type { MidiMessageKind, OscArg } from './types/cue'
import type { Workspace } from './types/workspace'
import type { ShowEvent, ShowSettings, ShowSnapshot, ScriptDocument } from './types/show'
import type { ActivationResult, LicenseStatus } from './types/license'
import type { MidiAvailability } from './types/midi'
import type { NetworkRequest, NetworkResult } from './types/network'
import type { PlaybackPanic } from './types/playback'
import type { MissingMedia } from '../../shared/media'
import type { RedundancySettings } from '../../shared/redundancy'
import type { AudioEngineBridge } from '../../shared/audio'
import type { MenuAction } from '../../shared/fileMenu'

interface WinslabBridge {
  /** `process.platform` of the machine the app is running on. */
  platform: string
  getPathForFile: (file: File) => string
  app: {
    onCloseRequested: (callback: () => void) => () => void
    onMenuAction: (callback: (action: MenuAction) => void) => () => void
    confirmClose: () => Promise<void>
    rendererCrash: () => Promise<{ reason: string; at: number } | null>
    onMainError: (callback: (message: string) => void) => () => void
    drainMainErrors: () => Promise<string[]>
  }
  playback: {
    /** Says the window is alive; main silences the show when these stop arriving. */
    heartbeat: () => void
    /** A panic main decided on, so pending cues and scripts are cancelled. */
    onPanic: (callback: (panic: PlaybackPanic) => void) => () => void
  }
  /** The native audio engine, one verb at a time — including the media picker.
   *  See src/shared/audio.ts. */
  audio: AudioEngineBridge
  midi: {
    listPorts: () => Promise<string[]>
    listInputPorts: () => Promise<string[]>
    status: () => Promise<MidiAvailability>
    send: (cmd: { portName: string; messages: MidiMessageKind[] }) => Promise<{ ok: boolean; error?: string }>
    sendTcp: (cmd: { host: string; port: number; messages: MidiMessageKind[] }) => Promise<{ ok: boolean; error?: string }>
  }
  network: {
    request: (request: NetworkRequest) => Promise<NetworkResult>
    cancel: (requestId: string) => Promise<boolean>
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
  license: {
    status: () => Promise<LicenseStatus>
    activate: (text: string) => Promise<ActivationResult>
    deactivate: () => Promise<LicenseStatus>
    onChanged: (callback: (status: LicenseStatus) => void) => () => void
  }
  /** Redundant playback: this machine's half of a pair, kept with the machine. */
  redundancy: {
    settings: () => Promise<RedundancySettings>
    configure: (
      patch: Partial<RedundancySettings>
    ) => Promise<{ ok: boolean; settings: RedundancySettings; error?: string }>
  }
  script: {
    readFile: (
      relativePath: string,
      workspacePath: string | null,
      base?: string
    ) => Promise<{ code: string; path: string }>
    pickFile: () => Promise<string | null>
    readDocument: (filePath: string, workspacePath: string | null) => Promise<ScriptDocument>
    shell: (
      command: string,
      options?: { timeout?: number; cwd?: string; env?: Record<string, string> }
    ) => Promise<{ stdout: string; stderr: string; code: number | null; signal: string | null }>
  }
  workspace: {
    open: () => Promise<{ path: string; workspace: Workspace; missingMedia: MissingMedia[] } | null>
    openPath: (filePath: string) => Promise<{ path: string; workspace: Workspace; missingMedia: MissingMedia[] }>
    openDemo: () => Promise<Workspace>
    relink: (
      workspace: Workspace,
      workspacePath: string | null,
      cueId: string
    ) => Promise<{ workspace: Workspace; missingMedia: MissingMedia[] }>
    save: (
      workspace: Workspace,
      existingPath: string | null
    ) => Promise<{ path: string; history: ShowHistoryEntry[] } | null>
    saveAs: (workspace: Workspace) => Promise<{ path: string; history: ShowHistoryEntry[] } | null>
    recent: () => Promise<string[]>
    autosave: (workspace: Workspace, sourcePath: string | null, selectedCueId: string | null) => Promise<void>
    recovery: () => Promise<{
      workspace: Workspace
      savedAt: number
      sourcePath: string | null
      selectedCueId?: string | null
      missingMedia: MissingMedia[]
    } | null>
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
