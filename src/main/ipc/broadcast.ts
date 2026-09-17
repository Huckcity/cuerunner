import type { BrowserWindow } from 'electron'
import type { EventChannel } from '../../shared/ipc'

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

/** Send, if there is anyone to send to. The channel is one of the declared events. */
export function sendToWindow(
  win: BrowserWindow | null | undefined,
  channel: EventChannel,
  payload?: unknown
): void {
  if (!liveWindow(win)) return
  try {
    win.webContents.send(channel, payload)
  } catch {
    // The frame can be disposed between the check and the call — a renderer that is killed
    // does exactly that, and the engine keeps producing events for it, because the show
    // does not stop when the window does. A message addressed to a window that is gone has
    // nowhere to land; the renderer's disappearance is reported by the app's own line, so
    // nothing is being swallowed here.
  }
}
