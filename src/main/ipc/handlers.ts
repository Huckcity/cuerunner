import { app, ipcMain, dialog, BrowserWindow, net, safeStorage } from 'electron'
import { readFile } from 'fs/promises'
import { exec } from 'child_process'
import * as path from 'path'
import { MidiEngine } from '../midi/MidiEngine'
import type { MidiModuleLoader } from '../midi/MidiEngine'
import { midiTcp } from '../midi/MidiTcpEngine'
import { midiFiles } from '../midi/midiFileRuntime'
import { installMidiLoopback } from '../midi/loopback'
import { MIDI_FILE_EXTENSIONS } from '../../shared/midiFile'
import { KeychainRefusedError, createEwDxCredentials } from '../ewdx/credentials'
import { discoverEwDx } from '../ewdx/discovery'
import { BatteryLog } from '../services/BatteryLog'
import { NetworkClient } from '../network/NetworkClient'
import type { NetworkRequest } from '../../shared/network'
import { audioEngine } from '../audio/AudioEngine'
import {
  AudioRegion,
  AUDIO_CHANNELS,
  type AudioCancelPayload,
  type AudioReleasePayload,
  type AudioHoldPayload,
  type AudioMasterPayload,
  type AudioOnsetsPayload,
  type AudioSilencePayload,
  type AudioConfigurePayload,
  type AudioEngineEvent,
  type AudioFadePayload,
  type AudioPanicPayload,
  type AudioPreparePayload,
  type AudioProbePayload,
  type AudioProgressPayload,
  type AudioRoutingPayload,
  type AudioSeekPayload,
  type AudioStartPayload,
  type AudioStopAllPayload,
  type AudioStopPayload,
  type AudioWaveformPayload
} from '../../shared/audio'
import { refusalFrom, type AudioResult } from '../../shared/audioResult'
import { APP_CHANNELS } from '../../shared/ipc/app'
import { LICENSE_CHANNELS } from '../../shared/ipc/license'
import {
  MIDI_CHANNELS,
  type MidiSendPayload,
  type MidiSendResult,
  type MidiSendTcpPayload,
  type MidiFileCuePayload,
  type MidiFileInspectPayload,
  type MidiFileInspectResult,
  type MidiFilePauseResult,
  type MidiFilePlayPayload,
  type MidiFilePlayResult,
  type MidiFileResumeResult
} from '../../shared/ipc/midi'
import { NETWORK_CHANNELS } from '../../shared/ipc/network'
import {
  OSC_CHANNELS,
  type OscInterfaceState,
  type OscSendPayload,
  type OscSendResult,
  type OscSetInterfacePayload,
  type OscSetInterfaceResult
} from '../../shared/ipc/osc'
import { PLAYBACK_CHANNELS } from '../../shared/ipc/playback'
import { REDUNDANCY_CHANNELS, type RedundancyConfigureResult } from '../../shared/ipc/redundancy'
import {
  TIMECODE_CHANNELS,
  type TimecodeControlPayload,
  type TimecodeGenerateResult,
  type TimecodeInputs
} from '../../shared/ipc/timecode'
import type { TimecodeGenerateRequest, TimecodeSettings, TimecodeShowSettings } from '../../shared/timecode'
import { createTimecodeHub } from '../timecode/main'
import {
  SCRIPT_CHANNELS,
  type ScriptReadDocumentPayload,
  type ScriptReadFilePayload,
  type ScriptReadFileResult,
  type ScriptShellPayload,
  type ScriptShellResult
} from '../../shared/ipc/script'
import {
  SHOW_CHANNELS,
  type EwDxCredentialResult,
  type EwDxCredentialStatus,
  type EwDxDiscoverResult,
  type EwDxSetPasswordPayload,
  type ShowCommandPayload,
  type ShowCommandResult
} from '../../shared/ipc/show'
import {
  WORKSPACE_CHANNELS,
  type MergeInputs,
  type RelinkedWorkspace,
  type WorkspaceAutosavePayload,
  type WorkspaceCompareResult,
  type WorkspaceDemoResult,
  type WorkspaceExportPayload,
  type WorkspaceExportResult,
  type WorkspaceImportResult,
  type WorkspaceMergePayload,
  type WorkspaceMergeResult,
  type WorkspaceOpenPathResult,
  type WorkspaceOpenResult,
  type WorkspaceRecoveryResult,
  type WorkspaceRelinkPayload,
  type WorkspaceSavePayload,
  type WorkspaceSaveResult
} from '../../shared/ipc/workspace'
import type { EventChannel } from '../../shared/ipc'
import { Refusal, asRefusal, refusalValue } from './refusal'
import { compose as composeProblemReport, saveReport, emailReport } from '../report/session'
import type { ReportInput } from '../../shared/ipc/app'
import { liveWindow, sendToWindow } from './broadcast'
import { playbackSafety, noteEngineEvents } from '../safety/runtime'
import { deviceFaultAlert } from '../safety/engineFaults'
import { panicFromShowEvent } from '../safety/panicBindings'
import { remotePanicFromEvent } from '../safety/remotePanic'
import { openLogsFolder, sessionLogFile } from '../log/logsFolder'
import { isLogBatch } from '../log/sessionLogFile'
import { OscEngine } from '../osc/OscEngine'
import {
  openWorkspace,
  openWorkspaceFromPath,
  openRecovery,
  saveWorkspace,
  saveWorkspaceAs,
  compareWorkspace,
  mergeShow,
  relinkWorkspaceMedia,
  getRecentFiles,
  knownFingerprint
} from '../workspace/WorkspaceManager'
import { clearRecovery, writeRecovery } from '../workspace/recovery'
import { exportBundle, importBundle } from '../workspace/bundle'
import { openDemoWorkspace } from '../workspace/demo'
import {
  QLAB_CHANNELS,
  type QLabFindMediaPayload,
  type QLabFindMediaResult,
  type QLabImportResult,
  type QLabLivePayload,
  type QLabWorkspacesResult
} from '../../shared/ipc/qlab'
import { findMediaInFolder, importQLabFile, importQLabLive, listLiveWorkspaces } from '../import/qlabImport'
import { createShowRuntime, defaultServices } from '../show/runtime'
import { UPDATE_CHANNELS, type UpdateActionResult, type UpdateCheckResult, type WhatsNew } from '../../shared/ipc/update'
import type { UpdateSettings, UpdateShowState, UpdateStatus } from '../../shared/update'
import { openDownloads, updates } from '../update/main'
import { createMachineRedundancy } from '../redundancy/machine'
import { createMachineDmx } from '../dmx/machine'
import type { RedundancySettings } from '../../shared/redundancy'
import { drainMainErrors, onMainError } from '../errors'
import { loadScriptDocument } from '../script/document'
import { shellWorkingDirectory } from '../script/shellCwd'
import { createLicenseManager } from '../license/LicenseManager'
import { trustedPublicKeys } from '../license/trustedKeys'
import { defaultShowSettings } from '../../shared/show'
import { isPro } from '../../shared/license'
import type { ScriptDocument, ShowEvent, ShowSettings } from '../../shared/show'
import type { LicenseStatus } from '../../shared/license'
import type { Workspace } from '../../shared/workspace'
import { AUDIO_FILE_EXTENSIONS } from '../../shared/media'
import { registerOutputHandlers } from '../output/ipc'
import { createMachineOsc } from '../osc/machine'
import { createOscInterfaces } from '../osc/interfaces'

