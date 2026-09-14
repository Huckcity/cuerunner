import { app, ipcMain, dialog, BrowserWindow, net } from 'electron'
import { readFile } from 'fs/promises'
import { exec } from 'child_process'
import * as path from 'path'
import { MidiEngine } from '../midi/MidiEngine'
import type { MidiModuleLoader } from '../midi/MidiEngine'
import { NetworkClient } from '../network/NetworkClient'
import type { NetworkRequest } from '../../renderer/src/types/network'
import { audioEngine } from '../audio/AudioEngine'
import {
  AUDIO_CHANNELS,
  type AudioCancelPayload,
  type AudioReleasePayload,
  type AudioOnsetsPayload,
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
import { liveWindow, sendToWindow } from './broadcast'
import { playbackSafety, noteEngineEvents } from '../safety/runtime'
import { panicFromShowEvent } from '../safety/panicBindings'
import { OscEngine } from '../osc/OscEngine'
import {
  openWorkspace,
  openWorkspaceFromPath,
  openRecovery,
  saveWorkspace,
  saveWorkspaceAs,
  relinkWorkspaceMedia,
  getRecentFiles
} from '../workspace/WorkspaceManager'
import { clearRecovery, writeRecovery } from '../workspace/recovery'
import { openDemoWorkspace } from '../workspace/demo'
import { createShowRuntime } from '../show/runtime'
import { drainMainErrors } from '../errors'
import { loadScriptDocument } from '../script/document'
import { createLicenseManager } from '../license/LicenseManager'
import { trustedPublicKeys } from '../license/trustedKeys'
import { defaultShowSettings } from '../../renderer/src/types/show'
import { isPro } from '../../renderer/src/types/license'
import type { ShowEvent, ShowSettings } from '../../renderer/src/types/show'
import type { LicenseStatus } from '../../renderer/src/types/license'
import type { Workspace } from '../../renderer/src/types/workspace'

const midi = new MidiEngine(midiModuleLoader())
const osc = new OscEngine()
const show = createShowRuntime()

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
  if (!app.isPackaged && process.env['WINSLAB_TEST_MIDI_MISSING'] === '1') {
    return () => {
      throw new Error("Cannot find module 'midi'")
    }
  }
  return undefined
}

// The license this machine holds, read once at startup and written only when the
// operator enters or removes a key. Everything Pro is gated on it from here, in the
// process that owns the sockets: a window can explain a lock, but only this can be one.
const license = createLicenseManager({
  filePath: path.join(app.getPath('userData'), 'license.key'),
  publicKeys: trustedPublicKeys(app.isPackaged, process.env)
})

// The last settings the window sent. Kept so a key entered mid-session can start the
// services the operator had configured, without waiting for the window to re-send them.
let lastShowSettings: ShowSettings = defaultShowSettings()
// Whether the window has ever sent them. Until it has, the defaults above are a guess
// made so a console that is already talking at launch is heard; they are not the show,
// and starting services on them when a key arrives would bind a port this workspace
// does not use.
let settingsReceived = false

const PRO_REQUIRED = 'WinsLab Pro is required for the show services'

// One batch, every window that is still alive. A window that is mid-reload has no
// listener yet; it catches up from the snapshot it asks for on startup. A window whose
// renderer was killed is the case that matters here: the show keeps running in this
// process, so engine events keep arriving for a window that is not there, and sending to
// it throws rather than being skipped.
function broadcastToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) sendToWindow(win, channel, payload)
}

function broadcastShowEvents(events: ShowEvent[]): void {
  broadcastToWindows('show:events', events)
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
    const binding = panicFromShowEvent(event)
    if (binding) playbackSafety.panic(binding.source, binding.reason)
  }
})

/**
 * A license that changes takes the show services with it: entering a key starts what
 * the window had configured, and removing one stops every socket and poller. The
 * window is told as well, so the panels it draws follow the same fact.
 *
 * A key entered before the window has sent its settings starts nothing: the window
 * re-sends them the moment it sees the license, and starting the defaults first would
 * bind a port on a machine that may not use one.
 */
license.subscribe((status: LicenseStatus) => {
  for (const win of BrowserWindow.getAllWindows()) sendToWindow(win, 'license:changed', status)
  if (!isPro(status)) {
    void show.suspend()
    return
  }
  if (settingsReceived) void show.configure(lastShowSettings)
})

function getWin(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(event.sender)!
}

