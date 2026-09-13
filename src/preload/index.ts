import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Workspace } from '../renderer/src/types/workspace'
import type { ShowEvent, ShowSettings, ShowSnapshot, ScriptDocument } from '../renderer/src/types/show'
import type { ActivationResult, LicenseStatus } from '../renderer/src/types/license'
import type { MidiAvailability } from '../renderer/src/types/midi'
import type { NetworkRequest, NetworkResult } from '../renderer/src/types/network'
import type { PlaybackPanic } from '../renderer/src/types/playback'
import type { MissingMedia } from '../shared/media'
import {
  AUDIO_CHANNELS,
  type AudioCancelPayload,
  type AudioCancelResult,
  type AudioClockReading,
  type AudioCommandResult,
  type AudioConfigurePayload,
  type AudioCrosspoint,
  type AudioDeviceInfo,
  type AudioEngineBridge,
  type AudioEngineEvent,
  type AudioEngineInfo,
  type AudioFadeCurve,
  type AudioFadeParam,
  type AudioFadePayload,
  type AudioMetadata,
  type AudioPanicPayload,
  type AudioPanicResult,
  type AudioPreparePayload,
  type AudioProgress,
  type AudioProgressPayload,
  type AudioProbe,
  type AudioProbePayload,
  type AudioRoutingPayload,
  type AudioSeekPayload,
  type AudioSeekResult,
  type AudioStartOptions,
  type AudioStartPayload,
  type AudioStartResult,
  type AudioStopAllPayload,
  type AudioStopPayload,
  type AudioWaveform,
  type AudioWaveformPayload,
  type DeviceOptions
} from '../shared/audio'
import type { MenuAction } from '../shared/fileMenu'
import { unwrapAudioResult, type AudioResult } from '../shared/audioResult'

/**
 * One audio verb, unwrapped here in the window.
 *
 * The main process answers with the engine's own `{ ok, value } | { ok, code, message }`
 * rather than by rejecting, because Electron logs every rejected `ipcMain.handle` to
 * stderr with a stack and this path refuses by design. Turning a refusal back into an
 * exception in this process — where a rejection is just a rejection, and nothing logs it —
 * keeps every caller reading exactly what it read before, `AudioEngineError` and all.
 */
const invokeAudio = async <T>(channel: string, payload?: unknown): Promise<T> =>
  unwrapAudioResult((await ipcRenderer.invoke(channel, payload)) as AudioResult<T>)

