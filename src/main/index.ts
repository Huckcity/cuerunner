import { app, BrowserWindow, shell, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/handlers'

// The last renderer crash, handed to the reloaded renderer so it can say what happened.
// One shot: the renderer reads it on startup, and it is cleared.
let rendererCrash: { reason: string; at: number } | null = null

// Measured on Electron 41 / macOS: reloading a webContents whose renderer was just
// killed takes the whole browser process down with it, because the dead renderer's
// teardown is still running when render-process-gone fires. Waiting for it to finish
// recovers in place; the window keeps its size and position.
const RENDERER_RESTART_DELAY_MS = 500

// A packaged build has no visible console and no crash reporter, so main-process
// failures go to stdout and into the session log via the renderer.
function reportMainError(message: string): void {
  console.error(message)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('app:main-error', message)
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`
  return String(error)
}

// Without these, Node's default for an uncaught exception is to take the process down
// with it. A dead main process loses the show just as completely as a dead renderer.
process.on('uncaughtException', (error) => {
  reportMainError(`[main] uncaught exception: ${describeError(error)}`)
})
process.on('unhandledRejection', (reason) => {
  reportMainError(`[main] unhandled rejection: ${describeError(reason)}`)
})

// Menu accelerators swallow the keystroke before the renderer sees it, so the
// renderer decides whether the action belongs to a focused text field or to the
// cue history. A programmatic click from a test has no focused window, hence the
// fallback to the first open window.
function sendMenuAction(action: 'undo' | 'redo'): void {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  target?.webContents.send('app:menu-action', action)
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'WinsLab',
      submenu: [
        {
          label: `About WinsLab`,
          click: () => {
            app.showAboutPanel()
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          id: 'edit-undo',
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendMenuAction('undo')
        },
        {
          id: 'edit-redo',
          label: 'Redo',
          accelerator: 'Shift+CmdOrCtrl+Z',
          click: () => sendMenuAction('redo')
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'WinsLab',
    backgroundColor: '#181818',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Intercept close and ask the renderer to run the dirty check.
  // The renderer calls app:confirm-close when it's safe to proceed.
  let allowClose = false
  // True between a renderer crash and the reload finishing. A dead renderer can never
  // answer the dirty check, so closing must not be gated on it.
  let rendererDead = false
  win.on('close', (event) => {
    if (allowClose || rendererDead) return
    event.preventDefault()
    win.webContents.send('app:close-requested')
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    rendererDead = true
    rendererCrash = { reason: details.reason, at: Date.now() }
    reportMainError(`[main] renderer stopped: ${details.reason} (exit code ${details.exitCode})`)
    // The show state lives in the renderer, so there is nothing to restore. A reloaded
    // window plus the CrashNotice banner beats a blank one that cannot be closed.
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload()
    }, RENDERER_RESTART_DELAY_MS)
  })

  win.webContents.on('did-finish-load', () => { rendererDead = false })

  win.webContents.on('unresponsive', () => reportMainError('[main] renderer unresponsive'))
  win.webContents.on('responsive', () => reportMainError('[main] renderer responsive again'))

  ipcMain.removeHandler('app:confirm-close')
  ipcMain.handle('app:confirm-close', () => {
    allowClose = true
    win.close()
  })

  ipcMain.removeHandler('app:renderer-crash')
  ipcMain.handle('app:renderer-crash', () => {
    const crash = rendererCrash
    rendererCrash = null
    return crash
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.on('console-message', (_, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.winslab')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // GPU and utility processes are Chromium's to restart; the renderer is covered
  // above. Either way the operator should be able to read that it happened.
  app.on('child-process-gone', (_event, details) => {
    if (details.type === 'Renderer') return
    reportMainError(`[main] ${details.type} process gone: ${details.reason}`)
  })
  
  // Set up about panel with current version
  app.setAboutPanelOptions({
    applicationName: 'WinsLab',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026'
  })
  
  createMenu()
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
