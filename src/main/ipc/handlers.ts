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
import type { Workspace } from '../../renderer/src/types/workspace'

const midi = new MidiEngine()
const osc = new OscEngine()

function getWin(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(event.sender)!
}

export function registerIpcHandlers(): void {
  // OSC keeps a socket open per destination, so the process has to let go of them.
  app.on('before-quit', () => osc.close())

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

  // Both return what the engine did, so a cue that reached nothing is reported rather
  // than looking like every other successful firing.
  ipcMain.handle('midi:send', async (_, cmd: { portName: string; messages: any[] }) => {
    return midi.send(cmd.portName, cmd.messages)
  })

  // OSC
  ipcMain.handle('osc:send', async (_, cmd: { host: string; port: number; address: string; args: any[] }) => {
    return osc.send(cmd.host, cmd.port, cmd.address, cmd.args)
  })

  ipcMain.handle('osc:startListener', async (_, port: number) => {
    osc.startListener(port)
  })

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
