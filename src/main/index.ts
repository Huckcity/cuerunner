import { app, BrowserWindow, shell, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/handlers'
import { onMainError, reportMainError } from './errors'
import { audioEngine } from './audio/AudioEngine'
import { playbackSafety, recentEngineEvents } from './safety/runtime'
import { installPlaybackDevHarness } from './safety/devHarness'
import { keepAwake, keepAwakeHeld } from './safety/keepAwake'

// The last renderer crash, handed to the reloaded renderer so it can say what happened.
// One shot: the renderer reads it on startup, and it is cleared.
let rendererCrash: { reason: string; at: number } | null = null

// Measured on Electron 41 / macOS: reloading a webContents whose renderer was just
// killed takes the whole browser process down with it, because the dead renderer's
// teardown is still running when render-process-gone fires. Waiting for it to finish
// recovers in place; the window keeps its size and position.
const RENDERER_RESTART_DELAY_MS = 500

// A packaged build has no visible console and no crash reporter, so main-process
// failures go to stdout and into the session log via the renderer. errors.ts keeps them
// until a window is listening: the window subscribes a moment after it loads, and a
// failure during startup would otherwise be pushed to nobody.
onMainError(message => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('app:main-error', message)
    }
  }
})

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
    },
    {
      // Panic, from the menu, without the renderer: this is the shortcut that still
      // works when the window is wedged, dead, or busy showing something. It silences
      // the native engine directly and then tells whatever renderer is left to drop its
      // pending cues.
      label: 'Playback',
      submenu: [
        {
          id: 'playback-panic',
          label: 'Panic — Silence Everything',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => playbackSafety.panic('menu', 'Panic from the application menu')
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
      sandbox: false,
      // The cue stack is timers and the audio clock, and both have to keep running when
      // the window is not on screen. Chromium throttles backgrounded windows down to
      // about one timer a minute, which turns a three-second wait into a stalled show
      // the moment the operator minimizes the window and walks to the desk.
      backgroundThrottling: false
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
    // Before the window is brought back: the engine keeps playing whatever it was told
    // to, and the only thing that could have stopped it just died.
    playbackSafety.noteRendererGone(details.reason)
    // The show state lives in the renderer, so there is nothing to restore. A reloaded
    // window plus the CrashNotice banner beats a blank one that cannot be closed.
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload()
    }, RENDERER_RESTART_DELAY_MS)
  })

  win.webContents.on('did-finish-load', () => { rendererDead = false })

  win.webContents.on('unresponsive', () => {
    reportMainError('[main] renderer unresponsive')
    // A window that has stopped answering cannot be running its cue stack either: if
    // the engine is still playing, the renderer is no longer in a position to stop it.
    playbackSafety.noteRendererUnresponsive()
  })
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
  // Before anything that runs on a timer: a napped app dispatches its cues late, which
  // on stage is a wait that takes twice as long as it says. keepAwake.ts carries the why.
  keepAwake()
  electronApp.setAppUserModelId('com.winslab')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // GPU and utility processes are Chromium's to restart, and they do not come through
  // render-process-gone; either way the operator should be able to read that it happened.
  app.on('child-process-gone', (_event, details) => {
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
  // The engine comes up with the app rather than with the first cue, so a device that
  // cannot be opened is a visible error at launch instead of a cue that does nothing.
  void audioEngine.ensureStarted().catch((error: unknown) => {
    reportMainError(`[main] audio engine did not start: ${String(error)}`)
  })
  // The safety net is what panics when the window cannot; the harness is how the
  // end-to-end suite reads what it did from this process rather than from the page.
  installPlaybackDevHarness({
    safety: playbackSafety,
    keepAwakeHeld,
    engine: {
      info: () => audioEngine.info(),
      recentEvents: recentEngineEvents,
      status: () => audioEngine.status(),
      kill: () => audioEngine.crashForTest()
    }
  })
  app.on('before-quit', () => playbackSafety.close())
  // The engine owns a child process; quitting without asking it to go leaves that child
  // behind, which in a test run means an orphan holding the audio device.
  app.on('before-quit', () => {
    void audioEngine.shutdown().catch((error: unknown) => {
      reportMainError(`[main] audio engine did not shut down cleanly: ${String(error)}`)
    })
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