contextBridge.exposeInMainWorld('winslab', {
  // Which keyboard the labels should be written for: ⌘ on a Mac, Ctrl everywhere else.
  platform: process.platform,
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  app: {
    onCloseRequested: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:close-requested', listener)
      return () => ipcRenderer.off('app:close-requested', listener)
    },
    onMenuAction: (callback: (action: MenuAction) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, action: MenuAction): void =>
        callback(action)
      ipcRenderer.on('app:menu-action', listener)
      return () => ipcRenderer.off('app:menu-action', listener)
    },
    confirmClose: (): Promise<void> => ipcRenderer.invoke('app:confirm-close'),
    rendererCrash: (): Promise<{ reason: string; at: number } | null> =>
      ipcRenderer.invoke('app:renderer-crash'),
    onMainError: (callback: (message: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
      ipcRenderer.on('app:main-error', listener)
      return () => ipcRenderer.off('app:main-error', listener)
    },
    drainMainErrors: (): Promise<string[]> =>
      ipcRenderer.invoke('app:drainMainErrors')
  },
  playback: {
    /**
     * Says the window is alive. Main's watchdog silences the engine when these stop
     * arriving while anything is playing, so it is sent on a timer rather than only
     * while a cue runs.
     */
    heartbeat: (): void => {
      // Fire and forget: a heartbeat that fails is a missed heartbeat, and the watchdog
      // is the thing whose job it is to notice.
      void ipcRenderer.invoke('playback:heartbeat').catch(() => {})
    },
    /** A panic main decided on — the menu, the watchdog, or a show input binding. */
    onPanic: (callback: (panic: PlaybackPanic) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, panic: PlaybackPanic): void => callback(panic)
      ipcRenderer.on('playback:panic', listener)
      return () => ipcRenderer.off('playback:panic', listener)
    }
  },
  /**
   * The native engine's verbs. Media never crosses this bridge — paths do — and every
   * time is milliseconds on the engine's sample clock, not epoch. Checked against the
   * shared contract so the two processes cannot drift apart silently.
   */
  audio: {
    prepare: (cueId: string, filePath: string): Promise<AudioMetadata> =>
      invokeAudio(AUDIO_CHANNELS.prepare, { cueId, filePath } satisfies AudioPreparePayload),
    start: (cueId: string, whenMs: number, options: AudioStartOptions): Promise<AudioStartResult> =>
      invokeAudio(AUDIO_CHANNELS.start, { cueId, whenMs, options } satisfies AudioStartPayload),
    stop: (cueId: string, fadeMs: number, whenMs?: number): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.stop, { cueId, fadeMs, whenMs } satisfies AudioStopPayload),
    stopAll: (fadeMs: number): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.stopAll, { fadeMs } satisfies AudioStopAllPayload),
    seek: (cueId: string, positionMs: number, whenMs?: number): Promise<AudioSeekResult> =>
      invokeAudio(AUDIO_CHANNELS.seek, { cueId, positionMs, whenMs } satisfies AudioSeekPayload),
    cancel: (cueId: string, whenMs?: number): Promise<AudioCancelResult> =>
      invokeAudio(AUDIO_CHANNELS.cancel, { cueId, whenMs } satisfies AudioCancelPayload),
    /** Replace a running cue's matrix live: null is automatic, [] is silence, else a list. */
    routing: (cueId: string, outputs: AudioCrosspoint[] | null): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.routing, { cueId, outputs } satisfies AudioRoutingPayload),
    fade: (
      cueId: string,
      param: AudioFadeParam,
      value: number,
      durationMs: number,
      curve: AudioFadeCurve,
      whenMs?: number
    ): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.fade, { cueId, param, value, durationMs, curve, whenMs } satisfies AudioFadePayload),
    progress: (cueId: string): Promise<AudioProgress | null> =>
      invokeAudio(AUDIO_CHANNELS.progress, { cueId } satisfies AudioProgressPayload),
    panic: (fadeMs: number): Promise<AudioPanicResult> =>
      invokeAudio(AUDIO_CHANNELS.panic, { fadeMs } satisfies AudioPanicPayload),
    clock: (): Promise<AudioClockReading> =>
      invokeAudio(AUDIO_CHANNELS.clock),
    info: (): Promise<AudioEngineInfo> =>
      invokeAudio(AUDIO_CHANNELS.info),
    devices: (): Promise<AudioDeviceInfo[]> =>
      invokeAudio(AUDIO_CHANNELS.devices),
    configure: (options: DeviceOptions): Promise<AudioEngineInfo> =>
      invokeAudio(AUDIO_CHANNELS.configure, { options } satisfies AudioConfigurePayload),
    waveform: (filePath: string, points: number): Promise<AudioWaveform> =>
      invokeAudio(AUDIO_CHANNELS.waveform, { filePath, points } satisfies AudioWaveformPayload),
    /** Headers only: a workspace footprint asks about every cue without decoding one. */
    probe: (filePath: string): Promise<AudioProbe> =>
      invokeAudio(AUDIO_CHANNELS.probe, { filePath } satisfies AudioProbePayload),
    /** Engine events, batched by main. Returns the unsubscribe function. */
    onEvents: (callback: (events: AudioEngineEvent[]) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, events: AudioEngineEvent[]): void => callback(events)
      ipcRenderer.on(AUDIO_CHANNELS.events, listener)
      return () => ipcRenderer.off(AUDIO_CHANNELS.events, listener)
    },
    pickFile: (): Promise<string | null> =>
      ipcRenderer.invoke(AUDIO_CHANNELS.pickFile)
  } satisfies AudioEngineBridge,
  midi: {
    listPorts: (): Promise<string[]> =>
      ipcRenderer.invoke('midi:listPorts'),
    listInputPorts: (): Promise<string[]> =>
      ipcRenderer.invoke('midi:listInputPorts'),
    /** Whether MIDI can work at all in this build, and why not when it cannot. */
    status: (): Promise<MidiAvailability> =>
      ipcRenderer.invoke('midi:status'),
    send: (cmd: { portName: string; messages: any[] }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('midi:send', cmd)
  },
  network: {
    /**
     * An HTTP request made by the main process, so a network cue is not subject to the
     * page's origin and does not stop when the window is busy.
     */
    request: (request: NetworkRequest): Promise<NetworkResult> =>
      ipcRenderer.invoke('network:request', request),
    /** Abandons a request that is still in flight. False means it had already finished. */
    cancel: (requestId: string): Promise<boolean> =>
      ipcRenderer.invoke('network:cancel', requestId)
  },
  osc: {
    send: (cmd: { host: string; port: number; address: string; args: any[] }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('osc:send', cmd)
  },
  show: {
    snapshot: (): Promise<ShowSnapshot> =>
      ipcRenderer.invoke('show:snapshot'),
    configure: (settings: ShowSettings): Promise<void> =>
      ipcRenderer.invoke('show:configure', settings),
    command: (
      service: string,
      action: string,
      payload?: unknown
    ): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
      ipcRenderer.invoke('show:command', { service, action, payload }),
    restart: (service: string): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
      ipcRenderer.invoke('show:restart', service),
    onEvents: (callback: (events: ShowEvent[]) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, events: ShowEvent[]): void => callback(events)
      ipcRenderer.on('show:events', listener)
      return () => ipcRenderer.off('show:events', listener)
    }
  },
  license: {
    status: (): Promise<LicenseStatus> =>
      ipcRenderer.invoke('license:status'),
    activate: (text: string): Promise<ActivationResult> =>
      ipcRenderer.invoke('license:activate', text),
    deactivate: (): Promise<LicenseStatus> =>
      ipcRenderer.invoke('license:deactivate'),
    onChanged: (callback: (status: LicenseStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: LicenseStatus): void => callback(status)
      ipcRenderer.on('license:changed', listener)
      return () => ipcRenderer.off('license:changed', listener)
    }
  },
  script: {
    readFile: (
      relativePath: string,
      workspacePath: string | null,
      base?: string
    ): Promise<{ code: string; path: string }> =>
      ipcRenderer.invoke('script:readFile', relativePath, workspacePath, base),
    pickFile: (): Promise<string | null> =>
      ipcRenderer.invoke('script:pickFile'),
    readDocument: (filePath: string, workspacePath: string | null): Promise<ScriptDocument> =>
      ipcRenderer.invoke('script:readDocument', filePath, workspacePath),
    shell: (
      command: string,
      options?: { timeout?: number; cwd?: string; env?: Record<string, string> }
    ): Promise<{ stdout: string; stderr: string; code: number | null; signal: string | null }> =>
      ipcRenderer.invoke('script:shell', command, options ?? {})
  },
  workspace: {
    open: (): Promise<{ path: string; workspace: Workspace; missingMedia: MissingMedia[] } | null> =>
      ipcRenderer.invoke('workspace:open'),
    openPath: (filePath: string): Promise<{ path: string; workspace: Workspace; missingMedia: MissingMedia[] }> =>
      ipcRenderer.invoke('workspace:openPath', filePath),
    openDemo: (): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:openDemo'),
    /**
     * Points one cue's missing media at a file the operator picked. The dialog is shown
     * by the main process, so a cancel is a normal answer rather than a thrown error.
     */
    relink: (
      workspace: Workspace,
      workspacePath: string | null,
      cueId: string
    ): Promise<{ workspace: Workspace; missingMedia: MissingMedia[] }> =>
      ipcRenderer.invoke('workspace:relink', workspace, workspacePath, cueId),
    save: (workspace: Workspace, existingPath: string | null): Promise<string | null> =>
      ipcRenderer.invoke('workspace:save', workspace, existingPath),
    saveAs: (workspace: Workspace): Promise<string | null> =>
      ipcRenderer.invoke('workspace:saveAs', workspace),
    recent: (): Promise<string[]> =>
      ipcRenderer.invoke('workspace:recent'),
    autosave: (workspace: Workspace, sourcePath: string | null): Promise<void> =>
      ipcRenderer.invoke('workspace:autosave', workspace, sourcePath),
    recovery: (): Promise<{ workspace: Workspace; savedAt: number; sourcePath: string | null; missingMedia: MissingMedia[] } | null> =>
      ipcRenderer.invoke('workspace:recovery'),
    clearRecovery: (): Promise<void> =>
      ipcRenderer.invoke('workspace:clearRecovery'),
    setTitle: (title: string): Promise<void> =>
      ipcRenderer.invoke('workspace:setTitle', title),
    confirmClose: (workspaceName: string): Promise<0 | 1 | 2> =>
      ipcRenderer.invoke('workspace:confirmClose', workspaceName)
  }
})