export function registerIpcHandlers(): void {
  // OSC keeps a socket open per destination, so the process has to let go of them.
  app.on('before-quit', () => osc.close())
  // A request in flight must not outlive the window that asked for it.
  app.on('before-quit', () => network.close())
  app.on('before-quit', () => clearTimeout(audioEventFlush ?? undefined))
  // The services hold sockets and poll timers of their own.
  app.on('before-quit', () => show.close())

  // The services come up with the defaults, before the window has finished loading:
  // a console that is already sending when the operator launches the app should not
  // have its first cues fall on the floor. The renderer re-sends its own settings —
  // which may come from the workspace — as soon as it has them. Nothing starts without
  // a license: the show services are the Pro half of the app.
  if (isPro(license.status())) void show.configure(defaultShowSettings())

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

  ipcMain.handle('audio:pickFile', async (event) => {
    const result = await dialog.showOpenDialog(getWin(event), {
      title: 'Select Audio File',
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aiff'] },
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
    audioVerb(() => audioEngine.release(payload.cueId, payload.whenMs)))
  ipcMain.handle(AUDIO_CHANNELS.cancel, (_, payload: AudioCancelPayload) =>
    audioVerb(() => audioEngine.cancel(payload.cueId, payload.whenMs)))
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
    audioVerb(() => audioEngine.waveform(payload.filePath, payload.points)))
  // A workspace footprint asks about every cue: headers only, nothing decoded, nothing
  // cached, nothing counted.
  ipcMain.handle(AUDIO_CHANNELS.onsets, (_, payload: AudioOnsetsPayload) =>
    audioVerb(() => audioEngine.onsets(payload.filePath, payload.sensitivity, payload.maxOnsets)))
  ipcMain.handle(AUDIO_CHANNELS.probe, (_, payload: AudioProbePayload) =>
    audioVerb(() => audioEngine.probe(payload.filePath)))

  // Every engine event is both forwarded to the window and kept for the safety net: a
  // burst — a panic stopping twenty voices at once — is one message rather than twenty,
  // and the last few are held so the acceptance tests can read what the engine said.
  audioEngine.subscribe(event => {
    noteEngineEvents([event])
    queueAudioEvents(event)
  })

  // MIDI
  ipcMain.handle('midi:listPorts', () => midi.listOutputPorts())
  ipcMain.handle('midi:listInputPorts', () => midi.listInputPorts())

  // Whether MIDI can work at all in this build. A machine without the optional native
  // module has to be able to say so, or a cue that reaches nothing looks like one that
  // worked.
  ipcMain.handle('midi:status', () => midi.status())

  // Both return what the engine did, so a cue that reached nothing is reported rather
  // than looking like every other successful firing.
  ipcMain.handle('midi:send', async (_, cmd: { portName: string; messages: any[] }) => {
    return midi.send(cmd.portName, cmd.messages)
  })

  // OSC
  ipcMain.handle('osc:send', async (_, cmd: { host: string; port: number; address: string; args: any[] }) => {
    return osc.send(cmd.host, cmd.port, cmd.address, cmd.args)
  })

  // Network cues. No license gate: network cues shipped in the free half of the app, and
  // this is the same cue making the same request from a process the page's origin does
  // not apply to. A console on the LAN does not send CORS headers, and the request has
  // to outlive a busy or reloaded window.
  ipcMain.handle('network:request', async (_, request: NetworkRequest) => network.request(request))
  ipcMain.handle('network:cancel', async (_, requestId: string) => network.cancel(requestId))

  // The renderer is alive and the show still has someone at the wheel. The watchdog
  // silences the engine when these stop arriving while anything is playing, so the
  // renderer sends one on its own timer whether or not a cue is running.
  ipcMain.handle('playback:heartbeat', () => {
    playbackSafety.noteHeartbeat()
  })

  // Show services. The renderer never talks to a service directly: it configures the
  // set, reads a snapshot, and sends a command to one by id, so a service can be added
  // without a new IPC channel.
  ipcMain.handle('show:snapshot', async () => {
    // A locked app has services registered and none of them started, so this is the
    // truth: nothing is listening.
    return show.snapshot()
  })

  // Failures the main process reported before the window was listening. The renderer
  // takes them on startup so a broken launch is explained rather than silent.
  ipcMain.handle('app:drainMainErrors', () => drainMainErrors())

  ipcMain.handle('show:configure', async (_, settings: ShowSettings) => {
    lastShowSettings = settings
    settingsReceived = true
    if (!isPro(license.status())) {
      await show.suspend()
      return
    }
    await show.configure(settings)
  })

  ipcMain.handle('show:command', async (_, cmd: { service: string; action: string; payload?: unknown }) => {
    if (!isPro(license.status())) return { ok: false, error: PRO_REQUIRED }
    return show.command(cmd.service, cmd.action, cmd.payload)
  })

  ipcMain.handle('show:restart', async (_, service: string) => {
    if (!isPro(license.status())) return { ok: false, error: PRO_REQUIRED }
    return show.restart(service)
  })

  // License. The window reads the status, asks for a key to be checked, and is told
  // when it changes — including the change it asked for.
  ipcMain.handle('license:status', () => license.status())
  ipcMain.handle('license:activate', (_, text: string) => license.activate(text))
  ipcMain.handle('license:deactivate', () => license.deactivate())

  // Script
  // include() resolves against the file that is doing the including, or the workspace
  // directory for the script body itself; the resolved path goes back so the file's own
  // includes can be resolved against it.
  ipcMain.handle('script:readFile', async (
    _,
    relativePath: string,
    workspacePath: string | null,
    base?: string
  ) => {
    const from = base !== undefined
      ? path.dirname(base)
      : workspacePath !== null
        ? path.dirname(workspacePath)
        : process.cwd()
    const resolved = path.isAbsolute(relativePath) ? relativePath : path.resolve(from, relativePath)
    return { code: await readFile(resolved, 'utf-8'), path: resolved }
  })

  // The script panel's reader. It refuses what it cannot show — a binary file, or a
  // document far larger than any script — because rendering one is what took the
  // window's process to 3 GB and stopped the interface answering. The panel itself is
  // Pro, so a locked app is refused here as well as in the window. Script *cues* read
  // their includes through `script:readFile` above, which stays free.
  ipcMain.handle('script:readDocument', async (_, filePath: string, workspacePath: string | null) => {
    if (!isPro(license.status())) {
      return { ok: false, error: 'The script panel is part of WinsLab Pro.' }
    }
    return loadScriptDocument(filePath, workspacePath)
  })

  // The script panel reads the document the same way a script cue reads its includes.
  ipcMain.handle('script:pickFile', async (event) => {
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
    'script:shell',
    async (
      _,
      command: string,
      options: { timeout?: number; cwd?: string; env?: Record<string, string> }
    ): Promise<{ stdout: string; stderr: string; code: number | null; signal: string | null }> => {
      const timeout = options.timeout ?? 10000
      // If cwd is a file path (e.g. workspace file), resolve to its directory
      const cwd = options.cwd
        ? path.extname(options.cwd) ? path.dirname(options.cwd) : options.cwd
        : process.cwd()
      const env = { ...process.env, ...options.env }

      return new Promise(resolve => {
        const child = exec(command, { cwd, env, timeout, killSignal: 'SIGTERM' })

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
      })
    }
  )

  // Workspace. Opening, recovering and relinking all resolve the media an audio cue
  // points at, because a workspace that came from another machine has paths that only
  // mean something there; the result carries what is missing so the window can offer to
  // find it rather than firing a cue at a file that is not there.
  ipcMain.handle('workspace:open', async (event) => {
    return openWorkspace(getWin(event))
  })

  ipcMain.handle('workspace:openPath', async (_, filePath: string) => {
    return openWorkspaceFromPath(filePath)
  })

  ipcMain.handle('workspace:openDemo', async () => {
    return openDemoWorkspace()
  })

  ipcMain.handle('workspace:relink', async (
    event,
    workspace: Workspace,
    workspacePath: string | null,
    cueId: string
  ) => {
    return relinkWorkspaceMedia(getWin(event), workspace, workspacePath, cueId)
  })

  ipcMain.handle('workspace:save', async (event, workspace: Workspace, existingPath: string | null) => {
    return saveWorkspace(getWin(event), workspace, existingPath)
  })

  ipcMain.handle('workspace:saveAs', async (event, workspace: Workspace) => {
    return saveWorkspaceAs(getWin(event), workspace)
  })

  ipcMain.handle('workspace:recent', async () => {
    return getRecentFiles()
  })

  // Autosave goes to the recovery snapshot, never over the operator's file. The cue the
  // session is standing on goes with it, so a recovered show hands back the place as
  // well as the cues.
  ipcMain.handle(
    'workspace:autosave',
    async (_, workspace: Workspace, sourcePath: string | null, selectedCueId: string | null = null) => {
      await writeRecovery(workspace, sourcePath, selectedCueId)
    }
  )

  ipcMain.handle('workspace:recovery', async () => {
    // Recovery resolves the media in the snapshot the same way opening a file does; its
    // directory is what a relative path in the snapshot is relative to.
    return openRecovery()
  })

  ipcMain.handle('workspace:clearRecovery', async () => {
    await clearRecovery()
  })

  ipcMain.handle('workspace:setTitle', async (event, title: string) => {
    // The window can be gone by the time this arrives: the kill tests stop the renderer
    // while the main process keeps running the show, and the title update that was in
    // flight then has nowhere to land. Doing nothing is the correct behaviour, and it is
    // the difference between a title and an exception in the log.
    const win = BrowserWindow.fromWebContents(event.sender)
    if (liveWindow(win)) win.setTitle(title)
  })

  ipcMain.handle('workspace:confirmClose', async (event, workspaceName: string) => {
    const result = await dialog.showMessageBox(getWin(event), {
      type: 'question',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Do you want to save changes to "${workspaceName}"?`,
      detail: 'Your changes will be lost if you don\'t save them.'
    })
    return result.response // 0=save, 1=don't save, 2=cancel
  })
}
