// Updates: whether there is a newer Cuerunner, getting it, and putting it in — each one the
// operator's own decision, and each one refused while the show is running. The window reports
// the show's state as it changes, because the show lives in the window; main runs the updater
// and decides, and every "no" is a refusal arm said where main detected it: the show is busy,
// checks are locked out, this copy cannot replace itself, or the download did not match what
// its release published. Only a fault rejects.
//
// "What's new" is one shot, like the renderer crash: the window takes the notes of the versions
// installed since this machine last ran, and main forgets them, so they are shown once.

import type { Refusal } from './refusal'
import type { ReleaseSection } from '../releaseNotes'
import type { UpdateSettings, UpdateShowState, UpdateStatus } from '../update'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const UPDATE_CHANNELS = {
  status: 'update:status',
  /** A check the operator asked for. */
  check: 'update:check',
  download: 'update:download',
  /** Quits and installs a downloaded update: the operator's restart. */
  install: 'update:install',
  configure: 'update:configure',
  /** The window's report of the show: busy, in Show Mode, a file open. */
  report: 'update:report',
  /** One shot: the notes of the versions installed since this machine last ran. */
  whatsNew: 'update:whatsNew',
  /** Opens the download page, for a copy that cannot replace itself. */
  openDownloads: 'update:openDownloads',
  /** Main pushes UpdateStatus here; preload subscribes with `onEvents`. */
  events: 'update:events'
} as const

/** What a check came to: the status it left behind, or why it did not run. */
export type UpdateCheckResult = Refusal | { ok: true; status: UpdateStatus }

/** A download or an install that started, or why it did not. */
export type UpdateActionResult = Refusal | { ok: true }

/** The versions installed since this machine last ran, newest first. */
export interface WhatsNew {
  /** The version running now. */
  version: string
  /** The version this machine ran before. */
  previous: string
  sections: ReleaseSection[]
}

/** Updates, as the renderer reads them (`window.cuerunner.update`). */
export interface UpdateBridge {
  status(): Promise<UpdateStatus>
  check(): Promise<UpdateCheckResult>
  download(): Promise<UpdateActionResult>
  install(): Promise<UpdateActionResult>
  configure(patch: Partial<UpdateSettings>): Promise<UpdateStatus>
  /** Fire and forget: the show's state, sent whenever it changes. */
  report(state: UpdateShowState): void
  /** One shot: null when there is nothing new, or once it has been taken. */
  whatsNew(): Promise<WhatsNew | null>
  openDownloads(): Promise<void>
  onEvents(callback: (status: UpdateStatus) => void): () => void
}
