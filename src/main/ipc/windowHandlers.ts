// The two channels the window itself answers, in a module that does not need a window.
//
// `app:confirm-close` and `app:renderer-crash` belong to the window they are about: the
// first closes that window, and the second hands back the crash its reload left behind.
// They are registered while a window is created for that reason — and registering them
// from here, with the window and their state handed in, is what lets a test register and
// count them without booting Electron.
//
// They are not per-window registrations, whatever their names suggest: `ipcMain` holds one
// handler per channel for the whole process, so a second call replaces the first's, and
// both windows' invokes would then land in the newcomer's closures. One window at a time is
// what keeps that harmless — `index.ts` creates a window only when none is open — and the
// removal below is what keeps the second registration from being refused as a duplicate,
// not what makes it per-window.

import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { APP_CHANNELS, type RendererCrash } from '../../shared/ipc/app'

/** What the registrations need from whoever owns the window and the crash. */
export interface WindowHandlerDeps {
  /** The window ran its dirty check and says closing is safe. */
  allowClose(): void
  /** The last renderer crash, read once: returned and cleared. */
  takeRendererCrash(): RendererCrash | null
}

/**
 * Registers the two handlers `win` answers, replacing whatever was registered for those
 * channels before — the channels are process-wide, and the file comment says why one
 * window at a time is what makes the replacement safe.
 */
export function registerWindowIpcHandlers(win: BrowserWindow, deps: WindowHandlerDeps): void {
  ipcMain.removeHandler(APP_CHANNELS.confirmClose)
  ipcMain.handle(APP_CHANNELS.confirmClose, () => {
    deps.allowClose()
    win.close()
  })

  ipcMain.removeHandler(APP_CHANNELS.rendererCrash)
  ipcMain.handle(APP_CHANNELS.rendererCrash, () => deps.takeRendererCrash())
}