const midi = new MidiEngine(midiModuleLoader())
// A MIDI File cue's players send through the same engine, so a port it names is the port
// every other MIDI cue would reach by that name.
midiFiles.useOutput((portName, messages) => midi.sendRaw(portName, messages))
// Which interface this machine's OSC listens and sends on: the machine's, beside the
// licence, so a show carried to another desk uses that desk's network (`osc.json`).
const oscInterfaces = createOscInterfaces({
  machine: createMachineOsc({ filePath: path.join(app.getPath('userData'), 'osc.json') }),
  restartInput: async () => {
    if (settingsReceived) await show.restart('osc-in')
  },
  rebindOutput: () => osc.rebind()
})
const osc = new OscEngine(undefined, () => oscInterfaces.outputAddress())

// This machine's half of a redundant pair, read once at startup and written only when
// the operator changes it. It lives beside `license.key` rather than in the workspace:
// both machines of a pair run the same workspace file, so which one is the main and
// where the other one is are facts about the machines.
const machineRedundancy = createMachineRedundancy({
  filePath: path.join(app.getPath('userData'), 'redundancy.json')
})

// The receivers' passwords and the certificates they were first seen with. Beside the
// licence for the same reason as the pair's settings, and for a plainer one too: the
// showfile is emailed and copied between machines, and a password has no business in it.
// `safeStorage` is the OS's own keychain, so a copied file is not a copied password.
const ewDxCredentials = createEwDxCredentials({
  filePath: path.join(app.getPath('userData'), 'ew-dx.json'),
  cipher: {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: text => safeStorage.encryptString(text).toString('base64'),
    decrypt: text => safeStorage.decryptString(Buffer.from(text, 'base64'))
  }
})

// Looking for receivers on the network: for the settings window, and for a source whose receiver
// has left its address and is looked for by its serial. A harness has no multicast to rely on, so
// it may name the announcements itself; the receivers it names are still identified over HTTPS
// and only the mDNS step is skipped.
function discoverReceivers(): Promise<EwDxDiscoverResult> {
  const raw = !app.isPackaged ? process.env['CUERUNNER_TEST_EWDX_ANNOUNCED'] : undefined
  if (raw === undefined) return discoverEwDx()
  const announced = (JSON.parse(raw) as string[]).map(entry => {
    const [address, port] = entry.split(':')
    return { address, port: Number(port), name: `announced-${address}` }
  })
  return discoverEwDx({ announced })
}

// What each pack used in the shows before this one. A fact about a pack in a case and not about a
// show — a show is copied between machines and a pack is not — so it is kept here, beside the licence.
const batteryLog = new BatteryLog({ filePath: path.join(app.getPath('userData'), 'rf-battery.json') })

// SMPTE timecode: the clock this machine follows and the clocks its cues run. Its settings
// are the machine's, kept beside the licence like the pair's: which port the clock arrives
// on is a fact about this rack. The receiver is a show service, restarted on its own when
// those settings change.
const timecodeHub = createTimecodeHub({
  filePath: path.join(app.getPath('userData'), 'timecode.json'),
  sendMidi: (port, messages) => midi.sendRaw(port, messages),
  listMidiInputs: () => midi.listInputPorts(),
  ltc: (verb, params) => audioEngine.ltc(verb, params),
  broadcast: status => broadcastToWindows(TIMECODE_CHANNELS.events, status),
  restartReceiver: async () => {
    if (settingsReceived) await show.restart('timecode')
    else await show.configure(lastShowSettings)
  }
})

const show = createShowRuntime(
  defaultServices({
    timecode: () => timecodeHub,
    redundancy: () => machineRedundancy.current(),
    ewDx: ewDxCredentials,
    discoverReceivers,
    batteryLog,
    // Which interface the lights go out of and who this machine is on the wire: the
    // machine's, beside the licence, so a show carried to another desk goes out of that
    // desk's own network.
    dmx: { machine: createMachineDmx({ filePath: path.join(app.getPath('userData'), 'dmx.json') }) },
    osc: { binding: () => oscInterfaces.input(), appVersion: () => app.getVersion() }
  }),
  () => isPro(license.status())
)

// Network cues are HTTP clients, not page fetches: a console on the LAN has no reason to
// send CORS headers, and the request has to survive the window being busy or reloaded.
// Chromium's own stack is used so the operating system's proxy and certificate settings
// apply exactly as they do everywhere else in the app.
const network = new NetworkClient({ fetch: (url, init) => net.fetch(url, init) })

/**
 * The dev-only harness that proves the missing-module path: the E2E suite launches with
 * the native module withheld, and the badge has to say so. A packaged build never takes
 * this branch, so nothing here can make a real installation look broken.
 */
function midiModuleLoader(): MidiModuleLoader | undefined {
  // The other harness: one output port, by the name the launch gives it, that writes down
  // every message it is sent — so a spec can read what a MIDI File cue put on the wire on a
  // machine with no MIDI at all (src/main/midi/loopback.ts).
  const loopback = !app.isPackaged ? process.env['CUERUNNER_TEST_MIDI_LOOPBACK'] : undefined
  if (loopback !== undefined && loopback !== '') return installMidiLoopback(loopback)
  if (!app.isPackaged && process.env['CUERUNNER_TEST_MIDI_MISSING'] === '1') {
    return () => {
      throw new Error("Cannot find module 'midi'")
    }
  }
  return undefined
}

/**
 * The dev-only harness that reaches a key's own boundary: the E2E suite launches with an
 * offset from the system clock, so a key ending tonight ends seconds after launch instead
 * of at whatever hour the run happens to start. An offset rather than an instant, because
 * the manager waits for that boundary with a real timer — a frozen clock would arm a wait
 * that nothing could ever cross. A packaged build never takes this branch, and an offset
 * that is not a number is no offset at all.
 */
