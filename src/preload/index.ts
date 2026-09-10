import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Workspace } from '../renderer/src/types/workspace'

contextBridge.exposeInMainWorld('winslab', {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  app: {
    onCloseRequested: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:close-requested', listener)
      return () => ipcRenderer.off('app:close-requested', listener)
    },
    confirmClose: (): Promise<void> => ipcRenderer.invoke('app:confirm-close')
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
    send: (cmd: { portName: string; messages: any[] }): Promise<void> =>
      ipcRenderer.invoke('midi:send', cmd)
  },
  osc: {
    send: (cmd: { host: string; port: number; address: string; args: any[] }): Promise<void> =>
      ipcRenderer.invoke('osc:send', cmd),
    startListener: (port: number): Promise<void> =>
      ipcRenderer.invoke('osc:startListener', port)
  },
  script: {
    readFile: (relativePath: string, workspacePath: string | null): Promise<string> =>
      ipcRenderer.invoke('script:readFile', relativePath, workspacePath),
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
    save: (workspace: Workspace, existingPath: string | null): Promise<string | null> =>
      ipcRenderer.invoke('workspace:save', workspace, existingPath),
    saveAs: (workspace: Workspace): Promise<string | null> =>
      ipcRenderer.invoke('workspace:saveAs', workspace),
    recent: (): Promise<string[]> =>
      ipcRenderer.invoke('workspace:recent'),
    setTitle: (title: string): Promise<void> =>
      ipcRenderer.invoke('workspace:setTitle', title),
    confirmClose: (workspaceName: string): Promise<0 | 1 | 2> =>
      ipcRenderer.invoke('workspace:confirmClose', workspaceName)
  }
})
