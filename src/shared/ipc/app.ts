// The window's own lifecycle, and the one namespace that is not about the show: whether
// it is safe to close, what the File menu asked it to do, and what went wrong out here.
//
// Two of the handlers are registered per window rather than in the handler table —
// `app:confirm-close` and `app:renderer-crash` have to be answered by the window they are
// about — so this file names the channels for both places rather than owning them.

import type { MenuAction } from '../fileMenu'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const APP_CHANNELS = {
  /** Main is asking to close; the window answers on `confirmClose` when it is safe. */
  closeRequested: 'app:close-requested',
  /** A File-menu item, sent to the window because the show it acts on lives there. */
  menuAction: 'app:menu-action',
  /** A failure in the main process, pushed so the window can put it on screen. */
  mainError: 'app:main-error',
  /** The window says the dirty check is done and main may close it. */
  confirmClose: 'app:confirm-close',
  rendererCrash: 'app:renderer-crash',
  /** Failures main reported before the window was listening. */
  drainMainErrors: 'app:drainMainErrors'
} as const

/** The last renderer crash, kept by main and handed to the window that reloaded after it. */
export interface RendererCrash {
  reason: string
  at: number
}

/** The window lifecycle, as the renderer reads it (`window.cuerunner.app`). */
export interface AppBridge {
  onCloseRequested(callback: () => void): () => void
  onMenuAction(callback: (action: MenuAction) => void): () => void
  /** Answers `closeRequested`; main closes the window once it has been called. */
  confirmClose(): Promise<void>
  /** One shot: the window reads the crash it reloaded from, and main clears it. */
  rendererCrash(): Promise<RendererCrash | null>
  onMainError(callback: (message: string) => void): () => void
  drainMainErrors(): Promise<string[]>
}
