import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MenuAction } from '../shared/fileMenu'
import {
  AUDIO_CHANNELS,
  AUDIO_SILENCE_THRESHOLD_DB,
  type AudioCancelPayload,
  type AudioReleasePayload,
  type AudioHoldPayload,
  type AudioMasterPayload,
  type AudioMeters,
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
  type AudioRegion,
  type AudioSilencePayload,
  type AudioLoudness,
  type AudioLoudnessPayload,
  type AudioInputDevice,
  type AudioInputOpenOptions,
  type AudioInputOpenPayload,
  type AudioInputClosePayload,
  type AudioInputStatus,
  type AudioStartInputPayload,
  type AudioPatchPayload,
  type AudioOutputGainsPayload,
  type AudioSilence,
  type AudioOnsetsPayload,
  type AudioOnsets,
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
import { unwrapAudioResult, type AudioResult } from '../shared/audioResult'
import {
  APP_CHANNELS,
  type LogsOpenResult,
  type ReportEmailResult,
  type ReportInput,
  type ReportSaveResult,
  type RendererCrash
} from '../shared/ipc/app'
import { PLAYBACK_CHANNELS } from '../shared/ipc/playback'
import { LICENSE_CHANNELS } from '../shared/ipc/license'
import { MIDI_CHANNELS, type MidiSendPayload, type MidiSendResult, type MidiSendTcpPayload } from '../shared/ipc/midi'
import type {
  MidiFileCuePayload,
  MidiFileInspectPayload,
  MidiFileInspectResult,
  MidiFilePauseResult,
  MidiFilePlayPayload,
  MidiFilePlayResult,
  MidiFileResumeResult,
  MidiFileSeekPayload
} from '../shared/ipc/midi'
import { NETWORK_CHANNELS } from '../shared/ipc/network'
import {
  OSC_CHANNELS,
  type OscInterfaceState,
  type OscSendPayload,
  type OscSendResult,
  type OscSetInterfacePayload,
  type OscSetInterfaceResult
} from '../shared/ipc/osc'
import { REDUNDANCY_CHANNELS, type RedundancyConfigureResult } from '../shared/ipc/redundancy'
import {
  TIMECODE_CHANNELS,
  type TimecodeControlPayload,
  type TimecodeGenerateResult,
  type TimecodeInputs
} from '../shared/ipc/timecode'
import type { TimecodeGenerateRequest, TimecodeSettings, TimecodeShowSettings, TimecodeStatus } from '../shared/timecode'
import {
  SCRIPT_CHANNELS,
  type ScriptReadDocumentPayload,
  type ScriptReadFilePayload,
  type ScriptReadFileResult,
  type ScriptShellOptions,
  type ScriptShellPayload,
  type ScriptShellResult
} from '../shared/ipc/script'
import {
  SHOW_CHANNELS,
  type EwDxCredentialResult,
  type EwDxCredentialStatus,
  type EwDxDiscoverResult,
  type EwDxSetPasswordPayload,
  type ShowCommandPayload,
  type ShowCommandResult
} from '../shared/ipc/show'
import {
  WORKSPACE_CHANNELS,
  type RelinkedWorkspace,
  type WorkspaceCompareResult,
  type WorkspaceDemoResult,
  type WorkspaceExportPayload,
  type WorkspaceExportResult,
  type WorkspaceImportResult,
  type WorkspaceMergePayload,
  type WorkspaceMergeOptions,
  type WorkspaceMergeResult,
  type WorkspaceOpenPathResult,
  type WorkspaceOpenResult,
  type WorkspaceRecoveryResult,
  type WorkspaceRelinkPayload,
  type WorkspaceSavePayload,
  type WorkspaceSaveResult
} from '../shared/ipc/workspace'
import {
  QLAB_CHANNELS,
  type QLabFindMediaPayload,
  type QLabFindMediaResult,
  type QLabImportResult,
  type QLabLivePayload,
  type QLabWorkspacesResult
} from '../shared/ipc/qlab'
import {
  UPDATE_CHANNELS,
  type UpdateActionResult,
  type UpdateCheckResult,
  type WhatsNew
} from '../shared/ipc/update'
import type { UpdateSettings, UpdateShowState, UpdateStatus } from '../shared/update'
import {
  OUTPUT_CHANNELS,
  type LayerCommand,
  type OutputCommandResult,
  type OutputEvent,
  type OutputPlacePayload,
  type OutputPlaceResult,
  type OutputSnapshot,
  type CameraSnapshot,
  type ChooseCameraPayload,
  type OutputTestPatternPayload,
  type TimerFeed,
  type TimerWindowState
} from '../shared/ipc/output'
import type { OutputPlacement, VideoOutput } from '../shared/visual'
import type { CameraDevice } from '../shared/camera'
import type { CuerunnerBridge, EventChannel } from '../shared/ipc'
import type { Workspace } from '../shared/workspace'
import type { ShowEvent, ShowSettings, ShowSnapshot, ScriptDocument } from '../shared/show'
import type { ActivationResult, LicenseStatus } from '../shared/license'
import type { MidiAvailability } from '../shared/midi'
import type { NetworkRequest, NetworkResult } from '../shared/network'
import type { PlaybackPanic } from '../shared/playback'
import type { RedundancySettings } from '../shared/redundancy'

/**
 * One audio verb, unwrapped here in the window.
 *
 * The main process answers with the engine's own `{ ok, value } | { ok, code, message }`
 * rather than by rejecting, because Electron logs every rejected `ipcMain.handle` to
 * stderr with a stack and this path refuses by design. Turning a refusal back into a
 * rejection in this process — where a rejection is just a rejection, and nothing logs it —
 * keeps every caller catching what it caught before. What is rejected with is the refusal
 * itself, not an `Error` made from it: the context bridge carries an `Error`'s message and
 * drops its `code`, so the window's engine client is where it becomes an `AudioEngineError`
 * (`audioEngineError`, src/shared/audioResult.ts).
 */
const invokeAudio = async <T>(channel: string, payload?: unknown): Promise<T> =>
  unwrapAudioResult((await ipcRenderer.invoke(channel, payload)) as AudioResult<T>)

/**
 * One verb on a channel that answers plainly. What comes back is asserted to the bridge's
 * declared return type (see src/shared/ipc), not checked — `ipcRenderer.invoke` returns
 * whatever main sent — so the payload is where a call site can be checked instead: one
 * that builds it from the bridge's arguments writes it `satisfies <Payload>`.
 */
const invoke = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>

/** A push channel's listener, and the unsubscribe that takes it off again. */
const subscribe = <T>(channel: EventChannel, callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

contextBridge.exposeInMainWorld('cuerunner', {
  // Which keyboard the labels should be written for: ⌘ on a Mac, Ctrl everywhere else.
  platform: process.platform,
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  app: {
    onCloseRequested: (callback: () => void): (() => void) =>
      subscribe(APP_CHANNELS.closeRequested, callback),
    onMenuAction: (callback: (action: MenuAction) => void): (() => void) =>
      subscribe(APP_CHANNELS.menuAction, callback),
    confirmClose: (): Promise<void> =>
      invoke(APP_CHANNELS.confirmClose),
    rendererCrash: (): Promise<RendererCrash | null> =>
      invoke(APP_CHANNELS.rendererCrash),
    onMainError: (callback: (message: string) => void): (() => void) =>
      subscribe(APP_CHANNELS.mainError, callback),
    drainMainErrors: (): Promise<string[]> =>
      invoke(APP_CHANNELS.drainMainErrors),
    composeReport: (input: ReportInput): Promise<string> =>
      invoke(APP_CHANNELS.composeReport, input),
    saveReport: (text: string): Promise<ReportSaveResult> =>
      invoke(APP_CHANNELS.saveReport, text),
    emailReport: (text: string): Promise<ReportEmailResult> =>
      invoke(APP_CHANNELS.emailReport, text),
    writeLog: (lines: string[]): Promise<void> =>
      invoke(APP_CHANNELS.writeLog, lines),
    openLogs: (): Promise<LogsOpenResult> =>
      invoke(APP_CHANNELS.openLogs)
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
      void ipcRenderer.invoke(PLAYBACK_CHANNELS.heartbeat).catch(() => {})
    },
    /** A panic main decided on — the menu, the watchdog, or a show input binding. */
    onPanic: (callback: (panic: PlaybackPanic) => void): (() => void) =>
      subscribe(PLAYBACK_CHANNELS.panic, callback)
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
    release: (cueId: string, whenMs?: number, endMs?: number, stopAtSliceEnd?: boolean): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.release, { cueId, whenMs, endMs, stopAtSliceEnd } satisfies AudioReleasePayload),
    cancel: (cueId: string, whenMs?: number): Promise<AudioCancelResult> =>
      invokeAudio(AUDIO_CHANNELS.cancel, { cueId, whenMs } satisfies AudioCancelPayload),
    pause: (cueId: string, whenMs?: number): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.pause, { cueId, whenMs } satisfies AudioHoldPayload),
    resume: (cueId: string, whenMs?: number): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.resume, { cueId, whenMs } satisfies AudioHoldPayload),
    master: (gain: number): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.master, { gain } satisfies AudioMasterPayload),
    meters: (): Promise<AudioMeters> =>
      invokeAudio(AUDIO_CHANNELS.meters),
    /** Replace a running cue's matrix live: null is automatic, [] is silence, else a list. */
    routing: (cueId: string, outputs: AudioCrosspoint[] | null): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.routing, { cueId, outputs } satisfies AudioRoutingPayload),
    fade: (
      cueId: string,
      param: AudioFadeParam,
      value: number,
      durationMs: number,
      curve: AudioFadeCurve,
      whenMs?: number,
      shape?: number[] | null
    ): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.fade, {
        cueId, param, value, durationMs, curve, whenMs, shape
      } satisfies AudioFadePayload),
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
    waveform: (filePath: string, points: number, region?: AudioRegion): Promise<AudioWaveform> =>
      invokeAudio(AUDIO_CHANNELS.waveform, {
        filePath, points, startMs: region?.startMs, endMs: region?.endMs
      } satisfies AudioWaveformPayload),
    onsets: (
      filePath: string, sensitivity?: number, maxOnsets?: number, region?: AudioRegion
    ): Promise<AudioOnsets> =>
      invokeAudio(AUDIO_CHANNELS.onsets, {
        filePath, sensitivity, maxOnsets, startMs: region?.startMs, endMs: region?.endMs
      } satisfies AudioOnsetsPayload),
    silence: (filePath: string, thresholdDb: number = AUDIO_SILENCE_THRESHOLD_DB): Promise<AudioSilence> =>
      invokeAudio(AUDIO_CHANNELS.silence, { filePath, thresholdDb } satisfies AudioSilencePayload),
    /** Headers only: a workspace footprint asks about every cue without decoding one. */
    probe: (filePath: string): Promise<AudioProbe> =>
      invokeAudio(AUDIO_CHANNELS.probe, { filePath } satisfies AudioProbePayload),
    loudness: (filePath: string): Promise<AudioLoudness> =>
      invokeAudio(AUDIO_CHANNELS.loudness, { filePath } satisfies AudioLoudnessPayload),
    inputs: (): Promise<AudioInputDevice[]> =>
      invokeAudio(AUDIO_CHANNELS.inputs),
    inputOpen: (options: AudioInputOpenOptions): Promise<AudioInputStatus> =>
      invokeAudio(AUDIO_CHANNELS.inputOpen, options satisfies AudioInputOpenPayload),
    inputClose: (device: string): Promise<{ closed: boolean }> =>
      invokeAudio(AUDIO_CHANNELS.inputClose, { device } satisfies AudioInputClosePayload),
    inputStatus: (): Promise<AudioInputStatus[]> =>
      invokeAudio(AUDIO_CHANNELS.inputStatus),
    startInput: (
      cueId: string, whenMs: number, device: string, channels: number[], options: Partial<AudioStartOptions>
    ): Promise<AudioStartResult> =>
      invokeAudio(AUDIO_CHANNELS.startInput, {
        cueId, whenMs, device, channels, options
      } satisfies AudioStartInputPayload),
    patch: (slot: number, outputs: number[] | null, gain: number): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.patch, { slot, outputs, gain } satisfies AudioPatchPayload),
    outputGains: (gains: number[]): Promise<AudioCommandResult> =>
      invokeAudio(AUDIO_CHANNELS.outputGains, { gains } satisfies AudioOutputGainsPayload),
    /** Engine events, batched by main. Returns the unsubscribe function. */
    onEvents: (callback: (events: AudioEngineEvent[]) => void): (() => void) =>
      subscribe(AUDIO_CHANNELS.events, callback),
    pickFile: (): Promise<string | null> =>
      invoke<string | null>(AUDIO_CHANNELS.pickFile)
  } satisfies AudioEngineBridge,
  midi: {
    listPorts: (): Promise<string[]> =>
      invoke(MIDI_CHANNELS.listPorts),
    listInputPorts: (): Promise<string[]> =>
      invoke(MIDI_CHANNELS.listInputPorts),
    /** Whether MIDI can work at all in this build, and why not when it cannot. */
    status: (): Promise<MidiAvailability> =>
      invoke(MIDI_CHANNELS.status),
    send: (cmd: MidiSendPayload): Promise<MidiSendResult> =>
      invoke(MIDI_CHANNELS.send, cmd),
    /** MIDI to a desk on the network, which is where an SQ and an Avantis listen. */
    sendTcp: (cmd: MidiSendTcpPayload): Promise<MidiSendResult> =>
      invoke(MIDI_CHANNELS.sendTcp, cmd),
    pickFile: (): Promise<string | null> =>
      invoke(MIDI_CHANNELS.pickFile),
    fileInspect: (cmd: MidiFileInspectPayload): Promise<MidiFileInspectResult> =>
      invoke(MIDI_CHANNELS.fileInspect, cmd),
    filePlay: (cmd: MidiFilePlayPayload): Promise<MidiFilePlayResult> =>
      invoke(MIDI_CHANNELS.filePlay, cmd),
    filePause: (cmd: MidiFileCuePayload): Promise<MidiFilePauseResult> =>
      invoke(MIDI_CHANNELS.filePause, cmd),
    fileResume: (cmd: MidiFileCuePayload): Promise<MidiFileResumeResult> =>
      invoke(MIDI_CHANNELS.fileResume, cmd),
    fileSeek: (cmd: MidiFileSeekPayload): Promise<MidiFileResumeResult> =>
      invoke(MIDI_CHANNELS.fileSeek, cmd),
    fileStop: (cmd: MidiFileCuePayload): Promise<boolean> =>
      invoke(MIDI_CHANNELS.fileStop, cmd)
  },
  network: {
    /**
     * An HTTP request made by the main process, so a network cue is not subject to the
     * page's origin and does not stop when the window is busy.
     */
    request: (request: NetworkRequest): Promise<NetworkResult> =>
      invoke(NETWORK_CHANNELS.request, request),
    /** Abandons a request that is still in flight. False means it had already finished. */
    cancel: (requestId: string): Promise<boolean> =>
      invoke(NETWORK_CHANNELS.cancel, requestId)
  },
  osc: {
    send: (cmd: OscSendPayload): Promise<OscSendResult> =>
      invoke(OSC_CHANNELS.send, cmd),
    interfaces: (): Promise<OscInterfaceState> =>
      invoke(OSC_CHANNELS.interfaces),
    setInterface: (payload: OscSetInterfacePayload): Promise<OscSetInterfaceResult> =>
      invoke(OSC_CHANNELS.setInterface, payload)
  },
  show: {
    snapshot: (): Promise<ShowSnapshot> =>
      invoke(SHOW_CHANNELS.snapshot),
    configure: (settings: ShowSettings): Promise<void> =>
      invoke(SHOW_CHANNELS.configure, settings),
    command: (service: string, action: string, payload?: unknown): Promise<ShowCommandResult> =>
      invoke(SHOW_CHANNELS.command, { service, action, payload } satisfies ShowCommandPayload),
    restart: (service: string): Promise<ShowCommandResult> =>
      invoke(SHOW_CHANNELS.restart, service),
    ewDxCredentials: (sourceId: string): Promise<EwDxCredentialStatus> =>
      invoke(SHOW_CHANNELS.ewDxCredentials, sourceId),
    ewDxSetPassword: (sourceId: string, password: string): Promise<EwDxCredentialResult> =>
      invoke(SHOW_CHANNELS.ewDxSetPassword, { sourceId, password } satisfies EwDxSetPasswordPayload),
    ewDxTrustAgain: (sourceId: string): Promise<EwDxCredentialResult> =>
      invoke(SHOW_CHANNELS.ewDxTrustAgain, sourceId),
    ewDxForget: (sourceId: string): Promise<EwDxCredentialStatus> =>
      invoke(SHOW_CHANNELS.ewDxForget, sourceId),
    ewDxDiscover: (): Promise<EwDxDiscoverResult> =>
      invoke(SHOW_CHANNELS.ewDxDiscover),
    onEvents: (callback: (events: ShowEvent[]) => void): (() => void) =>
      subscribe(SHOW_CHANNELS.events, callback)
  },
  redundancy: {
    /** This machine's half of a pair. Reading is free; changing it is a Pro feature. */
    settings: (): Promise<RedundancySettings> =>
      invoke(REDUNDANCY_CHANNELS.settings),
    configure: (patch: Partial<RedundancySettings>): Promise<RedundancyConfigureResult> =>
      invoke(REDUNDANCY_CHANNELS.configure, patch)
  },
  license: {
    status: (): Promise<LicenseStatus> =>
      invoke(LICENSE_CHANNELS.status),
    activate: (text: string): Promise<ActivationResult> =>
      invoke(LICENSE_CHANNELS.activate, text),
    deactivate: (): Promise<LicenseStatus> =>
      invoke(LICENSE_CHANNELS.deactivate),
    onChanged: (callback: (status: LicenseStatus) => void): (() => void) =>
      subscribe(LICENSE_CHANNELS.changed, callback)
  },
  script: {
    readFile: (
      relativePath: string,
      workspacePath: string | null,
      base?: string
    ): Promise<ScriptReadFileResult> =>
      invoke(SCRIPT_CHANNELS.readFile, { relativePath, workspacePath, base } satisfies ScriptReadFilePayload),
    pickFile: (): Promise<string | null> =>
      invoke(SCRIPT_CHANNELS.pickFile),
    readDocument: (filePath: string, workspacePath: string | null): Promise<ScriptDocument> =>
      invoke(SCRIPT_CHANNELS.readDocument, { filePath, workspacePath } satisfies ScriptReadDocumentPayload),
    shell: (command: string, options?: ScriptShellOptions): Promise<ScriptShellResult> =>
      invoke(SCRIPT_CHANNELS.shell, { command, options } satisfies ScriptShellPayload)
  },
  workspace: {
    open: (): Promise<WorkspaceOpenResult> =>
      invoke(WORKSPACE_CHANNELS.open),
    openPath: (filePath: string): Promise<WorkspaceOpenPathResult> =>
      invoke(WORKSPACE_CHANNELS.openPath, filePath),
    openDemo: (): Promise<WorkspaceDemoResult> =>
      invoke(WORKSPACE_CHANNELS.openDemo),
    /**
     * Points one cue's missing media at a file the operator picked. The dialog is shown
     * by the main process, so a cancel is a normal answer rather than a thrown error.
     */
    relink: (
      workspace: Workspace,
      workspacePath: string | null,
      cueId: string
    ): Promise<RelinkedWorkspace> =>
      invoke(WORKSPACE_CHANNELS.relink, { workspace, workspacePath, cueId } satisfies WorkspaceRelinkPayload),
    /**
     * A save writes the file and answers with the path and the history it wrote into it, a
     * `null` inside the `ok` arm when the operator cancelled the dialog, or the refusal of
     * a show this build will not read back — the file it would have replaced untouched.
     */
    save: (
      workspace: Workspace,
      existingPath: string | null
    ): Promise<WorkspaceSaveResult> =>
      invoke(WORKSPACE_CHANNELS.save, { workspace, existingPath } satisfies WorkspaceSavePayload),
    saveAs: (workspace: Workspace): Promise<WorkspaceSaveResult> =>
      invoke(WORKSPACE_CHANNELS.saveAs, workspace),
    /**
     * A show and its media as one file, and back again. Both dialogs belong to the OS and
     * are shown by the main process, so a cancel comes back as `null`.
     */
    exportBundle: (
      workspace: Workspace,
      workspacePath: string | null
    ): Promise<WorkspaceExportResult> =>
      invoke(WORKSPACE_CHANNELS.exportBundle, { workspace, workspacePath } satisfies WorkspaceExportPayload),
    importBundle: (): Promise<WorkspaceImportResult> =>
      invoke(WORKSPACE_CHANNELS.importBundle),
    /**
     * Two files merged into a third, written where the operator says. `again` runs the
     * same merge over the files it read last time, with the other side's choices.
     */
    merge: (
      workspace: Workspace,
      workspacePath: string | null,
      options?: WorkspaceMergeOptions
    ): Promise<WorkspaceMergeResult> =>
      invoke(WORKSPACE_CHANNELS.merge, { workspace, workspacePath, options } satisfies WorkspaceMergePayload),
    /**
     * How this show differs from a file the operator picks. The dialog belongs to the
     * OS and is shown by the main process, so a cancel is `comparison: null` rather
     * than an error.
     */
    compare: (workspace: Workspace): Promise<WorkspaceCompareResult> =>
      invoke(WORKSPACE_CHANNELS.compare, workspace),
    recent: (): Promise<string[]> =>
      invoke(WORKSPACE_CHANNELS.recent),
    autosave: (workspace: Workspace, sourcePath: string | null, selectedCueId: string | null): Promise<void> =>
      invoke(WORKSPACE_CHANNELS.autosave, { workspace, sourcePath, selectedCueId }),
    recovery: (): Promise<WorkspaceRecoveryResult> =>
      invoke(WORKSPACE_CHANNELS.recovery),
    clearRecovery: (): Promise<void> =>
      invoke(WORKSPACE_CHANNELS.clearRecovery),
    setTitle: (title: string): Promise<void> =>
      invoke(WORKSPACE_CHANNELS.setTitle, title),
    confirmClose: (workspaceName: string): Promise<0 | 1 | 2> =>
      invoke(WORKSPACE_CHANNELS.confirmClose, workspaceName)
  },
  /** SMPTE timecode: the clock this machine follows, and the clocks its cues run. */
  timecode: {
    settings: (): Promise<TimecodeSettings> =>
      invoke(TIMECODE_CHANNELS.settings),
    configure: (patch: Partial<TimecodeSettings>): Promise<TimecodeSettings> =>
      invoke(TIMECODE_CHANNELS.configure, patch),
    show: (settings: TimecodeShowSettings): Promise<TimecodeShowSettings> =>
      invoke(TIMECODE_CHANNELS.show, settings),
    status: (): Promise<TimecodeStatus> =>
      invoke(TIMECODE_CHANNELS.status),
    inputs: (): Promise<TimecodeInputs> =>
      invoke(TIMECODE_CHANNELS.inputs),
    generate: (request: TimecodeGenerateRequest): Promise<TimecodeGenerateResult> =>
      invoke(TIMECODE_CHANNELS.generate, request),
    control: (payload: TimecodeControlPayload): Promise<boolean> =>
      invoke(TIMECODE_CHANNELS.control, payload),
    onEvents: (callback: (status: TimecodeStatus) => void): (() => void) =>
      subscribe(TIMECODE_CHANNELS.events, callback)
  },
  /**
   * A QLab show brought across: from its workspace file, through a dialog main shows, or
   * from a QLab that is running, over the socket main opens. A cancel is a `null` inside
   * the `ok` arm; a file or a QLab the import cannot read is the refusal arm.
   */
  qlab: {
    importFile: (): Promise<QLabImportResult> =>
      invoke(QLAB_CHANNELS.importFile),
    listWorkspaces: (host: string, port: number): Promise<QLabWorkspacesResult> =>
      invoke(QLAB_CHANNELS.listWorkspaces, { host, port }),
    importLive: (payload: QLabLivePayload): Promise<QLabImportResult> =>
      invoke(QLAB_CHANNELS.importLive, payload),
    findMedia: (workspace: Workspace, workspacePath: string | null): Promise<QLabFindMediaResult> =>
      invoke(QLAB_CHANNELS.findMedia, { workspace, workspacePath } satisfies QLabFindMediaPayload)
  },
  /**
   * Updates: each step the operator's, and each refused while the show runs. The show's state
   * is reported as it changes, fire and forget — a report that fails is one main does without,
   * and it treats a show it has not heard about as the window last described it.
   */
  update: {
    status: (): Promise<UpdateStatus> =>
      invoke(UPDATE_CHANNELS.status),
    check: (): Promise<UpdateCheckResult> =>
      invoke(UPDATE_CHANNELS.check),
    download: (): Promise<UpdateActionResult> =>
      invoke(UPDATE_CHANNELS.download),
    install: (): Promise<UpdateActionResult> =>
      invoke(UPDATE_CHANNELS.install),
    configure: (patch: Partial<UpdateSettings>): Promise<UpdateStatus> =>
      invoke(UPDATE_CHANNELS.configure, patch),
    report: (state: UpdateShowState): void => {
      void ipcRenderer.invoke(UPDATE_CHANNELS.report, state).catch(() => {})
    },
    whatsNew: (): Promise<WhatsNew | null> =>
      invoke(UPDATE_CHANNELS.whatsNew),
    openDownloads: (): Promise<void> =>
      invoke(UPDATE_CHANNELS.openDownloads),
    onEvents: (callback: (status: UpdateStatus) => void): (() => void) =>
      subscribe(UPDATE_CHANNELS.events, callback)
  },
  /**
   * The video outputs: windows main keeps for the show's pictures. Every time a command
   * carries is engine milliseconds, the clock the sound of a video is scheduled on.
   */
  output: {
    configure: (outputs: VideoOutput[]): Promise<void> =>
      invoke(OUTPUT_CHANNELS.configure, outputs),
    snapshot: (): Promise<OutputSnapshot> =>
      invoke(OUTPUT_CHANNELS.snapshot),
    place: (outputId: string, placement: OutputPlacement): Promise<OutputPlaceResult> =>
      invoke(OUTPUT_CHANNELS.place, { outputId, placement } satisfies OutputPlacePayload),
    layer: (command: LayerCommand): Promise<OutputCommandResult> =>
      invoke(OUTPUT_CHANNELS.layer, command),
    identify: (): Promise<void> =>
      invoke(OUTPUT_CHANNELS.identify),
    testPattern: (outputId: string, on: boolean): Promise<OutputCommandResult> =>
      invoke(OUTPUT_CHANNELS.testPattern, { outputId, on } satisfies OutputTestPatternPayload),
    preview: (outputId: string): Promise<string | null> =>
      invoke(OUTPUT_CHANNELS.preview, outputId),
    timer: (feed: TimerFeed): Promise<void> =>
      invoke(OUTPUT_CHANNELS.timer, feed),
    timerWindow: (state: TimerWindowState): Promise<TimerWindowState> =>
      invoke(OUTPUT_CHANNELS.timerWindow, state),
    pickFile: (kind: 'video' | 'image'): Promise<string | null> =>
      invoke(OUTPUT_CHANNELS.pickFile, kind),
    onEvents: (callback: (events: OutputEvent[]) => void): (() => void) =>
      subscribe(OUTPUT_CHANNELS.events, callback),
    cameras: (): Promise<CameraSnapshot> =>
      invoke(OUTPUT_CHANNELS.cameras),
    chooseCamera: (cueId: string, device: CameraDevice | null): Promise<CameraSnapshot> =>
      invoke(OUTPUT_CHANNELS.chooseCamera, { cueId, device } satisfies ChooseCameraPayload),
    pickMask: (): Promise<string | null> =>
      invoke(OUTPUT_CHANNELS.pickMask)
  }
} satisfies CuerunnerBridge)
