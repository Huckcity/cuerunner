// The showfile and the media it points at. Opening, recovering and relinking all resolve
// the media a cue names, because a workspace that came from another machine has paths
// that only mean something there; the answer carries what was missing so the window can
// offer to find it rather than firing a cue at a file that is not there.
//
// Where a file is asked for, the dialog belongs to the operating system and is shown by
// main, so a cancel is an ordinary answer — `null` inside an `ok` envelope — rather than
// a rejection. Every other ordinary state refuses the same way: a file this build cannot
// read, a show with a cue type it does not know, an archive that arrived damaged. The
// Pro surfaces refuse as a value too: the show is the operator's either way, and a save
// writes its history whether or not this machine can read it. Only a fault rejects.

import type { Refusal } from './refusal'
import type { ConflictPolicy, MergeNote, MergeTally } from '../showfileMerge'
import type { ShowHistoryEntry, WorkspaceDiff } from '../showfile'
import type { MissingMedia } from '../media'
import type { LoadNote, Workspace } from '../workspace'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const WORKSPACE_CHANNELS = {
  open: 'workspace:open',
  openPath: 'workspace:openPath',
  openDemo: 'workspace:openDemo',
  relink: 'workspace:relink',
  save: 'workspace:save',
  saveAs: 'workspace:saveAs',
  exportBundle: 'workspace:exportBundle',
  importBundle: 'workspace:importBundle',
  merge: 'workspace:merge',
  compare: 'workspace:compare',
  recent: 'workspace:recent',
  autosave: 'workspace:autosave',
  recovery: 'workspace:recovery',
  clearRecovery: 'workspace:clearRecovery',
  setTitle: 'workspace:setTitle',
  confirmClose: 'workspace:confirmClose'
} as const

/** A workspace that was read, and everything resolution had to say about it. */
export interface OpenedWorkspace {
  path: string
  workspace: Workspace
  missingMedia: MissingMedia[]
  /** Grouping repairs the load made, beside the missing-media report. */
  loadNotes: LoadNote[]
}

/** One cue's missing media pointed at a file the operator picked. */
export interface RelinkedWorkspace {
  workspace: Workspace
  missingMedia: MissingMedia[]
}

export interface WorkspaceRelinkPayload {
  workspace: Workspace
  workspacePath: string | null
  cueId: string
}

export interface WorkspaceSavePayload {
  workspace: Workspace
  existingPath: string | null
}

/** The file a save wrote, and the history it wrote into it. */
export interface SavedWorkspace {
  path: string
  /**
   * The file's own history as it was written, including the entry this save added. The
   * window carries it from then on, so the next save appends to a history rather than
   * replacing one.
   */
  history: ShowHistoryEntry[]
  /**
   * The name this save gave the show, when it gave one: a show nobody had named takes its
   * file's name the first time it is put in one, and that name is in the bytes that were
   * written. Absent when the show already had a name of its own.
   */
  name?: string
}

/**
 * What a save answered: the file it wrote, a cancel, or why this build would not write.
 *
 * A save is the one workspace flow that reads back the bytes it is about to write — the
 * history pass puts them through the same funnel every load does — so this is where a
 * show this build will not read back is refused, while the file it would have replaced
 * is left exactly as it was. The operator's answer is the sentence, which is why the
 * channel declares the refusal rather than letting it reject as a fault.
 */
export type WorkspaceSaveResult =
  | Refusal
  | { ok: true; saved: SavedWorkspace | null }

/** A show and its media as one file, for handover. */
export interface ExportedBundle {
  path: string
  /** Files the show names that were not on this machine to be bundled. */
  missing: string[]
}

export interface WorkspaceExportPayload {
  workspace: Workspace
  workspacePath: string | null
}

/** What a second attempt at a merge reuses: the two files it read last time. */
export interface MergeInputs {
  theirs: string
  ancestor: string
}

export interface WorkspaceMergeOptions {
  /** Which side wins a field both files changed. */
  policy?: ConflictPolicy
  /** Run the same merge over the files it read last time, with the other side's choices. */
  again?: boolean
}

export interface WorkspaceMergePayload {
  workspace: Workspace
  workspacePath: string | null
  options?: WorkspaceMergeOptions
}

