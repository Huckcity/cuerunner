import type { BrowserWindow } from 'electron'

/**
 * Is there still a window there to receive this?
 *
 * `webContents.send` throws when the renderer has gone — "Render frame was disposed before
 * WebFrameMain could be accessed" — and the kill tests produce exactly that state on
 * purpose, by killing the renderer while the main process keeps running the show. The
 * message was addressed to a window that no longer exists, so skipping it is the whole of
 * the correct behaviour. It also leaves a genuine send failure visible rather than one
 * line among a dozen a run.
 */
export function liveWindow(win: BrowserWindow | null | undefined): win is BrowserWindow {
  if (!win || win.isDestroyed()) return false
  const contents = win.webContents
  return !contents.isDestroyed() && !contents.isCrashed()
}

/** Send, if there is anyone to send to. */
export function sendToWindow(win: BrowserWindow | null | undefined, channel: string, payload?: unknown): void {
  if (!liveWindow(win)) return
  win.webContents.send(channel, payload)
}
