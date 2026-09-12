import { app, ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import { exec } from 'child_process'
import * as path from 'path'
import { MidiEngine } from '../midi/MidiEngine'
import { OscEngine } from '../osc/OscEngine'
import {
  openWorkspace,
  openWorkspaceFromPath,
  saveWorkspace,
  saveWorkspaceAs,
  getRecentFiles
} from '../workspace/WorkspaceManager'
import { clearRecovery, readRecovery, writeRecovery } from '../workspace/recovery'
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

const midi = new MidiEngine()
const osc = new OscEngine()
const show = createShowRuntime()

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

const PRO_REQUIRED = 'WinsLab Pro is required for the show services'

// One batch, every window that is still alive. A window that is mid-reload has no
// listener yet; it catches up from the snapshot it asks for on startup.
function broadcastShowEvents(events: ShowEvent[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('show:events', events)
    }
  }
}

show.subscribe(broadcastShowEvents)

/**
 * A license that changes takes the show services with it: entering a key starts what
 * the window had configured, and removing one stops every socket and poller. The
 * window is told as well, so the panels it draws follow the same fact.
 */
license.subscribe((status: LicenseStatus) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('license:changed', status)
    }
  }
  void (isPro(status) ? show.configure(lastShowSettings) : show.suspend())
})

function getWin(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(event.sender)!
}

export function registerIpcHandlers(): void {
  // OSC keeps a socket open per destination, so the process has to let go of them.
  app.on('before-quit', () => osc.close())
  // The services hold sockets and poll timers of their own.
  app.on('before-quit', () => show.close())

  // The services come up with the defaults, before the window has finished loading:
  // a console that is already sending when the operator launches the app should not
  // have its first cues fall on the floor. The renderer re-sends its own settings —
  // which may come from the workspace — as soon as it has them. Nothing starts without
  // a license: the show services are the Pro half of the app.
  if (isPro(license.status())) void show.configure(defaultShowSettings())

  // Audio
  ipcMain.handle('audio:readFile', async (_, filePath: string) => {
    const buf = await readFile(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

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

  // MIDI
  ipcMain.handle('midi:listPorts', () => midi.listOutputPorts())
  ipcMain.handle('midi:listInputPorts', () => midi.listInputPorts())

  // Both return what the engine did, so a cue that reached nothing is reported rather
  // than looking like every other successful firing.
  ipcMain.handle('midi:send', async (_, cmd: { portName: string; messages: any[] }) => {
    return midi.send(cmd.portName, cmd.messages)
  })

  // OSC
  ipcMain.handle('osc:send', async (_, cmd: { host: string; port: number; address: string; args: any[] }) => {
    return osc.send(cmd.host, cmd.port, cmd.address, cmd.args)
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

  // Workspace
  ipcMain.handle('workspace:open', async (event) => {
    return openWorkspace(getWin(event))
  })

  ipcMain.handle('workspace:openPath', async (_, filePath: string) => {
    return openWorkspaceFromPath(filePath)
  })

  ipcMain.handle('workspace:openDemo', async () => {
    return openDemoWorkspace()
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

  // Autosave goes to the recovery snapshot, never over the operator's file.
  ipcMain.handle('workspace:autosave', async (_, workspace: Workspace, sourcePath: string | null) => {
    await writeRecovery(workspace, sourcePath)
  })

  ipcMain.handle('workspace:recovery', async () => {
    return readRecovery()
  })

  ipcMain.handle('workspace:clearRecovery', async () => {
    await clearRecovery()
  })

  ipcMain.handle('workspace:setTitle', async (event, title: string) => {
    getWin(event).setTitle(title)
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
