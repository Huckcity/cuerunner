import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Workspace } from '../renderer/src/types/workspace'
import type { ShowEvent, ShowSettings, ShowSnapshot } from '../renderer/src/types/show'

contextBridge.exposeInMainWorld('winslab', {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  app: {
    onCloseRequested: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:close-requested', listener)
      return () => ipcRenderer.off('app:close-requested', listener)
    },
    onMenuAction: (callback: (action: 'undo' | 'redo') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, action: 'undo' | 'redo'): void =>
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
  audio: {
    readFile: (filePath: string): Promise<ArrayBuffer> =>
      ipcRenderer.invoke('audio:readFile', filePath),
    pickFile: (): Promise<string | null> =>
      ipcRenderer.invoke('audio:pickFile')
  },
  midi: {
    listPorts: (): Promise<string[]> =>
      ipcRenderer.invoke('midi:listPorts'),
    listInputPorts: (): Promise<string[]> =>
      ipcRenderer.invoke('midi:listInputPorts'),
    send: (cmd: { portName: string; messages: any[] }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('midi:send', cmd)
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
  script: {
    readFile: (
      relativePath: string,
      workspacePath: string | null,
      base?: string
    ): Promise<{ code: string; path: string }> =>
      ipcRenderer.invoke('script:readFile', relativePath, workspacePath, base),
    shell: (
      command: string,
      options?: { timeout?: number; cwd?: string; env?: Record<string, string> }
    ): Promise<{ stdout: string; stderr: string; code: number | null; signal: string | null }> =>
      ipcRenderer.invoke('script:shell', command, options ?? {})
  },
  workspace: {
    open: (): Promise<{ path: string; workspace: Workspace } | null> =>
      ipcRenderer.invoke('workspace:open'),
    openPath: (filePath: string): Promise<{ path: string; workspace: Workspace }> =>
      ipcRenderer.invoke('workspace:openPath', filePath),
    openDemo: (): Promise<Workspace> =>
      ipcRenderer.invoke('workspace:openDemo'),
    save: (workspace: Workspace, existingPath: string | null): Promise<string | null> =>
      ipcRenderer.invoke('workspace:save', workspace, existingPath),
    saveAs: (workspace: Workspace): Promise<string | null> =>
      ipcRenderer.invoke('workspace:saveAs', workspace),
    recent: (): Promise<string[]> =>
      ipcRenderer.invoke('workspace:recent'),
    autosave: (workspace: Workspace, sourcePath: string | null): Promise<void> =>
      ipcRenderer.invoke('workspace:autosave', workspace, sourcePath),
    recovery: (): Promise<{ workspace: Workspace; savedAt: number; sourcePath: string | null } | null> =>
      ipcRenderer.invoke('workspace:recovery'),
    clearRecovery: (): Promise<void> =>
      ipcRenderer.invoke('workspace:clearRecovery'),
    setTitle: (title: string): Promise<void> =>
      ipcRenderer.invoke('workspace:setTitle', title),
    confirmClose: (workspaceName: string): Promise<0 | 1 | 2> =>
      ipcRenderer.invoke('workspace:confirmClose', workspaceName)
  }
})