/** Where a merge wrote, what it had to decide, and the two files it read. */
export interface MergedShow {
  path: string
  notes: MergeNote[]
  tally: MergeTally
  inputs: MergeInputs
}

/** A comparison: the file the show was compared with, and the differences. */
export interface WorkspaceComparison {
  /** The file the show was compared with, which is the "before" side of the diff. */
  path: string
  diff: WorkspaceDiff
}

export type WorkspaceExportResult =
  | Refusal
  | { ok: true; exported: ExportedBundle | null }

export type WorkspaceImportResult =
  | Refusal
  | { ok: true; imported: OpenedWorkspace | null }

export type WorkspaceMergeResult =
  | Refusal
  | { ok: true; merged: MergedShow | null }

export type WorkspaceCompareResult =
  | Refusal
  | { ok: true; comparison: WorkspaceComparison | null }

/** What a File→Open answered: the show it read, a cancel, or why it could not open one. */
export type WorkspaceOpenResult =
  | Refusal
  | { ok: true; opened: OpenedWorkspace | null }

/** A file a recent entry named. It is already chosen, so a cancel is not among the answers. */
export type WorkspaceOpenPathResult =
  | Refusal
  | { ok: true; opened: OpenedWorkspace }

/** The snapshot found on disk, or nothing to offer — a refusal only for a snapshot this build cannot bring forward. */
export type WorkspaceRecoveryResult =
  | Refusal
  | { ok: true; recovery: WorkspaceRecovery | null }

/**
 * What opening the demo answered: the show it read, or why this build cannot read the one
 * it ships. The demo is the app's own file, and it is still a file: it goes through the
 * same funnel every other load does, so a shape this build does not write is refused here
 * like anywhere else rather than reaching the window as an unreadable show.
 */
export type WorkspaceDemoResult =
  | Refusal
  | { ok: true; workspace: Workspace }

export interface WorkspaceAutosavePayload {
  workspace: Workspace
  sourcePath: string | null
  selectedCueId: string | null
}

/** What autosave left behind, as it is handed back: the show, when it was saved, and what to resolve. */
export interface WorkspaceRecovery {
  workspace: Workspace
  savedAt: number
  sourcePath: string | null
  selectedCueId?: string | null
  missingMedia: MissingMedia[]
  /** Grouping repairs the snapshot needed, beside the missing-media report. */
  loadNotes: LoadNote[]
}

/** The showfile, as the renderer reads it (`window.cuerunner.workspace`). */
export interface WorkspaceBridge {
  /** The OS dialog; a cancel is a `null` inside the `ok` arm rather than an error. */
  open(): Promise<WorkspaceOpenResult>
  /** A file a recent entry names, opened without a dialog. */
  openPath(filePath: string): Promise<WorkspaceOpenPathResult>
  /** The demo show, or the refusal of the file it ships as. */
  openDemo(): Promise<WorkspaceDemoResult>
  /** Points one cue's missing media at a file the operator picked. */
  relink(workspace: Workspace, workspacePath: string | null, cueId: string): Promise<RelinkedWorkspace>
  save(workspace: Workspace, existingPath: string | null): Promise<WorkspaceSaveResult>
  saveAs(workspace: Workspace): Promise<WorkspaceSaveResult>
  exportBundle(workspace: Workspace, workspacePath: string | null): Promise<WorkspaceExportResult>
  importBundle(): Promise<WorkspaceImportResult>
  merge(
    workspace: Workspace,
    workspacePath: string | null,
    options?: WorkspaceMergeOptions
  ): Promise<WorkspaceMergeResult>
  compare(workspace: Workspace): Promise<WorkspaceCompareResult>
  recent(): Promise<string[]>
  autosave(workspace: Workspace, sourcePath: string | null, selectedCueId: string | null): Promise<void>
  /** The snapshot a session that ended without saving left behind, or nothing to offer. */
  recovery(): Promise<WorkspaceRecoveryResult>
  clearRecovery(): Promise<void>
  setTitle(title: string): Promise<void>
  confirmClose(workspaceName: string): Promise<0 | 1 | 2>
}
