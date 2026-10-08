// The window's own lifecycle, and the one namespace that is not about the show: whether
// it is safe to close, what the File menu asked it to do, and what went wrong out here.
//
// Two of the handlers are registered per window rather than in the handler table —
// `app:confirm-close` and `app:renderer-crash` have to be answered by the window they are
// about — so this file names the channels for both places rather than owning them.

import type { MenuAction } from '../fileMenu'
import type { Refusal } from './refusal'

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
  drainMainErrors: 'app:drainMainErrors',
  /** The problem report as text: what the operator wrote, the log, and what main knows. */
  composeReport: 'app:compose-report',
  /** The composed report, written to a file the operator names. */
  saveReport: 'app:save-report',
  /** The composed report onto the clipboard, and a message to the support address opened. */
  emailReport: 'app:email-report',
  /** Lines of the session log, for the file on disk that outlives the window. */
  writeLog: 'app:write-log',
  /** The folder that file is in, opened in the file manager. */
  openLogs: 'app:open-logs'
} as const

/** The last renderer crash, kept by main and handed to the window that reloaded after it. */
export interface RendererCrash {
  reason: string
  at: number
}

/** What the window knows that main does not: the operator's words and the session log. */
export interface ReportInput {
  description: string
  /** The session log as lines, oldest first. Main keeps the tail and bounds each line. */
  log: string[]
}

/** Where a saved report went; `path` is `null` when the operator cancelled the dialog. */
export type ReportSaveResult = Refusal | { ok: true; path: string | null }

/** The report is on the clipboard and the mail program has been asked to open. */
export type ReportEmailResult = Refusal | { ok: true }

/** Where the logs folder is, once it has been opened; a refusal says why it could not be. */
export type LogsOpenResult = Refusal | { ok: true; path: string }

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
  /** The whole report as text, home folder redacted. The window shows this text and hands
   *  the same text back to the two verbs below, so what leaves is what was read. */
  composeReport(input: ReportInput): Promise<string>
  /** Writes `text` where the operator says; nothing is sent anywhere. */
  saveReport(text: string): Promise<ReportSaveResult>
  /** Puts `text` on the clipboard and opens a message to the support address beside it. */
  emailReport(text: string): Promise<ReportEmailResult>
  /** Appends lines to the log file on disk. Bounded in main; never refuses, never rejects. */
  writeLog(lines: string[]): Promise<void>
  /** Opens the folder the log file is in. */
  openLogs(): Promise<LogsOpenResult>
}