function testClockOffset(): number {
  if (app.isPackaged) return 0
  const raw = process.env['CUERUNNER_TEST_CLOCK_OFFSET_MS']
  if (raw === undefined) return 0
  const offset = Number(raw)
  return Number.isFinite(offset) ? offset : 0
}

// The license this machine holds, read from disk once at startup and written only when
// the operator enters or removes a key, with the clock consulted whenever anything asks
// what it is worth. Everything Pro is gated on it from here, in the process that owns the
// sockets: a window can explain a lock, but only this can be one.
const clockOffset = testClockOffset()
const license = createLicenseManager({
  filePath: path.join(app.getPath('userData'), 'license.key'),
  publicKeys: trustedPublicKeys(app.isPackaged, process.env),
  // `0` is the shipped answer: nothing but the dev-gated harness above moves the clock.
  ...(clockOffset === 0 ? {} : { now: () => Date.now() + clockOffset })
})

// The last settings the window sent. Kept so a key entered mid-session can start the
// services the operator had configured, without waiting for the window to re-send them.
let lastShowSettings: ShowSettings = defaultShowSettings()
// Whether the window has ever sent them. Until it has, the defaults above are a guess
// made so a console that is already talking at launch is heard; they are not the show,
// and starting services on them when a key arrives would bind a port this workspace
// does not use.
let settingsReceived = false

const PRO_REQUIRED = 'Cuerunner Pro is required for the show services'

// One batch, every window that is still alive. A window that is mid-reload has no
// listener yet; it catches up from the snapshot it asks for on startup. A window whose
// renderer was killed is the case that matters here: the show keeps running in this
// process, so engine events keep arriving for a window that is not there, and sending to
// it throws rather than being skipped.
function broadcastToWindows(channel: EventChannel, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) sendToWindow(win, channel, payload)
}

function broadcastShowEvents(events: ShowEvent[]): void {
  broadcastToWindows(SHOW_CHANNELS.events, events)
}

// Engine events are batched over a frame: a panic stops every voice at once, and the
// window wants that as one message rather than one per voice.
const AUDIO_EVENT_FLUSH_MS = 16
const pendingAudioEvents: AudioEngineEvent[] = []
let audioEventFlush: NodeJS.Timeout | null = null

function queueAudioEvents(event: AudioEngineEvent): void {
  pendingAudioEvents.push(event)
  if (audioEventFlush !== null) return
  audioEventFlush = setTimeout(() => {
    audioEventFlush = null
    const batch = pendingAudioEvents.splice(0, pendingAudioEvents.length)
    if (batch.length > 0) broadcastToWindows(AUDIO_CHANNELS.events, batch)
  }, AUDIO_EVENT_FLUSH_MS)
  // A flush owes the window nothing if the app is quitting.
  audioEventFlush.unref?.()
}

show.subscribe(events => {
  broadcastShowEvents(events)
  // The two bindings a show already has for panicking, acted on in the process that
  // owns the engine rather than the one that owns the screen. These arrive through the
  // licensed show inputs — the same socket and the same ports as everything else the
  // panel shows — so nothing new is listening and nothing is loosened to make it work.
  for (const event of events) {
    const binding = panicFromShowEvent(event) ?? remotePanicFromEvent(event, lastShowSettings.oscIn)
    if (binding) playbackSafety.panic(binding.source, binding.reason)
  }
})

/**
 * A license that changes takes the show services with it: entering a key starts what
 * the window had configured, and a key that lapses stops the Pro half while the free
 * listeners keep running. One configure does both, because the host answers the
 * licence question for every service rather than the app answering it for all of them.
 * The window is told as well, so the panels it draws follow the same fact.
 *
 * A key entered before the window has sent its settings starts nothing: the window
 * re-sends them the moment it sees the license, and starting the defaults first would
 * bind a port on a machine that may not use one.
 */
license.subscribe((status: LicenseStatus) => {
  for (const win of BrowserWindow.getAllWindows()) sendToWindow(win, LICENSE_CHANNELS.changed, status)
  if (settingsReceived) void show.configure(lastShowSettings)
})

function getWin(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(event.sender)!
}

