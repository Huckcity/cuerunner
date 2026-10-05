import { app, BrowserWindow, crashReporter, shell, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/handlers'
import { registerWindowIpcHandlers } from './ipc/windowHandlers'
import { sendToWindow } from './ipc/broadcast'
import { onMainError, reportMainError } from './errors'
import { audioEngine } from './audio/AudioEngine'
import { playbackSafety, recentEngineEvents } from './safety/runtime'
import { installPlaybackDevHarness } from './safety/devHarness'
import { keepAwake, keepAwakeHeld } from './safety/keepAwake'
import { refuseNavigation } from './safety/navigation'
import { FILE_MENU, fileMenuItemId, type MenuAction } from '../shared/fileMenu'
import { APP_CHANNELS, type RendererCrash } from '../shared/ipc/app'

// The last renderer crash, handed to the reloaded renderer so it can say what happened.
// One shot: the renderer reads it on startup, and it is cleared.
let rendererCrash: RendererCrash | null = null

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
  for (const win of BrowserWindow.getAllWindows()) sendToWindow(win, APP_CHANNELS.mainError, message)
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

// Chromium's own crash reporter, kept local: with `uploadToServer: false` it writes a minidump
// beside the profile when a process dies and sends it nowhere. The problem report lists what
// it left, so a crash is something the operator can attach on request — the app still tells
// nobody anything on its own. Started before `ready`, as Electron requires.
crashReporter.start({ uploadToServer: false, compress: true })

// Menu accelerators swallow the keystroke before the renderer sees it, so the
// renderer decides whether the action belongs to a focused text field or to the
// cue history. A programmatic click from a test has no focused window, hence the
// fallback to the first open window.
function sendMenuAction(action: MenuAction): void {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  sendToWindow(target, APP_CHANNELS.menuAction, action)
}

// The File menu is the window's work — every item runs in the renderer, where the show
// is — so each one is a message to it. The list itself is shared with the Cuerunner ▾ button
// in the window, which draws the same items from the same definition.
function fileMenuItems(options: { withSettings: boolean }): Electron.MenuItemConstructorOptions[] {
  return FILE_MENU
    .filter(entry => options.withSettings || entry === 'separator' || entry.action !== 'settings')
    .map((entry): Electron.MenuItemConstructorOptions => entry === 'separator'
      ? { type: 'separator' }
      : {
          id: fileMenuItemId(entry.action),
          label: entry.label,
          accelerator: entry.accelerator,
          click: () => sendMenuAction(entry.action)
        })
    // A list that ends on a separator (Settings taken out, on a Mac) ends on nothing.
    .filter((item, index, items) => !(item.type === 'separator' && index === items.length - 1))
}

function createMenu(): void {
  const mac = process.platform === 'darwin'
  const about: Electron.MenuItemConstructorOptions = {
    label: 'About Cuerunner',
    click: () => app.showAboutPanel()
  }
  // A Mac keeps About, Settings and Quit under the app's own name; Windows and Linux put
  // Settings and Exit in File and About in Help, and have no menu named after the app —
  // which, on a bar drawn in the window, would sit over the Cuerunner ▾ button saying
  // something different.
  const settings = FILE_MENU.find(entry => entry !== 'separator' && entry.action === 'settings')
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(mac
      ? [{
          label: 'Cuerunner',
          submenu: [
            about,
            { type: 'separator' as const },
            ...(settings && settings !== 'separator'
              ? [{
                  id: fileMenuItemId('settings'),
                  label: settings.label,
                  accelerator: settings.accelerator,
                  click: () => sendMenuAction('settings')
                }]
              : []),
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        ...fileMenuItems({ withSettings: !mac }),
        ...(mac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: 'Exit' }])
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
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
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
    },
    ...(mac ? [] : [{ label: 'Help', submenu: [about] }])
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // The toolbar is one row of controls that do not wrap, and the rightmost of them —
    // the Cues/Scenes switch — is the one an operator reaches for to run the show. At
    // 800 it fell off the edge and was clipped by the window, which clips rather than
    // scrolls.
    minWidth: 1000,
    minHeight: 500,
    title: 'Cuerunner',
    backgroundColor: '#181818',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer is sandboxed: it has no Node, and neither does its preload beyond the
      // bridge it is there to build. The preload asks for `electron` and nothing else, which
      // is all a sandboxed one may ask for, so this costs the app nothing it uses.
      sandbox: true,
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
    sendToWindow(win, APP_CHANNELS.closeRequested)
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

  registerWindowIpcHandlers(win, {
    allowClose: () => {
      allowClose = true
    },
    takeRendererCrash: () => {
      const crash = rendererCrash
      rendererCrash = null
      return crash
    }
  })

  win.on('ready-to-show', () => win.show())

  // The event object, not the deprecated positional arguments: Electron logs a deprecation
  // warning for the old form on every message, which on a full E2E run is a hundred and
  // forty lines of the Windows log that say nothing about the app.
  win.webContents.on('console-message', details => {
    if (details.level === 'warning' || details.level === 'error') {
      console.error(`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`)
    }
  })

  // The window stays on the app: a file dropped where the page does not take it would
  // otherwise be opened in place of the show. navigation.ts carries the why.
  refuseNavigation(win.webContents)

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
  electronApp.setAppUserModelId('app.cuerunner')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // GPU and utility processes are Chromium's to restart, and they do not come through
  // render-process-gone; either way the operator should be able to read that it happened.
  app.on('child-process-gone', (_event, details) => {
    reportMainError(`[main] ${details.type} process gone: ${details.reason}`)
  })
  
  // Set up about panel with current version
  app.setAboutPanelOptions({
    applicationName: 'Cuerunner',
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
      kill: () => audioEngine.crashForTest(),
      simulateDeviceLoss: () => audioEngine.simulateDeviceLossForTest()
    }
  })
  // A quit the renderer cancels must keep its audio: File→Exit on a dirty workspace
  // runs the unsaved-changes prompt after `before-quit`, so no engine teardown runs
  // there at all — even the graceful verb exits the engine (`stopping_` + client drop;
  // `serve()` returns and `stop()` runs), and a cancelled quit would still stop the
  // show. `will-quit` runs past the point a quit can still be cancelled, and teardown
  // is synchronous there because Electron will not wait for async work that late:
  // SIGTERM drives the engine's own signal handler through the graceful path, and the
  // kill guarantees no orphan holds the device.
  app.on('will-quit', () => {
    playbackSafety.close()
    audioEngine.forceShutdown()
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // The window-less application is macOS's own convention and this guard is where the
  // decision to keep it lives, not a defect to be filed: a quit the unsaved-changes prompt
  // interrupts closes the window here without ever reaching `will-quit`, and the app is left
  // running in the Dock with nothing to do — which is what macOS does with every
  // application whose last window closes. Resuming that quit is deliberately not built;
  // `e2e/show-monitor.spec.ts` asserts each platform's own outcome rather than accepting
  // either, so the difference is stated where it is read.
  if (process.platform !== 'darwin') app.quit()
})
