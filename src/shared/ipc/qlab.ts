// A QLab show, brought into Cuerunner: from the workspace file QLab saved, or from a QLab
// that is running on this machine or the network, asked over its own OSC interface.
//
// Main reads the file, opens the socket and shows the dialogs, and hands back a show the
// window has not seen yet together with the account of what became of every QLab cue — the
// report is the point, because a converted show the operator cannot audit is a show nobody
// can run. Every ordinary "no" is a refusal arm, said where it was detected: a file that is
// not a QLab workspace, one too large to read, one that is damaged, a QLab that is not
// there, a passcode it would not take, a QLab that stopped answering. A cancelled dialog is
// the `null` inside the `ok` arm. Only a fault rejects.

import type { Refusal } from './refusal'
import type { CueType } from '../cue'
import type { MissingMedia } from '../media'
import type { LoadNote, Workspace } from '../workspace'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const QLAB_CHANNELS = {
  importFile: 'qlab:importFile',
  listWorkspaces: 'qlab:listWorkspaces',
  importLive: 'qlab:importLive',
  findMedia: 'qlab:findMedia'
} as const

/** QLab's own OSC port, which a running QLab listens on over TCP. */
export const QLAB_OSC_PORT = 53000

/**
 * One kind of QLab cue and one thing it became, with how many cues did. A type that went
 * two ways — most MIDI cues mapped, one pitch bend held — is two rows.
 */
export interface QLabTypeCount {
  /** QLab's own name for the type: "Audio", "Fade", "Video". */
  qlabType: string
  /** The Cuerunner type these became, or null for placeholders: disarmed, with notes saying what they were. */
  becameType: CueType | null
  count: number
}

/** One cue the import has something to say about, in running order. */
export interface QLabImportNote {
  cueId: string
  /** The cue as the operator knows it: its number and name in QLab. */
  number: string
  name: string
  qlabType: string
  /**
   * `placeholder`: Cuerunner has no such cue, so it arrived disarmed with its QLab
   * settings in its notes. `approximated`: it was mapped, and something about it could
   * not be carried exactly — the line says what. `retimed`: it runs at the moment it ran
   * in QLab, but the times are written differently, because Cuerunner counts them from a
   * different place — the line says which fields moved.
   */
  kind: 'placeholder' | 'approximated' | 'retimed'
  detail: string
}

/** What an import made of a QLab show, for the window to put in front of the operator. */
export interface QLabImportReport {
  /** Where the show came from: a workspace file, or a running QLab. */
  source: 'file' | 'live'
  /** The file's path, or "host:port" for a live import. */
  origin: string
  workspaceName: string
  cueLists: number
  /** Every QLab cue that was read, groups included, cue lists not. */
  totalCues: number
  types: QLabTypeCount[]
  notes: QLabImportNote[]
  /** Audio files the show plays: how many cues name one, and how many of those were found. */
  media: { referenced: number; found: number }
}

/** A converted show: the workspace to load, and what the conversion has to say about it. */
export interface QLabImported {
  workspace: Workspace
  missingMedia: MissingMedia[]
  loadNotes: LoadNote[]
  report: QLabImportReport
}

export type QLabImportResult =
  | Refusal
  | { ok: true; imported: QLabImported | null }

/** A workspace a running QLab has open, as its `/workspaces` reply describes it. */
export interface QLabWorkspaceEntry {
  id: string
  name: string
  hasPasscode: boolean
  /** The QLab version that answered, as it says it: "5.4.1". Empty when it does not. */
  version: string
}

export type QLabWorkspacesResult =
  | Refusal
  | { ok: true; workspaces: QLabWorkspaceEntry[] }

/** Where a running QLab is. */
export interface QLabAddress {
  host: string
  port: number
}

export interface QLabLivePayload extends QLabAddress {
  workspaceId: string
  /** The workspace's passcode, when it has one. */
  passcode?: string
}

export interface QLabFindMediaPayload {
  workspace: Workspace
  workspacePath: string | null
}

/** The show after a folder was searched for its missing audio, and how many were found there. */
export interface QLabFoundMedia {
  workspace: Workspace
  missingMedia: MissingMedia[]
  found: number
}

export type QLabFindMediaResult =
  | Refusal
  | { ok: true; found: QLabFoundMedia | null }

/** The QLab import, as the renderer reads it (`window.cuerunner.qlab`). */
export interface QLabBridge {
  /** The OS dialog, then the file it picked; a cancel is a `null` inside the `ok` arm. */
  importFile(): Promise<QLabImportResult>
  /** The workspaces a running QLab has open. */
  listWorkspaces(host: string, port: number): Promise<QLabWorkspacesResult>
  /** One of those workspaces, read over OSC and converted. */
  importLive(payload: QLabLivePayload): Promise<QLabImportResult>
  /**
   * Asks for a folder and looks in it for every missing audio file, by the path the show
   * names it by and then by its file name. A cancel is a `null` inside the `ok` arm.
   */
  findMedia(workspace: Workspace, workspacePath: string | null): Promise<QLabFindMediaResult>
}