export function registerIpcHandlers(): void {
  // Teardown belongs in `will-quit`, not `before-quit`: the unsaved-changes prompt runs
  // after `before-quit` and the operator can cancel the quit there, at which point the
  // window is still up and the show is still meant to run. A closed ShowBus cannot be
  // reopened, and a service stopped here is never started again — the next configure
  // finds the settings unchanged and asks for nothing — so a cancelled quit would leave
  // the session with no OSC input, no triggers, no desk and no companion, silently.
  app.on('will-quit', () => osc.close())
  // A request in flight must not outlive the window that asked for it.
  app.on('will-quit', () => network.close())
  app.on('will-quit', () => clearTimeout(audioEventFlush ?? undefined))
  // The services hold sockets and poll timers of their own.
  app.on('will-quit', () => show.close())

  // The services come up with the defaults, before the window has finished loading:
  // a console that is already sending when the operator launches the app should not
  // have its first cues fall on the floor. The renderer re-sends its own settings —
  // which may come from the workspace — as soon as it has them. The free services start
  // on any machine; the Pro ones answer to the licence, and the host says so in their
  // status rather than leaving a port bound to nothing.
  void show.configure(defaultShowSettings())

  // Video outputs: the windows main keeps for the show's pictures (src/main/output).
  registerOutputHandlers()

  // Audio
  /**
   * One audio verb, as the window will read it: a value or a refusal, never a rejection.
   * Electron logs a rejected handler to stderr with a stack, and a refusal here is a
   * normal state of the engine (no devices on a silent backend, an engine being
   * restarted), not a fault to be reported.
   */
  const audioVerb = <T>(run: () => Promise<T>): Promise<AudioResult<T>> =>
    run().then(
      value => ({ ok: true as const, value }),
      error => refusalFrom(error)
    )

  /**
   * The window a waveform or onset request names, if it names one. Both ends together,
   * because half a window is not one — and neither is a request for the whole file.
   */
  const regionOf = (payload: { startMs?: number; endMs?: number }): AudioRegion | undefined =>
    payload.startMs === undefined || payload.endMs === undefined
      ? undefined
      : { startMs: payload.startMs, endMs: payload.endMs }

  ipcMain.handle(AUDIO_CHANNELS.pickFile, async (event) => {
    const result = await dialog.showOpenDialog(getWin(event), {
      title: 'Select Audio File',
      filters: [
        { name: 'Audio', extensions: [...AUDIO_FILE_EXTENSIONS] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // The audio engine's verbs. Every one of them is a command on the sample clock, so
  // the window can schedule ahead and read back where the sound actually is; no media
  // ever crosses this boundary. The engine lives in this process, which is what lets
  // the panic path silence the show without the window's help.
  //
  // Each answers with the engine's own `{ ok, value } | { ok, code, message }` rather than
  // by rejecting, and the preload unwraps it in the window (see shared/audioResult.ts).
  // A rejection here is not free: Electron logs every rejected `ipcMain.handle` to stderr
  // with a stack, and this path refuses by design — the silent backend has no devices, and
  // the clock is read while an engine is being restarted. Those refusals used to be the
  // bulk of the Windows E2E log, which is exactly where an engine failure is meant to be
  // findable.
  ipcMain.handle(AUDIO_CHANNELS.prepare, (_, payload: AudioPreparePayload) =>
    audioVerb(() => audioEngine.prepare(payload.cueId, payload.filePath)))
  ipcMain.handle(AUDIO_CHANNELS.start, (_, payload: AudioStartPayload) =>
    audioVerb(() => audioEngine.start(payload.cueId, payload.whenMs, payload.options)))
  ipcMain.handle(AUDIO_CHANNELS.stop, (_, payload: AudioStopPayload) =>
    audioVerb(() => audioEngine.stop(payload.cueId, payload.fadeMs, payload.whenMs)))
  ipcMain.handle(AUDIO_CHANNELS.stopAll, (_, payload: AudioStopAllPayload) =>
    audioVerb(() => audioEngine.stopAll(payload.fadeMs)))
  ipcMain.handle(AUDIO_CHANNELS.seek, (_, payload: AudioSeekPayload) =>
    audioVerb(() => audioEngine.seek(payload.cueId, payload.positionMs, payload.whenMs)))
  ipcMain.handle(AUDIO_CHANNELS.release, (_, payload: AudioReleasePayload) =>
    audioVerb(() => audioEngine.release(payload.cueId, payload.whenMs, payload.endMs)))
  ipcMain.handle(AUDIO_CHANNELS.cancel, (_, payload: AudioCancelPayload) =>
    audioVerb(() => audioEngine.cancel(payload.cueId, payload.whenMs)))
  ipcMain.handle(AUDIO_CHANNELS.pause, (_, payload: AudioHoldPayload) =>
    audioVerb(() => audioEngine.pause(payload.cueId, payload.whenMs)))
  ipcMain.handle(AUDIO_CHANNELS.resume, (_, payload: AudioHoldPayload) =>
    audioVerb(() => audioEngine.resume(payload.cueId, payload.whenMs)))
  ipcMain.handle(AUDIO_CHANNELS.master, (_, payload: AudioMasterPayload) =>
    audioVerb(() => audioEngine.master(payload.gain)))
  ipcMain.handle(AUDIO_CHANNELS.meters, () => audioVerb(() => audioEngine.meters()))
  ipcMain.handle(AUDIO_CHANNELS.routing, (_, payload: AudioRoutingPayload) =>
    audioVerb(() => audioEngine.routing(payload.cueId, payload.outputs)))
  ipcMain.handle(AUDIO_CHANNELS.fade, (_, payload: AudioFadePayload) =>
    audioVerb(() =>
      audioEngine.fade(payload.cueId, payload.param, payload.value, payload.durationMs, payload.curve, payload.whenMs)
    ))
  ipcMain.handle(AUDIO_CHANNELS.progress, (_, payload: AudioProgressPayload) =>
    audioVerb(() => audioEngine.progress(payload.cueId)))
  ipcMain.handle(AUDIO_CHANNELS.panic, (_, payload: AudioPanicPayload) =>
    audioVerb(() => audioEngine.panic(payload.fadeMs)))
  ipcMain.handle(AUDIO_CHANNELS.clock, () => audioVerb(() => audioEngine.clock()))
  ipcMain.handle(AUDIO_CHANNELS.info, () => audioVerb(() => audioEngine.info()))
  ipcMain.handle(AUDIO_CHANNELS.devices, () => audioVerb(() => audioEngine.devices()))
  ipcMain.handle(AUDIO_CHANNELS.configure, (_, payload: AudioConfigurePayload) =>
    audioVerb(() => audioEngine.configure(payload.options)))
  ipcMain.handle(AUDIO_CHANNELS.waveform, (_, payload: AudioWaveformPayload) =>
    audioVerb(() => audioEngine.waveform(payload.filePath, payload.points, regionOf(payload))))
  // A workspace footprint asks about every cue: headers only, nothing decoded, nothing
  // cached, nothing counted.
  ipcMain.handle(AUDIO_CHANNELS.onsets, (_, payload: AudioOnsetsPayload) =>
    audioVerb(() => audioEngine.onsets(payload.filePath, payload.sensitivity, payload.maxOnsets, regionOf(payload))))
  ipcMain.handle(AUDIO_CHANNELS.silence, (_, payload: AudioSilencePayload) =>
    audioVerb(() => audioEngine.silence(payload.filePath, payload.thresholdDb)))
  ipcMain.handle(AUDIO_CHANNELS.probe, (_, payload: AudioProbePayload) =>
    audioVerb(() => audioEngine.probe(payload.filePath)))

  // Every engine event is both forwarded to the window and kept for the safety net: a
  // burst — a panic stopping twenty voices at once — is one message rather than twenty,
  // and the last few are held so the acceptance tests can read what the engine said.
  audioEngine.subscribe(event => {
    noteEngineEvents([event])
    queueAudioEvents(event)
    // One of those lines is an alarm as well as a line for the log: a device the engine
    // lost. It is raised in the engine's own words through the alarm path that is already
    // there — the monitor's strip, the transport chip, dismissible as alarms are — and
    // which events are that alarm is decided in one place, beside the other engine-event
    // bindings (safety/engineFaults).
    const alarm = deviceFaultAlert(event)
    if (alarm !== null) show.alert(alarm.level, alarm.source, alarm.message)
  })

  // MIDI
  ipcMain.handle(MIDI_CHANNELS.listPorts, () => midi.listOutputPorts())
  ipcMain.handle(MIDI_CHANNELS.listInputPorts, () => midi.listInputPorts())

  // Whether MIDI can work at all in this build. A machine without the optional native
  // module has to be able to say so, or a cue that reaches nothing looks like one that
  // worked.
  ipcMain.handle(MIDI_CHANNELS.status, () => midi.status())

  // Both return what the engine did, so a cue that reached nothing is reported rather
  // than looking like every other successful firing.
  ipcMain.handle(MIDI_CHANNELS.send, async (_, cmd: MidiSendPayload): Promise<MidiSendResult> =>
    midi.send(cmd.portName, cmd.messages))

  // A desk on the network — an SQ or an Avantis — where the same bytes go to a socket
  // rather than to a port this machine opened. A channel of its own because the
  // destination is an address, and the answer worth having is whether the desk took it.
  ipcMain.handle(MIDI_CHANNELS.sendTcp, async (_, cmd: MidiSendTcpPayload): Promise<MidiSendResult> =>
    midiTcp.send(cmd.host, cmd.port, cmd.messages))

  // MIDI File cues. Free, like every other MIDI cue. The file is read and played here, where
  // the port is; the window is told what the file holds and how long a run will take, and a
  // file that cannot be played or a port that is not there is an answer, not a fault.
  ipcMain.handle(MIDI_CHANNELS.pickFile, async (event) => {
    const result = await dialog.showOpenDialog(getWin(event), {
      title: 'Select MIDI File',
      filters: [
        { name: 'MIDI Files', extensions: [...MIDI_FILE_EXTENSIONS] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle(MIDI_CHANNELS.fileInspect, (_, cmd: MidiFileInspectPayload): Promise<MidiFileInspectResult> =>
    refusalValue(async () => ({ ok: true as const, summary: await midiFiles.inspect(cmd.filePath) })))
  ipcMain.handle(MIDI_CHANNELS.filePlay, (_, cmd: MidiFilePlayPayload): Promise<MidiFilePlayResult> =>
    refusalValue(async () => ({ ok: true as const, ...await midiFiles.play(cmd) })))
  ipcMain.handle(MIDI_CHANNELS.filePause, (_, cmd: MidiFileCuePayload): Promise<MidiFilePauseResult> =>
    refusalValue(async () => ({ ok: true as const, ...midiFiles.pause(cmd.cueId) })))
  ipcMain.handle(MIDI_CHANNELS.fileResume, (_, cmd: MidiFileCuePayload): Promise<MidiFileResumeResult> =>
    refusalValue(async () => ({ ok: true as const, ...midiFiles.resume(cmd.cueId) })))
  ipcMain.handle(MIDI_CHANNELS.fileStop, (_, cmd: MidiFileCuePayload): boolean => midiFiles.stop(cmd.cueId))

  // OSC
  ipcMain.handle(OSC_CHANNELS.send, async (_, cmd: OscSendPayload): Promise<OscSendResult> =>
    osc.send(cmd.host, cmd.port, cmd.address, cmd.args))
  ipcMain.handle(OSC_CHANNELS.interfaces, (): OscInterfaceState => oscInterfaces.state())
  ipcMain.handle(OSC_CHANNELS.setInterface, (_, payload: OscSetInterfacePayload): Promise<OscSetInterfaceResult> =>
    refusalValue(async () => ({ ok: true as const, ...await oscInterfaces.set(payload.direction, payload.name) })))

  // Network cues. No license gate: network cues shipped in the free half of the app, and
  // this is the same cue making the same request from a process the page's origin does
  // not apply to. A console on the LAN does not send CORS headers, and the request has
  // to outlive a busy or reloaded window.
  ipcMain.handle(NETWORK_CHANNELS.request, async (_, request: NetworkRequest) => network.request(request))
  ipcMain.handle(NETWORK_CHANNELS.cancel, async (_, requestId: string) => network.cancel(requestId))

  // The renderer is alive and the show still has someone at the wheel. The watchdog
  // silences the engine when these stop arriving while anything is playing, so the
  // renderer sends one on its own timer whether or not a cue is running.
  ipcMain.handle(PLAYBACK_CHANNELS.heartbeat, () => {
    playbackSafety.noteHeartbeat()
  })

  // Show services. The renderer never talks to a service directly: it configures the
  // set, reads a snapshot, and sends a command to one by id, so a service can be added
  // without a new IPC channel.
  ipcMain.handle(SHOW_CHANNELS.snapshot, async () => {
    // A locked app has services registered and none of them started, so this is the
    // truth: nothing is listening.
    return show.snapshot()
  })

  // Failures the main process reported before the window was listening. The renderer
  // takes them on startup so a broken launch is explained rather than silent.
  ipcMain.handle(APP_CHANNELS.drainMainErrors, () => drainMainErrors())

  // The problem report: composed on request, shown by the window, and sent nowhere by the
  // app. Saving and mailing take back the text the window showed, so what leaves is what
  // was read. An ordinary refusal (nothing to send, a report past its ceiling) is an answer.
  const reportSources = { engine: audioEngine, license: () => license.status() }
  ipcMain.handle(APP_CHANNELS.composeReport, (_, input: ReportInput) =>
    composeProblemReport(reportSources, input))
  ipcMain.handle(APP_CHANNELS.saveReport, (event, text: unknown) =>
    refusalValue(() => saveReport(getWin(event), text)))
  ipcMain.handle(APP_CHANNELS.emailReport, (_, text: unknown) =>
    refusalValue(() => emailReport(text)))

  // The session log on disk: the window's lines as it writes them, and main's own failures,
  // which reach the file even when there is no window left to forward them. A batch that is
  // not a bounded list of lines is not written — the file is not a place a window can pour into.
  const logFile = sessionLogFile()
  onMainError(message => { void logFile.append([`ERROR [main] ${message}`]) })
  ipcMain.handle(APP_CHANNELS.writeLog, async (_, lines: unknown) => {
    if (isLogBatch(lines)) await logFile.append(lines)
  })
  ipcMain.handle(APP_CHANNELS.openLogs, () => refusalValue(() => openLogsFolder()))

  ipcMain.handle(SHOW_CHANNELS.configure, async (_, settings: ShowSettings) => {
    lastShowSettings = settings
    settingsReceived = true
    // No licence check here any more: the host decides per service, because OSC and
    // MIDI input are the free half and the desk link, the radios, the network and the
    // pair are not. A blanket refusal here would also have stopped the free listeners.
    await show.configure(settings)
  })

  ipcMain.handle(SHOW_CHANNELS.command, async (_, cmd: ShowCommandPayload): Promise<ShowCommandResult> =>
    show.command(cmd.service, cmd.action, cmd.payload))

  ipcMain.handle(SHOW_CHANNELS.restart, async (_, service: string): Promise<ShowCommandResult> =>
    show.restart(service))

  // What this machine holds for an EW-DX receiver. The password is the machine's, never
  // the show's, so it has channels of its own rather than a field in the settings the
  // window saves; and what comes back is never the password — only whether there is one.
  // Reading is open, like the redundancy settings: a locked app can say what it holds,
  // and the gate is on the change.
  const ewDxStatus = (sourceId: string): EwDxCredentialStatus => {
    const held = ewDxCredentials.get(sourceId)
    return {
      hasPassword: held !== undefined,
      encrypted: ewDxCredentials.encrypted(),
      fingerprint: held?.fingerprint ?? null,
      serial: held?.serial ?? null,
      moved: held?.moved ?? null
    }
  }

  // A change to what is held is a restart of the one service that reads it: the session
  // for that receiver is opened with the password it was given when the service starts.
  const ewDxApplied = async (): Promise<void> => {
    if (settingsReceived) await show.restart('rf')
    else await show.configure(lastShowSettings)
  }

  const ewDxSourceId = (value: unknown): string => {
    if (typeof value !== 'string' || value === '' || value.length > 128) {
      throw new Error('EW-DX credentials need a source id')
    }
    return value
  }

  ipcMain.handle(SHOW_CHANNELS.ewDxCredentials, (_, sourceId: string): EwDxCredentialStatus =>
    ewDxStatus(ewDxSourceId(sourceId)))

  ipcMain.handle(SHOW_CHANNELS.ewDxSetPassword, (_, payload: EwDxSetPasswordPayload): Promise<EwDxCredentialResult> =>
    refusalValue(async () => {
      const sourceId = ewDxSourceId(payload.sourceId)
      if (!isPro(license.status())) throw new Refusal(PRO_REQUIRED)
      // The field is typed by a person: a blank is an answer to give, and the bound is
      // what keeps a pasted file from becoming a password.
      if (typeof payload.password !== 'string' || payload.password === '') {
        throw new Refusal('Enter the password set for this receiver in WSM')
      }
      if (payload.password.length > 256) throw new Refusal('That password is too long to be one')
      try {
        await ewDxCredentials.setPassword(sourceId, payload.password)
      } catch (error) {
        // A locked or absent keychain is a state of this computer, and the window can say
        // so; a disk that will not take the write is a fault and keeps rejecting.
        if (error instanceof KeychainRefusedError) {
          throw new Refusal(`This computer's keychain would not keep the password: ${error.message}`)
        }
        throw error
      }
      await ewDxApplied()
      return { ok: true as const, ...ewDxStatus(sourceId) }
    }))

  ipcMain.handle(SHOW_CHANNELS.ewDxTrustAgain, (_, sourceId: string): Promise<EwDxCredentialResult> =>
    refusalValue(async () => {
      const id = ewDxSourceId(sourceId)
      if (!isPro(license.status())) throw new Refusal(PRO_REQUIRED)
      await ewDxCredentials.unpin(id)
      await ewDxApplied()
      return { ok: true as const, ...ewDxStatus(id) }
    }))

  // A look at the network, made when the settings window asks and not before: a show that
  // never opens that page sends nothing. It only reads — nothing is added, and nothing
  // logs in — so it is open to a locked app like the rest of what only reads.
  ipcMain.handle(SHOW_CHANNELS.ewDxDiscover, (): Promise<EwDxDiscoverResult> => discoverReceivers())

  ipcMain.handle(SHOW_CHANNELS.ewDxForget, async (_, sourceId: string): Promise<EwDxCredentialStatus> => {
    const id = ewDxSourceId(sourceId)
    // Forgetting is housekeeping for a source that is already gone from the show, so it
    // is not behind the licence: a lapsed key must not leave a password behind.
    await ewDxCredentials.forget(id)
    return ewDxStatus(id)
  })

  // Redundant playback. Which half of a pair this machine is, and where its partner is,
  // are the machine's own settings — the showfile travels between the two — so they are
  // read and written through their own pair of channels rather than through the
  // workspace's settings. Reading is open: a locked app should be able to say what it
  // would be, and the gate is on the change.
  ipcMain.handle(REDUNDANCY_CHANNELS.settings, () => machineRedundancy.current())

  ipcMain.handle(REDUNDANCY_CHANNELS.configure, async (
    _, patch: Partial<RedundancySettings>
  ): Promise<RedundancyConfigureResult> => {
    if (!isPro(license.status())) return { ok: false, error: PRO_REQUIRED, settings: machineRedundancy.current() }
    const settings = await machineRedundancy.update(patch)
    // The service reads this machine's settings when it starts, so a change is a restart
    // of that one service — a new port, a new partner, being switched off — rather than a
    // reconfigure of the whole show, which would drop every other listener with it.
    if (settingsReceived) await show.restart('redundancy')
    else await show.configure(lastShowSettings)
    return { ok: true, settings }
  })

  // Timecode. The settings are the machine's and free to read and write — they only say
  // where to listen, and the receiver that listens is a Pro service the host answers for.
  // Starting a clock is the Pro half, refused here where the licence is known.
  ipcMain.handle(TIMECODE_CHANNELS.settings, (): TimecodeSettings => timecodeHub.current())
  ipcMain.handle(TIMECODE_CHANNELS.configure, (_, patch: Partial<TimecodeSettings>): Promise<TimecodeSettings> =>
    timecodeHub.update(patch))
  ipcMain.handle(TIMECODE_CHANNELS.show, (_, settings: TimecodeShowSettings): TimecodeShowSettings =>
    timecodeHub.applyShow(settings))
  ipcMain.handle(TIMECODE_CHANNELS.status, () => timecodeHub.status())
  ipcMain.handle(TIMECODE_CHANNELS.inputs, async (): Promise<TimecodeInputs> => {
    // An engine that is not running has no capture devices to offer; the MIDI ports remain.
    const audio = await timecodeHub.ltcInputs().catch(() => [])
    return { midi: midi.listInputPorts(), audio }
  })
  ipcMain.handle(TIMECODE_CHANNELS.generate, (_, request: TimecodeGenerateRequest): Promise<TimecodeGenerateResult> =>
    refusalValue(async () => {
      if (!isPro(license.status())) throw new Refusal('Cuerunner Pro is required to generate timecode')
      const result = await timecodeHub.generate(request)
      if (!result.ok) throw new Refusal(result.error)
      return result
    }))
  ipcMain.handle(TIMECODE_CHANNELS.control, (_, payload: TimecodeControlPayload): Promise<boolean> =>
    timecodeHub.control(payload.cueId, payload.action))
  // The clocks a cue started stop with the app, and so does the reader.
  app.on('will-quit', () => timecodeHub.dispose())

  // Updates. Free, and every step the operator's: a check, a download, a restart — each
  // refused with a sentence while the show runs or the lockout holds. The window reports the
  // show's state as it changes; the service is made on the first call, not at registration.
  ipcMain.handle(UPDATE_CHANNELS.status, (): UpdateStatus => updates().status())
  ipcMain.handle(UPDATE_CHANNELS.check, (): Promise<UpdateCheckResult> =>
    refusalValue(async () => ({ ok: true as const, status: await updates().check() })))
  ipcMain.handle(UPDATE_CHANNELS.download, (): Promise<UpdateActionResult> =>
    refusalValue(async () => {
      await updates().download()
      return { ok: true as const }
    }))
  ipcMain.handle(UPDATE_CHANNELS.install, (): Promise<UpdateActionResult> =>
    refusalValue(async () => {
      await updates().install()
      return { ok: true as const }
    }))
  ipcMain.handle(UPDATE_CHANNELS.configure, (_, patch: Partial<UpdateSettings>): Promise<UpdateStatus> =>
    updates().configure(patch))
  ipcMain.handle(UPDATE_CHANNELS.report, (_, state: UpdateShowState): void => {
    updates().report(state)
  })
  ipcMain.handle(UPDATE_CHANNELS.whatsNew, (): Promise<WhatsNew | null> => updates().takeWhatsNew())
  ipcMain.handle(UPDATE_CHANNELS.openDownloads, (): Promise<void> => openDownloads())

  // License. The window reads the status, asks for a key to be checked, and is told
  // when it changes — including the change it asked for.
  ipcMain.handle(LICENSE_CHANNELS.status, () => license.status())
  ipcMain.handle(LICENSE_CHANNELS.activate, (_, text: string) => license.activate(text))
  ipcMain.handle(LICENSE_CHANNELS.deactivate, () => license.deactivate())

  // Script
  // include() resolves against the file that is doing the including, or the workspace
  // directory for the script body itself; the resolved path goes back so the file's own
  // includes can be resolved against it. A file that is not there (or cannot be read) is
  // an ordinary state of the show, so this answers with the declared refusal arm rather
  // than rejecting — the script sees the same sentence, minus the transport wrapper a
  // rejection carried, and main logs no stack for a path the operator typed.
  ipcMain.handle(SCRIPT_CHANNELS.readFile, (_, payload: ScriptReadFilePayload): Promise<ScriptReadFileResult> =>
    refusalValue(async () => {
      const from = payload.base !== undefined
        ? path.dirname(payload.base)
        : payload.workspacePath !== null
          ? path.dirname(payload.workspacePath)
          : process.cwd()
      const resolved = path.isAbsolute(payload.relativePath)
        ? payload.relativePath
        : path.resolve(from, payload.relativePath)
      try {
        return { ok: true as const, code: await readFile(resolved, 'utf-8'), path: resolved }
      } catch (error) {
        throw asRefusal(error)
      }
    }))

  // The script panel's reader. It refuses what it cannot show — a binary file, or a
  // document far larger than any script — because rendering one is what took the
  // window's process to 3 GB and stopped the interface answering. The panel itself is
  // Pro, so a locked app is refused here as well as in the window. Script *cues* read
  // their includes through `script:readFile` above, which stays free.
  ipcMain.handle(SCRIPT_CHANNELS.readDocument, async (_, payload: ScriptReadDocumentPayload): Promise<ScriptDocument> => {
    if (!isPro(license.status())) {
      return { ok: false, error: 'The script panel is part of Cuerunner Pro.' }
    }
    return loadScriptDocument(payload.filePath, payload.workspacePath)
  })

  // The script panel reads the document the same way a script cue reads its includes.
  ipcMain.handle(SCRIPT_CHANNELS.pickFile, async (event) => {
    if (!isPro(license.status())) return null
    const result = await dialog.showOpenDialog(getWin(event), {
      title: 'Select Script',
      filters: [
        { name: 'Script', extensions: ['txt', 'md', 'markdown', 'fountain', 'cue'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle(
    SCRIPT_CHANNELS.shell,
    async (_event, payload: ScriptShellPayload): Promise<ScriptShellResult> => {
      const options = payload.options ?? {}
      const timeout = options.timeout ?? 10000
      // The workspace file stands in for its folder; a folder is itself, dots and all.
      const cwd = shellWorkingDirectory(options.cwd)
      const env = { ...process.env, ...options.env }

      const { promise, resolve } = Promise.withResolvers<ScriptShellResult>()
      const child = exec(payload.command, { cwd, env, timeout, killSignal: 'SIGTERM' })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data: string) => {
        stdout += data
      })

      child.stderr?.on('data', (data: string) => {
        stderr += data
      })

      child.on('close', (code: number | null, signal: string | null) => {
        resolve({ stdout, stderr, code, signal })
      })

      child.on('error', (err: Error & { code?: string }) => {
        resolve({ stdout, stderr: err.message, code: 1, signal: null })
      })

      return promise
    }
  )

  // Workspace. Opening, recovering and relinking all resolve the media an audio cue
  // points at, because a workspace that came from another machine has paths that only
  // mean something there; the result carries what is missing so the window can offer to
  // find it rather than firing a cue at a file that is not there.
  // The handlers that declare a refusal arm — open, openPath, openDemo, recovery, and the
  // export/import/merge/compare block below — answer it for an ordinary reason: a file
  // this build cannot draw, a demo that is not the shape it ships, an archive that arrived
  // damaged, a folder that already holds these files. Only a genuine fault rejects. The
  // rest of the namespace keeps the shapes it had: a cancel is a null inside an `ok` arm,
  // and a save's fs failure is a fault.
  ipcMain.handle(WORKSPACE_CHANNELS.open, (event): Promise<WorkspaceOpenResult> =>
    refusalValue(async () => ({ ok: true as const, opened: await openWorkspace(getWin(event)) })))

  ipcMain.handle(WORKSPACE_CHANNELS.openPath, (_, filePath: string): Promise<WorkspaceOpenPathResult> =>
    refusalValue(async () => ({ ok: true as const, opened: await openWorkspaceFromPath(filePath) })))

  ipcMain.handle(WORKSPACE_CHANNELS.openDemo, (): Promise<WorkspaceDemoResult> =>
    refusalValue(async () => ({ ok: true as const, workspace: await openDemoWorkspace() })))

  ipcMain.handle(WORKSPACE_CHANNELS.relink, async (
    event, payload: WorkspaceRelinkPayload
  ): Promise<RelinkedWorkspace> =>
    relinkWorkspaceMedia(getWin(event), payload.workspace, payload.workspacePath, payload.cueId))

  // A save is where this build checks the bytes it is about to write by reading them back,
  // so a refusal belongs to this channel like any other ordinary state: the answer is the
  // sentence, and the file the save would have replaced is untouched.
  ipcMain.handle(WORKSPACE_CHANNELS.save, (event, payload: WorkspaceSavePayload): Promise<WorkspaceSaveResult> =>
    refusalValue(async (): Promise<WorkspaceSaveResult> => ({
      ok: true,
      saved: await saveWorkspace(getWin(event), payload.workspace, payload.existingPath)
    })))

  ipcMain.handle(WORKSPACE_CHANNELS.saveAs, (event, workspace: Workspace): Promise<WorkspaceSaveResult> =>
    refusalValue(async (): Promise<WorkspaceSaveResult> => ({
      ok: true,
      saved: await saveWorkspaceAs(getWin(event), workspace)
    })))

  // Reading a show's history — and comparing two of them — is the Pro half of the
  // showfile work. The file records its history either way: the data belongs to the show,
  // and a window that is not licensed still saves one.
  // A bundle is a show and its media in one file, for handover. It is a Pro surface like
  // the rest of the showfile work; the show it carries is the operator's either way.
  ipcMain.handle(
    WORKSPACE_CHANNELS.exportBundle,
    (event, payload: WorkspaceExportPayload): Promise<WorkspaceExportResult> =>
      refusalValue(async (): Promise<WorkspaceExportResult> => {
        if (!isPro(license.status())) return { ok: false, error: PRO_REQUIRED }
        return { ok: true, exported: await exportBundle(getWin(event), payload.workspace, payload.workspacePath) }
      })
  )

  ipcMain.handle(WORKSPACE_CHANNELS.importBundle, (event): Promise<WorkspaceImportResult> =>
    refusalValue(async (): Promise<WorkspaceImportResult> => {
      if (!isPro(license.status())) return { ok: false, error: PRO_REQUIRED }
      return { ok: true, imported: await importBundle(getWin(event)) }
    }))

  // Two files merge into a third, written where the operator says. The files the last
  // merge read are kept for a second attempt with the other side's choices: the report is
  // where an operator learns there was a conflict, and re-running it should not mean
  // finding the same two files again.
  let lastMerge: MergeInputs | null = null
  ipcMain.handle(
    WORKSPACE_CHANNELS.merge,
    (event, payload: WorkspaceMergePayload): Promise<WorkspaceMergeResult> =>
      refusalValue(async (): Promise<WorkspaceMergeResult> => {
        if (!isPro(license.status())) return { ok: false, error: PRO_REQUIRED }
        const policy = payload.options?.policy ?? 'ours'
        const again = payload.options?.again === true
        if (again && lastMerge === null) {
          return { ok: false, error: 'there is no merge to try again' }
        }
        const merged = await mergeShow(
          getWin(event),
          payload.workspace,
          payload.workspacePath,
          policy,
          // A second attempt reads the same two files; without `again` the dialogs ask.
          again ? (lastMerge ?? undefined) : undefined
        )
        if (merged) lastMerge = merged.inputs
        return { ok: true, merged }
      })
  )

  ipcMain.handle(WORKSPACE_CHANNELS.compare, (event, workspace: Workspace): Promise<WorkspaceCompareResult> =>
    refusalValue(async (): Promise<WorkspaceCompareResult> => {
      if (!isPro(license.status())) return { ok: false, error: PRO_REQUIRED }
      return { ok: true, comparison: await compareWorkspace(getWin(event), workspace) }
    }))

  ipcMain.handle(WORKSPACE_CHANNELS.recent, async () => getRecentFiles())

  // Autosave goes to the recovery snapshot, never over the operator's file. The cue the
  // session is standing on goes with it, so a recovered show hands back the place as well
  // as the cues — and so does the identity of the file the session was built from, which
  // main already holds: a save after a crash can then report the file changing while the
  // app was dead.
  ipcMain.handle(WORKSPACE_CHANNELS.autosave, async (_, payload: WorkspaceAutosavePayload) => {
    await writeRecovery(
      payload.workspace,
      payload.sourcePath,
      payload.selectedCueId,
      knownFingerprint(payload.sourcePath)
    )
  })

  // Recovery resolves the media in the snapshot the same way opening a file does; its
  // directory is what a relative path in the snapshot is relative to.
  ipcMain.handle(WORKSPACE_CHANNELS.recovery, (): Promise<WorkspaceRecoveryResult> =>
    refusalValue(async () => ({ ok: true as const, recovery: await openRecovery() })))

  ipcMain.handle(WORKSPACE_CHANNELS.clearRecovery, async () => clearRecovery())

  ipcMain.handle(WORKSPACE_CHANNELS.setTitle, async (event, title: string) => {
    // The window can be gone by the time this arrives: the kill tests stop the renderer
    // while the main process keeps running the show, and the title update that was in
    // flight then has nowhere to land. Doing nothing is the correct behaviour, and it is
    // the difference between a title and an exception in the log.
    const win = BrowserWindow.fromWebContents(event.sender)
    if (liveWindow(win)) win.setTitle(title)
  })

  ipcMain.handle(WORKSPACE_CHANNELS.confirmClose, async (event, workspaceName: string): Promise<0 | 1 | 2> => {
    const result = await dialog.showMessageBox(getWin(event), {
      type: 'question',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Do you want to save changes to "${workspaceName}"?`,
      detail: 'Your changes will be lost if you don\'t save them.'
    })
    // 0=save, 1=don't save, 2=cancel. The dialog has no fourth button, and the bridge's
    // declared answer is the three it does have, so anything else reads as Save.
    return result.response === 1 ? 1 : result.response === 2 ? 2 : 0
  })

  // QLab import. Free: it is how a QLab user arrives, and the show it makes is theirs. The
  // file is read and the socket opened here, never in the window; a file that is not a
  // workspace, a QLab that is not there and a passcode it would not take are the refusal
  // arm, said where each was found (`src/main/import/`).
  ipcMain.handle(QLAB_CHANNELS.importFile, (event): Promise<QLabImportResult> =>
    refusalValue(async (): Promise<QLabImportResult> => ({ ok: true, imported: await importQLabFile(getWin(event)) })))

  ipcMain.handle(
    QLAB_CHANNELS.listWorkspaces,
    (_, address: { host: unknown; port: unknown }): Promise<QLabWorkspacesResult> =>
      refusalValue(async (): Promise<QLabWorkspacesResult> => ({
        ok: true,
        workspaces: await listLiveWorkspaces(address?.host, address?.port)
      }))
  )

  ipcMain.handle(QLAB_CHANNELS.importLive, (_, payload: QLabLivePayload): Promise<QLabImportResult> =>
    refusalValue(async (): Promise<QLabImportResult> => ({ ok: true, imported: await importQLabLive(payload) })))

  ipcMain.handle(QLAB_CHANNELS.findMedia, (event, payload: QLabFindMediaPayload): Promise<QLabFindMediaResult> =>
    refusalValue(async (): Promise<QLabFindMediaResult> => ({
      ok: true,
      found: await findMediaInFolder(getWin(event), payload.workspace, payload.workspacePath)
    })))
}
