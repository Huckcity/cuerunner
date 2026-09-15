import { create } from 'zustand'
import type { Cue, CueType, AudioCue, GroupCue, SoundRegion } from '../types/cue'
import type { MissingMedia } from '../../../shared/media'
import type { ShowHistoryEntry } from '../../../shared/showfile'
import type { MergeNote, MergeTally } from '../../../shared/showfileMerge'
import type { AudioSettings, MidiSettings, TriggerGuardSettings, WorkspaceIdentity } from '../types/workspace'
import { DEFAULT_TRIGGER_GUARD, normalizeTriggerGuard } from '../types/workspace'
import { defaultShowSettings } from '../types/show'
import type { RedundancySettings, RedundancyStatus } from '../../../shared/redundancy'
import type {
  CastSettings,
  CompanionSettings,
  DeskSettings,
  DeviceState,
  DeviceEvent,
  MicScene,
  MidiInSettings,
  OscInSettings,
  PresenceSettings,
  RfPlot,
  RfSettings,
  ScenesSettings,
  ScriptSettings,
  ServiceEvent,
  ServiceStatus,
  ShowAlert,
  ShowEvent,
  ShowSettings,
  ShowSnapshot
} from '../types/show'
import { createCue } from '../utils/cueDefaults'
import { partName, regionEndMs, splitAudioCue } from '../utils/cueSplit'
import type { MediaLengthAnswer } from '../utils/mediaLength'
import {
  addEnsemble,
  removeEnsemble as removeEnsembleFromCast,
  removePerformerFromCast
} from '../utils/cast'
import {
  removeEnsembleFromScenes,
  removePerformerFromScenes,
  sceneLiveIds,
  setEnsembleApplied
} from '../utils/scenes'
import { describeSwap, recordSwaps, releasePerformerPacks } from '../utils/rfPlot'
import type { LicenseStatus } from '../types/license'

export type RunState = 'idle' | 'pre-wait' | 'playing' | 'post-wait'

/**
 * The tabs the settings dialog has. `license` is the machine's own settings rather
 * than the workspace's, which is why the dialog can be opened straight onto it.
 */
export type SettingsTab = 'general' | 'audio' | 'midi' | 'network' | 'wireless' | 'redundancy' | 'license'

/** The tabs Show Settings has, in the order they are drawn. */
export type ShowSettingsTab = 'channels' | 'cast' | 'mic-plot'

/** The two halves of the Changes dialog: what this file did, and how it differs. */
export type ChangesTab = 'history' | 'compare'

/** What a merge did, as the window shows it: where the result is, and what to read. */
export interface MergeReport {
  path: string
  notes: MergeNote[]
  tally: MergeTally
  /** The conflict policy this attempt used. */
  policy: 'ours' | 'theirs'
}

export interface RunningCue {
  cueId: string
  state: RunState
  startedAt: number
  progress: number
}

// Outcome of a cue's most recent execution. Kept beside `running` rather than on the
// cue itself: run results are not workspace content, so they must not dirty the
// workspace or enter the undo history.
export interface CueRunResult {
  startedAt: number
  durationMs: number
  outcome: 'success' | 'error'
  /** Network cues: status of the response, when one arrived. */
  status?: number
  statusText?: string
  /** Failure detail — a connection or timeout error, an HTTP error status, or a thrown script error. */
  error?: string
  /** Network cues: the start of the response body, capped at NETWORK_BODY_LIMIT characters. */
  body?: string
}

export type LogLevel = 'info' | 'output' | 'error'

export interface LogEntry {
  id: number
  at: number
  level: LogLevel
  message: string
  /** Cue identity when the entry was written, e.g. "3 · Network Cue". */
  label?: string
}

export type LogEntryInput = Omit<LogEntry, 'id' | 'at'>

// The log is a bounded session history: old entries fall off the top, and a single
// message is truncated so a runaway script cannot pin memory.
const LOG_LIMIT = 500
const LOG_MESSAGE_LIMIT = 4000

// The show monitor is a window on what is happening now, not a transcript — the session
// log keeps the record. Both are bounded so a chatty console cannot pin memory.
const SHOW_EVENT_LIMIT = 300
const SHOW_ALERT_LIMIT = 200

const defaultAudioSettings: AudioSettings = {
  outputDeviceId: 'default',
}

const defaultMidiSettings: MidiSettings = {
  outputPortName: '',
}

/**
 * A place in one cue's file. The cursor is a time in a file, so it carries the cue it was
 * placed in: the same number in another track is a different place, and drawing it there
 * would be the panel claiming the operator pointed at something they did not.
 */
export interface WaveformCursor {
  cueId: string
  ms: number
}

interface CueListState {
  // Workspace metadata. The identity belongs to the show, not to a save: it comes out of
  // the file it was opened from and is written back unchanged, so saving a show twice
  // does not rewrite it. Only a new show — or a template like the demo — mints one.
  workspaceName: string
  workspacePath: string | null
  workspaceId: string
  workspaceCreatedAt: string
  /**
   * The showfile's own history: what each of its saves changed, as the file records it.
   * Not the undo stack above — that is this session's edits, and it is gone when the app
   * closes. This one travels in the file, is written by the main process at save time,
   * and is what the History tab reads. The file calls it `history`.
   */
  showHistory: ShowHistoryEntry[]
  isDirty: boolean

  // Settings
  audioSettings: AudioSettings
  midiSettings: MidiSettings

  // Cue data
  cues: Cue[]
  selectedId: string | null
  running: Map<string, RunningCue>

  // Undo / redo history
  past: EditSnapshot[]
  future: EditSnapshot[]

  // Cue CRUD
  addCue: (type: CueType, afterId?: string) => void
  addAudioCuesFromFiles: (files: Array<{ filePath: string; name: string }>, afterId?: string) => void
  /** Removes each cue with its children — a group takes its subtree — as a single edit. */
  removeCues: (ids: string[]) => void
  updateCue: (id: string, patch: Partial<Cue>) => void
  /**
   * Writes one patch across a set of cues as a single edit: one undo entry, one dirty.
   * This is what a batch action — a colour across a multi-selection — is made of.
   */
  updateCues: (ids: string[], patch: Partial<Cue>) => void
  // Places the cue at fromIndex — together with its children when it is a group —
  // immediately before the cue currently at beforeIndex (cues.length moves it last).
  // newParentId is ignored when it would make the cue a child of itself or of one of
  // its own descendants (the cue keeps its current parent).
  moveCue: (fromIndex: number, beforeIndex: number, newParentId?: string | null) => void
  /** Duplicates each cue with its children as a single edit; the copies are selected. */
  duplicateCues: (ids: string[]) => void

  // Selection. The set is what a bulk edit acts on; `selectedId` is the cue the operator
  // last put their hand on — the one GO fires and advances from, and always a member of
  // the set while the set has one — and `selectionAnchorId` is where a shift-click range
  // extends from. Session state: where the operator is standing is not what the show is,
  // so none of it dirties the workspace or enters undo.
  selectedIds: string[]
  selectionAnchorId: string | null
  /** One cue, or none: the operator put their hand on it. */
  select: (id: string | null) => void
  /** The selection as a whole, for a caller that worked it out (a range, a set). */
  setSelection: (ids: string[], active?: string | null, anchor?: string | null) => void
  /** Shift-click: the run of cues from the anchor to this one, in the order given. */
  extendSelection: (orderedIds: string[], toId: string) => void
  /** Cmd-click: this cue in the set, or out of it. */
  toggleSelected: (id: string) => void

  /**
   * Where the waveform cursor sits, in file milliseconds, and which cue's file it is in.
   * It is where a split will be made and where a click on the waveform seeks to, so the
   * two hands that set it — the click and the drag — write to the same place. A cursor
   * belongs to the track it was placed on: a time is a place in that file, and the same
   * number in another track is a different place. Session state: a cursor is where
   * somebody is looking, not part of the show.
   */
  waveformCursor: WaveformCursor | null
  /** Places the cursor in one cue's file, or takes it away (null). */
  setWaveformCursor: (cueId: string, ms: number | null) => void

  /**
   * Moves one edge of an audio cue's region, taking the cue that continues it along when
   * the two meet there: a split pair is one boundary in two cues, and dragging it on one
   * side only would leave a gap nobody asked for.
   */
  setRegionBoundary: (id: string, edge: 'start' | 'end', ms: number) => void

  /**
   * Splits an audio cue at a point in its own file, as one edit: the cue keeps its
   * identity and triggers over the head of the region and a continuation takes the tail.
   */
  splitAudioCueAt: (id: string, atMs: number) => void

  // Running state
  setRunning: (id: string, state: RunningCue | null) => void
  clearAllRunning: () => void

  /**
   * The groups whose children are hidden, by id. Where the operator's eye is is not what
   * the show is, so this is session state: it never dirties the workspace and never
   * enters undo.
   */
  collapsedGroupIds: Set<string>
  /** Opens or closes one group's children. */
  toggleGroup: (id: string) => void
  /**
   * Opens the top-level groups and leaves the nested ones as the operator left them: a
   * group inside a group is a decision somebody made, and opening everything to reach
   * the top level would take that decision away.
   */
  expandTopLevel: () => void
  /** Closes every group: collapsing has no partial reading. */
  collapseAll: () => void
  syncCueDuration: (id: string, durationMs: number) => void
  /**
   * Writes down where a scan found the sound in a cue's file. A measurement rather than
   * an edit, like the length: it does not dirty the session, and it is forgotten the
   * moment the cue names another file.
   */
  syncCueSilence: (id: string, region: SoundRegion) => void
  lastRuns: Record<string, CueRunResult>
  setLastRun: (id: string, result: CueRunResult) => void

  // Session log
  log: LogEntry[]
  appendLog: (entries: LogEntryInput[]) => void
  clearLog: () => void

  /**
   * How long each firing surface stays deaf after it fires a cue. Workspace content: it
   * travels with the show, because the desk that sends twice travels with the show too.
   */
  triggerGuard: TriggerGuardSettings
  updateTriggerGuard: (patch: Partial<TriggerGuardSettings>) => void

  // Show services. Everything here is reported by the main process and rendered by the
  // monitor panel: what is listening, what is on stage, and what has gone wrong. None
  // of it is workspace content, so none of it dirties the show or enters undo.
  showSettings: ShowSettings
  showServices: ServiceStatus[]
  showDevices: DeviceState[]
  showAlerts: ShowAlert[]
  showEvents: ShowEvent[]
  /** Folds a batch from the main process into state; alarms also reach the session log. */
  applyShowEvents: (events: ShowEvent[]) => void
  /** Replaces the world wholesale, for a renderer that just reloaded mid-show. */
  setShowSnapshot: (snapshot: ShowSnapshot) => void
  dismissAlert: (id: number) => void
  clearShowEvents: () => void

  /**
   * Redundant playback, as the main process last reported it: which half of the pair
   * this machine is, whether its partner is answering, and what it last did about it.
   * Like the services above, it is a fact about the machines rather than the show.
   */
  redundancy: RedundancyStatus | null
  /**
   * This machine's own half of the arrangement — its role, its name and where its
   * partner is. Kept with the machine rather than in the workspace, and read from the
   * main process at startup; null until it has been read.
   */
  redundancySettings: RedundancySettings | null
  setRedundancySettings: (settings: RedundancySettings) => void
  /** Operator-facing message shown in the notice bar: a failed save or open. */
  notice: string | null
  setNotice: (message: string | null) => void

  /**
   * Audio files the loaded workspace could not find, with the cues that name them.
   * Workspace content, not session state: it is reported by the main process on load
   * and cleared by a relink, and it is never saved into the file itself.
   */
  missingMedia: MissingMedia[]
  setMissingMedia: (media: MissingMedia[]) => void
  /**
   * Applies the cue paths a relink resolved. One pick can put several cues back at
   * once, and that is one edit: it dirties the session once and undoes once.
   */
  applyRelinkedMedia: (paths: Record<string, string>) => void

  /**
   * What this session has found out about the files a show points at, by cue id: the
   * answers that settle a cue's length for good (`utils/mediaLength.ts`). Session state,
   * not workspace content — a measured cue carries its length, and what the engine said
   * about a file on this machine is not the show.
   */
  mediaLengths: Record<string, MediaLengthAnswer>
  /** Records answers, or forgets one when a cue's file turns out to have changed. */
  setMediaLengths: (answers: Record<string, MediaLengthAnswer | null>) => void

  /**
   * Files the engine has refused to scan for silence, by cue id, and the path that was
   * asked about. Session state, not workspace content: a silence measurement is a pass
   * over a whole file, so a question the engine cannot answer has to be remembered or
   * the pass would ask it again on every edit. Keyed by path, so a cue relinked to a
   * different file is a question nobody has asked yet.
   */
  silenceFailures: Record<string, string>
  /** Records a refusal, or forgets one when a cue is pointed at another file. */
  setSilenceFailure: (cueId: string, filePath: string | null) => void

  // License. The machine's, not the show's: it is read from the main process before
  // the first frame, it never travels in a workspace, and it never dirties one.
  license: LicenseStatus
  setLicense: (status: LicenseStatus) => void
  /** Which tab the settings dialog is on, or null when it is closed. */
  settingsTab: SettingsTab | null
  openSettings: (tab: SettingsTab) => void
  closeSettings: () => void

  /**
   * Which tab Show Settings is on, or null when it is closed. The show's setup is
   * workspace content, so this is the panel the menu opens rather than a section of the
   * app's own settings.
   */
  showSettingsTab: ShowSettingsTab | null
  openShowSettings: (tab: ShowSettingsTab) => void
  closeShowSettings: () => void

  /**
   * Which half of the Changes dialog is up, or null when it is closed: the show's own
   * history of its saves, or how it differs from another file. One dialog with two tabs
   * rather than two panels, because the two questions are asked together — what happened
   * to this show, and what did the other version do differently.
   */
  changesTab: ChangesTab | null
  openChanges: (tab: ChangesTab) => void
  closeChanges: () => void

  /**
   * The last merge's report, or null when there is none to show. Not workspace content:
   * it describes two other files and what the merge between them did.
   */
  mergeReport: MergeReport | null
  setMergeReport: (report: MergeReport | null) => void

  /** Marks the session as having unsaved changes, e.g. after recovering a snapshot. */
  markDirty: () => void

  /**
   * The engine's own reason for refusing a device change, or null when the last request
   * was honoured. Session state, not workspace content: it says what this machine did,
   * and it stands until a request is accepted.
   */
  audioDeviceError: string | null
  setAudioDeviceError: (message: string | null) => void

  // Settings
  updateAudioSettings: (patch: Partial<AudioSettings>) => void
  updateMidiSettings: (patch: Partial<MidiSettings>) => void
  updateOscInSettings: (patch: Partial<OscInSettings>) => void
  updateMidiInSettings: (patch: Partial<MidiInSettings>) => void
  updateRfSettings: (patch: Partial<RfSettings>) => void
  updatePresenceSettings: (patch: Partial<PresenceSettings>) => void
  updateScriptSettings: (patch: Partial<ScriptSettings>) => void
  updateCompanionSettings: (patch: Partial<CompanionSettings>) => void
  /** How the show reaches the desk: where it is, and what a DCA's number means to it. */
  updateDeskSettings: (patch: Partial<DeskSettings>) => void
  updateScenesSettings: (patch: Partial<ScenesSettings>) => void
  updateCastSettings: (patch: Partial<CastSettings>) => void
  /**
   * Drops an ensemble and unapplies it from every scene that had it, as one edit: a
   * scene still pointing at an ensemble that is gone is a group of mics nobody can open
   * or close from the grid again.
   */
  removeEnsemble: (ensembleId: string) => void

  /**
   * Makes an ensemble out of the performers open in a scene, and applies it to that
   * scene. One edit rather than two: an ensemble built from a scene and not applied to
   * it is a grouping that disappears the moment the operator looks away from the grid.
   */
  addEnsembleFromScene: (sceneId: string) => void
  /**
   * Drops a performer from the cast: released from every pack they wore (each a swap of
   * its own), out of whichever ensembles had them, and off every scene's open list and
   * list of exclusions — three settings sections changed as one edit, because a
   * performer half-removed from one of them is a name that no longer means anything in
   * the others.
   */
  removePerformer: (performerId: string) => void

  // Where the desk was left. Session state, not workspace content: a show that has just
  // loaded has not told the desk anything yet, and saying otherwise would stop the first
  // recall from sending what it needs to.
  deskState: Record<string, boolean>
  deskSceneId: string | null
  setDeskState: (deskState: Record<string, boolean>, deskSceneId: string | null) => void

  /**
   * Whether the Scenes view is being edited. Session state, and off whenever a show is
   * opened: the view is run from at curtain up, so it starts where a stray click changes
   * nothing, and editing is a press somebody made on purpose.
   */
  scenesEditing: boolean
  setScenesEditing: (editing: boolean) => void

  /**
   * How many modal panels are up. Session state: the transport bindings stand down while
   * one is, so the keyboard belongs to the panel rather than to the show behind it.
   */
  modals: number
  pushModal: () => void
  popModal: () => void

  // Undo / redo
  undo: () => void
  redo: () => void

  // Workspace lifecycle
  loadWorkspace: (
    cues: Cue[],
    name: string,
    path: string | null,
    audioSettings?: AudioSettings,
    midiSettings?: MidiSettings,
    showSettings?: ShowSettings,
    identity?: WorkspaceIdentity,
    triggerGuard?: TriggerGuardSettings,
    history?: ShowHistoryEntry[]
  ) => void
  /** A save that reached the disk: its path, and the history it wrote into the file. */
  saveSucceeded: (path: string, name: string, history: ShowHistoryEntry[]) => void
  setWorkspaceName: (name: string) => void
}

const HISTORY_LIMIT = 50

/**
 * What an undo puts back: the things an edit in this app destroys. Together, because
 * one edit can span them — dropping an ensemble takes it out of the cast and unapplies
 * it from every scene that had it, and half an undo of that would be a lie.
 */
interface EditSnapshot {
  cues: Cue[]
  scenes: { list: MicScene[] }
  cast: CastSettings
  desk: DeskSettings
  plot: RfPlot
}

function snapshotOf(state: CueListState): EditSnapshot {
  return {
    cues: state.cues,
    scenes: { list: state.showSettings.scenes.list },
    cast: state.showSettings.cast,
    desk: state.showSettings.desk,
    plot: state.showSettings.rf.plot
  }
}

/** The show settings an undo puts back, leaving the rest of them where they are. */
function restoreSettings(showSettings: ShowSettings, snapshot: EditSnapshot): ShowSettings {
  return {
    ...showSettings,
    scenes: { ...showSettings.scenes, list: snapshot.scenes.list },
    cast: snapshot.cast,
    desk: snapshot.desk,
    rf: { ...showSettings.rf, plot: snapshot.plot }
  }
}

// Monotonic id source for log entries — React keys and ordering in the log panel.
let _logSeq = 0

/**
 * The selection one cue leaves behind: it is what the operator's hand is on, so it is
 * both the set a bulk edit acts on and the cue GO fires. Four actions land here — adding
 * a cue, dropping files, duplicating, opening a workspace — and they must agree, because
 * the set and the active cue being out of step is a selection nobody can explain.
 */
function selectionFor(id: string): Pick<CueListState, 'selectedId' | 'selectedIds' | 'selectionAnchorId'> {
  return { selectedId: id, selectedIds: [id], selectionAnchorId: id }
}

/** Nothing selected: no active cue, no set, nowhere for a shift-range to start. */
const NO_SELECTION: Pick<CueListState, 'selectedId' | 'selectedIds' | 'selectionAnchorId'> = {
  selectedId: null,
  selectedIds: [],
  selectionAnchorId: null
}

/**
 * The selection, minus anything the show no longer holds: an undo, a redo or a removal
 * can take a cue away, and a set naming a cue that is not there is a selection nobody can
 * see or explain.
 */
function pruneSelection(
  cues: Cue[],
  selection: Pick<CueListState, 'selectedId' | 'selectedIds' | 'selectionAnchorId'>
): Pick<CueListState, 'selectedId' | 'selectedIds' | 'selectionAnchorId'> {
  const live = new Set(cues.map(cue => cue.id))
  const selectedIds = selection.selectedIds.filter(id => live.has(id))
  const selectedId = selection.selectedId !== null && live.has(selection.selectedId)
    ? selection.selectedId
    : selectedIds[selectedIds.length - 1] ?? null
  return {
    selectedIds,
    selectedId,
    selectionAnchorId: selection.selectionAnchorId !== null && live.has(selection.selectionAnchorId)
      ? selection.selectionAnchorId
      : null
  }
}

function pushPast(past: EditSnapshot[], snapshot: EditSnapshot): EditSnapshot[] {
  return [...past.slice(-(HISTORY_LIMIT - 1)), snapshot]
}

// One truncation rule for every writer: the session log, cue runs and show alarms.
function appendToLog(log: LogEntry[], entries: LogEntryInput[]): LogEntry[] {
  const at = Date.now()
  const added = entries.map(e => ({
    ...e,
    id: ++_logSeq,
    at,
    message: e.message.length > LOG_MESSAGE_LIMIT
      ? e.message.slice(0, LOG_MESSAGE_LIMIT) + '… (truncated)'
      : e.message
  }))
  return [...log, ...added].slice(-LOG_LIMIT)
}

// Devices and services are keyed lists that only ever grow by identity: a batch either
// updates an entry in place or adds one. Returning the previous array when a batch
// carries none of them keeps the panels from re-rendering on every OSC message.
function mergeDevices(previous: DeviceState[], events: ShowEvent[]): DeviceState[] {
  const updates = events.filter((event): event is DeviceEvent => event.kind === 'device')
  if (updates.length === 0) return previous
  const byId = new Map(previous.map(device => [device.id, device]))
  for (const update of updates) byId.set(update.device.id, update.device)
  return [...byId.values()]
}

function mergeServices(previous: ServiceStatus[], events: ShowEvent[]): ServiceStatus[] {
  const updates = events.filter((event): event is ServiceEvent => event.kind === 'service')
  if (updates.length === 0) return previous
  const byId = new Map(previous.map(service => [service.id, service]))
  for (const update of updates) byId.set(update.service.id, update.service)
  return [...byId.values()]
}

/** The newest redundancy status in a batch, or the one already held when it carries none. */
function latestRedundancy(previous: RedundancyStatus | null, events: ShowEvent[]): RedundancyStatus | null {
  let status = previous
  for (const event of events) {
    if (event.kind === 'redundancy') status = event.status
  }
  return status
}

// Coalesce rapid updateCue calls for the same cue into one history entry.
let _coalesceId: string | null = null
let _coalesceTime = 0

/** Whether a patch points the cue at a file other than the one it names now. */
function cueRetargeted(cues: Cue[], id: string, patch: Partial<Cue>): boolean {
  if (!('filePath' in patch) || patch.filePath === undefined) return false
  const cue = cues.find(c => c.id === id)
  return cue !== undefined && cue.type === 'audio' && cue.filePath !== patch.filePath
}

/**
 * One cue with a patch applied. A cue pointed at another file loses the measurement
 * that came back from the last one: where a scan found the sound is a fact about the
 * file that answered, not about the cue.
 */
function patchedCue(cue: Cue, patch: Partial<Cue>): Cue {
  const next = { ...cue, ...patch } as Cue
  // Only an audio cue has a file to point somewhere else, and only a measurement has a
  // file to belong to.
  const was = cue.type === 'audio' ? cue : null
  if (next.type === 'audio' && 'filePath' in patch && patch.filePath !== was?.filePath) {
    next.soundRegion = null
  }
  return next
}

/** The refusals without the given cues, for cues that now name another file. */
function forgetSilenceFailures(
  failures: Record<string, string>,
  ids: Iterable<string>
): Record<string, string> {
  const dropped = [...ids].filter(id => id in failures)
  if (dropped.length === 0) return failures
  const next = { ...failures }
  for (const id of dropped) delete next[id]
  return next
}

function shouldRecordUpdate(cueId: string): boolean {
  const now = Date.now()
  const record = cueId !== _coalesceId || now - _coalesceTime > 1000
  _coalesceId = cueId
  _coalesceTime = now
  return record
}

// Returns the flat index of the last child belonging to groupId,
// or the group's own index if it has no children.
function lastChildIndex(cues: Cue[], groupId: string): number {
  const groupIdx = cues.findIndex(c => c.id === groupId)
  let last = groupIdx
  while (last + 1 < cues.length && cues[last + 1].parentId === groupId) last++
  return last
}

// Returns the flat index of the last cue in the subtree rooted at startIndex.
// Children are stored contiguously behind their parent, so the subtree is a range —
// this walks the whole tree, not just direct children (groups can contain groups).
function subtreeEndIndex(cues: Cue[], startIndex: number): number {
  const subtree = new Set([cues[startIndex].id])
  let end = startIndex
  while (end + 1 < cues.length) {
    const next = cues[end + 1]
    if (next.parentId === null || !subtree.has(next.parentId)) break
    subtree.add(next.id)
    end++
  }
  return end
}

// True when cueId sits somewhere below possibleAncestorId in the parent chain.
function isDescendant(cues: Cue[], cueId: string, possibleAncestorId: string): boolean {
  const byId = new Map(cues.map(c => [c.id, c]))
  let current = byId.get(cueId)
  while (current?.parentId) {
    if (current.parentId === possibleAncestorId) return true
    current = byId.get(current.parentId)
  }
  return false
}

export const useStore = create<CueListState>((set) => ({
  workspaceName: 'Untitled',
  workspacePath: null,
  // A session that has not opened a file is a new show, so it starts with an identity of
  // its own — minted once here, not once per save.
  workspaceId: crypto.randomUUID(),
  workspaceCreatedAt: new Date().toISOString(),
  // Nothing has been saved yet, so the file has no history to show.
  showHistory: [],
  isDirty: false,

  audioSettings: { ...defaultAudioSettings },
  midiSettings: { ...defaultMidiSettings },

  cues: [],
  selectedId: null,
  selectedIds: [],
  selectionAnchorId: null,
  waveformCursor: null,
  collapsedGroupIds: new Set<string>(),
  running: new Map(),
  lastRuns: {},
  log: [],
  showSettings: defaultShowSettings(),
  triggerGuard: { ...DEFAULT_TRIGGER_GUARD },
  showServices: [],
  showDevices: [],
  showAlerts: [],
  showEvents: [],
  redundancy: null,
  redundancySettings: null,
  deskState: {},
  deskSceneId: null,
  scenesEditing: false,
  modals: 0,
  audioDeviceError: null,
  notice: null,
  missingMedia: [],
  mediaLengths: {},
  silenceFailures: {},
  past: [],
  future: [],

  // Locked until the main process says otherwise: the window is told what this machine
  // holds before it draws anything, and a failure to read it must not unlock the app.
  license: { state: 'unlicensed' },
  settingsTab: null,
  showSettingsTab: null,
  changesTab: null,
  mergeReport: null,

  addCue: (type, afterId) => set(s => {
    const cue = createCue(type)
    // Adding a cue is the one moment the show's answer to trimming silence is read: the
    // setting is a default for new cues, never a switch over the ones already in the
    // list, so turning it off does not rewrite the show behind the operator.
    if (cue.type === 'audio') cue.trimSilence = s.audioSettings.autoTrimSilence === true
    const cues = [...s.cues]

    let insertIdx: number
    if (!afterId) {
      insertIdx = cues.length
    } else {
      const afterCue = cues.find(c => c.id === afterId)
      if (afterCue?.type === 'group') {
        // Inserting after a group header → becomes its last child
        cue.parentId = afterId
        insertIdx = lastChildIndex(cues, afterId) + 1
      } else {
        // Inserting after a regular cue or group child → inherit context
        cue.parentId = afterCue?.parentId ?? null
        insertIdx = cues.findIndex(c => c.id === afterId) + 1
      }
    }

    cues.splice(insertIdx, 0, cue)
    return { cues, ...selectionFor(cue.id), isDirty: true, past: pushPast(s.past, snapshotOf(s)), future: [] }
  }),

  addAudioCuesFromFiles: (files, afterId) => set(s => {
    const cues = [...s.cues]
    let insertIdx: number
    let parentId: string | null = null

    if (!afterId) {
      insertIdx = cues.length
    } else {
      const afterCue = cues.find(c => c.id === afterId)
      if (afterCue?.type === 'group') {
        parentId = afterId
        insertIdx = lastChildIndex(cues, afterId) + 1
      } else {
        parentId = afterCue?.parentId ?? null
        insertIdx = cues.findIndex(c => c.id === afterId) + 1
      }
    }

    const newCues: Cue[] = files.map(({ filePath, name }) => ({
      ...(createCue('audio') as AudioCue),
      filePath,
      name,
      parentId,
      // Dropped files are cues being added, so the default for new cues applies to them
      // exactly as it does to one made with the toolbar.
      trimSilence: s.audioSettings.autoTrimSilence === true
    }))
    cues.splice(insertIdx, 0, ...newCues)
    const lastAdded = newCues[newCues.length - 1]
    return { cues, ...selectionFor(lastAdded.id), isDirty: true, past: pushPast(s.past, snapshotOf(s)), future: [] }
  }),

  removeCues: (ids) => set(s => {
    const roots = ids.filter(id => s.cues.some(cue => cue.id === id))
    if (roots.length === 0) return s

    // A group takes its whole subtree with it — children and grandchildren both — so the
    // list cannot be left holding cues whose parent is gone.
    const childIds = new Map<string, string[]>()
    for (const cue of s.cues) {
      if (cue.parentId === null) continue
      childIds.set(cue.parentId, [...(childIds.get(cue.parentId) ?? []), cue.id])
    }
    const removed = new Set<string>()
    const stack = [...roots]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (removed.has(id)) continue
      removed.add(id)
      stack.push(...(childIds.get(id) ?? []))
    }

    const selectedIds = s.selectedIds.filter(id => !removed.has(id))
    return {
      cues: s.cues.filter(c => !removed.has(c.id)),
      selectedIds,
      // The hand moves to what is left of the set, rather than to nothing while rows are
      // still highlighted.
      selectedId: removed.has(s.selectedId ?? '') ? selectedIds[selectedIds.length - 1] ?? null : s.selectedId,
      selectionAnchorId: removed.has(s.selectionAnchorId ?? '') ? null : s.selectionAnchorId,
      lastRuns: Object.fromEntries(
        Object.entries(s.lastRuns).filter(([cueId]) => !removed.has(cueId))
      ),
      isDirty: true,
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
    }
  }),

  updateCue: (id, patch) => set(s => {
    const record = shouldRecordUpdate(id)
    // A cue pointed at another file has not been measured against it: the sound region a
    // scan wrote down belongs to the file that answered, and so does a refusal. The
    // measurement pass asks the new file.
    const retargeted = cueRetargeted(s.cues, id, patch)
    return {
      cues: s.cues.map(c => c.id === id ? patchedCue(c, patch) : c),
      ...(retargeted ? { silenceFailures: forgetSilenceFailures(s.silenceFailures, [id]) } : {}),
      isDirty: true,
      past: record ? pushPast(s.past, snapshotOf(s)) : s.past,
      future: record ? [] : s.future,
    }
  }),

  updateCues: (ids, patch) => set(s => {
    const touched = new Set(ids)
    if (touched.size === 0) return s
    // The set is one thing the operator did, so it is one entry in the history — and
    // repeated writes to the same set in a breath (a run of swatch presses) coalesce the
    // way a run of keystrokes in one field does.
    const record = shouldRecordUpdate(`set:${ids.join(',')}`)
    const retargeted = ids.filter(id => cueRetargeted(s.cues, id, patch))
    return {
      cues: s.cues.map(c => touched.has(c.id) ? patchedCue(c, patch) : c),
      ...(retargeted.length > 0
        ? { silenceFailures: forgetSilenceFailures(s.silenceFailures, retargeted) }
        : {}),
      isDirty: true,
      past: record ? pushPast(s.past, snapshotOf(s)) : s.past,
      future: record ? [] : s.future,
    }
  }),

  moveCue: (fromIndex, beforeIndex, newParentId) => set(s => {
    const moved = s.cues[fromIndex]
    if (!moved) return s

    // A group travels with its children — they are stored contiguously behind it.
    const end = subtreeEndIndex(s.cues, fromIndex)
    // Dropping the block inside itself (e.g. on one of its own rows) changes nothing.
    if (beforeIndex > fromIndex && beforeIndex <= end) return s

    // Re-parenting a cue to itself or to one of its descendants would make it
    // unreachable — its own collapse state would hide it. Keep the current parent.
    const illegalParent = newParentId === moved.id ||
      (typeof newParentId === 'string' && isDescendant(s.cues, newParentId, moved.id))
    const parentId = newParentId === undefined || illegalParent ? moved.parentId : newParentId

    const cues = [...s.cues]
    const block = cues.splice(fromIndex, end - fromIndex + 1)
    block[0] = { ...block[0], parentId }
    // beforeIndex points into the pre-move array: shift it past the removed block.
    cues.splice(beforeIndex > end ? beforeIndex - block.length : beforeIndex, 0, ...block)

    const unchanged = cues.every((c, i) => {
      const prev = s.cues[i]
      return prev !== undefined && c.id === prev.id && c.parentId === prev.parentId
    })
    if (unchanged) return s

    return { cues, isDirty: true, past: pushPast(s.past, snapshotOf(s)), future: [] }
  }),

  duplicateCues: (ids) => set(s => {
    // Where each source's copies go: after the cue, or after the subtree when it is a
    // group, which is what keeps a group's children behind their own header.
    const insertAfter = new Map<number, Cue[]>()
    for (const id of ids) {
      const srcIdx = s.cues.findIndex(c => c.id === id)
      if (srcIdx < 0) continue
      const src = s.cues[srcIdx]
      const newGroupId = crypto.randomUUID()

      const copies: Cue[] = [{
        ...src,
        id: src.type === 'group' ? newGroupId : crypto.randomUUID(),
        number: src.number + ' copy'
      }]
      if (src.type === 'group') {
        // The whole subtree, each child pointing at the copy of its own parent, so a
        // group inside a group comes with its children too.
        const copyOf = new Map<string, string>([[src.id, newGroupId]])
        for (let i = srcIdx + 1; i <= subtreeEndIndex(s.cues, srcIdx); i++) {
          const child = s.cues[i]
          if (child.parentId === null) continue
          const parentCopy = copyOf.get(child.parentId)
          if (parentCopy === undefined) continue
          const copyId = crypto.randomUUID()
          copyOf.set(child.id, copyId)
          copies.push({ ...child, id: copyId, parentId: parentCopy })
        }
      }
      insertAfter.set(
        src.type === 'group' ? subtreeEndIndex(s.cues, srcIdx) : srcIdx,
        copies
      )
    }
    if (insertAfter.size === 0) return s

    const cues: Cue[] = []
    const copied: string[] = []
    s.cues.forEach((cue, index) => {
      cues.push(cue)
      const copies = insertAfter.get(index)
      if (copies === undefined) return
      cues.push(...copies)
      copied.push(...copies.map(copy => copy.id))
    })

    // The copies are what the operator is holding now: a second press duplicates them
    // again rather than the originals.
    return {
      cues,
      selectedIds: copied,
      selectedId: copied[copied.length - 1],
      selectionAnchorId: copied[0],
      isDirty: true,
      past: pushPast(s.past, snapshotOf(s)),
      future: []
    }
  }),

  undo: () => set(s => {
    if (s.past.length === 0) return s
    const past = [...s.past]
    const snapshot = past.pop()!
    return {
      cues: snapshot.cues,
      ...pruneSelection(snapshot.cues, s),
      showSettings: restoreSettings(s.showSettings, snapshot),
      past,
      future: [snapshotOf(s), ...s.future.slice(0, HISTORY_LIMIT - 1)]
    }
  }),

  redo: () => set(s => {
    if (s.future.length === 0) return s
    const future = [...s.future]
    const snapshot = future.shift()!
    return {
      cues: snapshot.cues,
      ...pruneSelection(snapshot.cues, s),
      showSettings: restoreSettings(s.showSettings, snapshot),
      future,
      past: pushPast(s.past, snapshotOf(s))
    }
  }),

  select: (id) => set(() => id === null ? { ...NO_SELECTION } : selectionFor(id)),

  setSelection: (ids, active = null, anchor = null) => set(() => {
    const unique = [...new Set(ids)]
    const activeId = active !== null && unique.includes(active) ? active : unique[unique.length - 1] ?? null
    return {
      selectedIds: unique,
      selectedId: activeId,
      selectionAnchorId: anchor !== null && unique.includes(anchor) ? anchor : activeId
    }
  }),

  extendSelection: (orderedIds, toId) => set(s => {
    const from = s.selectionAnchorId ?? toId
    const fromIndex = orderedIds.indexOf(from)
    const toIndex = orderedIds.indexOf(toId)
    if (toIndex < 0) return s
    // One run of the list, the way the operator sees it: what is between the cue their
    // hand was on and the cue they shift-clicked, inclusive.
    const ids = fromIndex < 0
      ? [toId]
      : orderedIds.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1)
    return { selectedIds: ids, selectedId: toId, selectionAnchorId: from }
  }),

  toggleSelected: (id) => set(s => {
    if (!s.selectedIds.includes(id)) {
      return { selectedIds: [...s.selectedIds, id], selectedId: id, selectionAnchorId: id }
    }
    const selectedIds = s.selectedIds.filter(other => other !== id)
    const active = s.selectedId === id ? selectedIds[selectedIds.length - 1] ?? null : s.selectedId
    return {
      selectedIds,
      selectedId: active,
      selectionAnchorId: s.selectionAnchorId === id ? active : s.selectionAnchorId
    }
  }),

  setWaveformCursor: (cueId, ms) => set({
    waveformCursor: ms === null ? null : { cueId, ms }
  }),

  /**
   * Moves one edge of an audio cue's region, and the cue that continues it when the two
   * meet at that edge.
   *
   * A split leaves a pair that shares a boundary, and a boundary that moves on one side
   * only is a gap or an overlap the operator never asked for — so the two move together,
   * as one edit and one undo. The pairing is read from the times rather than recorded: a
   * cue that starts exactly where this one ends is playing on from it, wherever the pair
   * came from. The edges are held a millisecond apart, because a region of no length is
   * a cue that plays nothing and two grips with no way to pull them apart again.
   */
  setRegionBoundary: (id, edge, ms) => set(s => {
    const cue = s.cues.find(c => c.id === id)
    if (!cue || cue.type !== 'audio') return s
    const filesEnd = Math.max(cue.duration, regionEndMs(cue))
    const cuePatch: Partial<AudioCue> = edge === 'end' ? { endTime: 0 } : { startTime: 0 }
    let target = Math.max(0, Math.min(Math.round(ms), filesEnd))

    // The head stops short of the tail and the tail of the head: whichever edge is being
    // moved, the other one of its own cue wins when they would touch. A region of no
    // length plays nothing, and the two grips would have no way to be pulled apart.
    if (edge === 'start') target = Math.min(target, regionEndMs(cue) - 1)
    else target = Math.max(target, cue.startTime + 1)
    if (edge === 'end') cuePatch.endTime = target
    else cuePatch.startTime = target

    const partner: AudioCue | undefined = s.cues.find((c): c is AudioCue =>
      c.id !== id && c.type === 'audio' && (edge === 'end'
        ? c.startTime === cue.endTime
        : regionEndMs(c) === cue.startTime))
    const partnerPatch: Partial<AudioCue> | null = partner === undefined
      ? null
      : edge === 'end'
        ? { startTime: target }
        : { endTime: target }

    const next = s.cues.map(c => {
      if (c.id === cue.id) return { ...c, ...cuePatch } as Cue
      if (partnerPatch !== null && partner !== undefined && c.id === partner.id) {
        return { ...c, ...partnerPatch } as Cue
      }
      return c
    })
    const unchanged = next.every((c, i) => c === s.cues[i])
    if (unchanged) return s
    return {
      cues: next,
      isDirty: true,
      past: pushPast(s.past, snapshotOf(s)),
      future: []
    }
  }),

  splitAudioCueAt: (id, atMs) => set(s => {
    const cue = s.cues.find(c => c.id === id)
    if (!cue || cue.type !== 'audio') return s
    const split = splitAudioCue(cue, atMs)
    if (split === null) return s

    // The pair is named so that a hand reading the list sees two halves of one thing: the
    // head keeps the name the cue had, and the tail takes the next one along. The cue's
    // own name is not in the set of names to avoid — it is the name the pair is being
    // given, and the head is the half that keeps the cue's identity.
    const names = new Set(s.cues.filter(c => c.id !== id).map(c => c.name))
    const headName = partName(split.baseName, names)
    names.add(headName)
    const tailName = partName(split.baseName, names)

    const tail: AudioCue = {
      ...split.tail,
      id: crypto.randomUUID(),
      number: `${cue.number}b`,
      name: tailName
    }
    const at = s.cues.findIndex(c => c.id === id)
    const cues = [...s.cues]
    cues[at] = { ...split.head, name: headName }
    cues.splice(at + 1, 0, tail)

    // The two halves are what the operator is holding: the boundary is in the waveform,
    // and which half they go on to trim depends on what they saw there.
    return {
      cues,
      selectedIds: [cue.id, tail.id],
      selectedId: tail.id,
      selectionAnchorId: cue.id,
      // The cursor has been spent on the split; where it was is not where the next one
      // should be cut.
      waveformCursor: null,
      isDirty: true,
      past: pushPast(s.past, snapshotOf(s)),
      future: []
    }
  }),

  setRunning: (id, state) => set(s => {
    const running = new Map(s.running)
    if (state === null) running.delete(id)
    else running.set(id, state)
    return { running }
  }),

  clearAllRunning: () => set({ running: new Map() }),

  toggleGroup: (id) => set(s => {
    const collapsed = new Set(s.collapsedGroupIds)
    if (collapsed.has(id)) collapsed.delete(id)
    else collapsed.add(id)
    return { collapsedGroupIds: collapsed }
  }),

  expandTopLevel: () => set(s => {
    const topLevel = new Set(
      s.cues.filter(cue => cue.type === 'group' && cue.parentId === null).map(cue => cue.id)
    )
    return { collapsedGroupIds: new Set([...s.collapsedGroupIds].filter(id => !topLevel.has(id))) }
  }),

  collapseAll: () => set(s => ({
    collapsedGroupIds: new Set(s.cues.filter(cue => cue.type === 'group').map(cue => cue.id))
  })),

  syncCueDuration: (id, durationMs) => set(s => {
    const cue = s.cues.find(c => c.id === id)
    if (!cue || cue.duration === durationMs) return s
    return { cues: s.cues.map(c => c.id === id ? { ...c, duration: durationMs } : c) }
  }),

  syncCueSilence: (id, region) => set(s => {
    const cue = s.cues.find(c => c.id === id)
    if (!cue || cue.type !== 'audio') return s
    const measured = cue.soundRegion
    // The same answer to the same question is written once: a pass woken by an unrelated
    // edit must not replace the object every surface is holding.
    if (
      measured != null &&
      measured.startMs === region.startMs &&
      measured.endMs === region.endMs &&
      measured.durationMs === region.durationMs &&
      measured.silent === region.silent
    ) return s
    return { cues: s.cues.map(c => c.id === id ? { ...c, soundRegion: region } : c) }
  }),

  setLastRun: (id, result) => set(s => ({ lastRuns: { ...s.lastRuns, [id]: result } })),

  appendLog: (entries) => set(s => {
    if (entries.length === 0) return s
    return { log: appendToLog(s.log, entries) }
  }),

  clearLog: () => set({ log: [] }),

  applyShowEvents: (events) => set(s => {
    if (events.length === 0) return s

    const alerts = events.flatMap(event => event.kind === 'alert' ? [event.alert] : [])
    return {
      showEvents: [...s.showEvents, ...events].slice(-SHOW_EVENT_LIMIT),
      showServices: mergeServices(s.showServices, events),
      showDevices: mergeDevices(s.showDevices, events),
      redundancy: latestRedundancy(s.redundancy, events),
      showAlerts: alerts.length === 0
        ? s.showAlerts
        : [...s.showAlerts, ...alerts].slice(-SHOW_ALERT_LIMIT),
      // An alarm the operator did not see is the same as no alarm: it goes to the log
      // as well as the monitor, where it survives the monitor being closed.
      log: alerts.length === 0
        ? s.log
        : appendToLog(s.log, alerts.map(alert => ({
            level: alert.level === 'info' ? 'info' as const : 'error' as const,
            message: alert.message,
            label: alert.source
          })))
    }
  }),

  setShowSnapshot: (snapshot) => set(() => ({
    showServices: snapshot.services,
    showDevices: snapshot.devices,
    showAlerts: snapshot.alerts,
    showEvents: snapshot.events.slice(-SHOW_EVENT_LIMIT),
    // The status comes with whatever decision the machine last made, which is how a
    // window that reloaded just after a takeover learns it has a show to put back on the
    // engine. Acting on one twice is the window's own business, and it counts the
    // sequence to know.
    redundancy: latestRedundancy(null, snapshot.events)
  })),

  setRedundancySettings: (settings) => set({ redundancySettings: settings }),

  dismissAlert: (id) => set(s => ({ showAlerts: s.showAlerts.filter(a => a.id !== id) })),

  clearShowEvents: () => set({ showEvents: [] }),

  setNotice: (message) => set({ notice: message }),

  setMissingMedia: (missingMedia) => set({ missingMedia }),

  applyRelinkedMedia: (paths) => set(s => {
    const resolved = new Map(Object.entries(paths))
    if (resolved.size === 0) return s
    let failures = s.silenceFailures
    const cues = s.cues.map(cue => {
      if (cue.type !== 'audio' || !resolved.has(cue.id)) return cue
      failures = forgetSilenceFailures(failures, [cue.id])
      // A relinked cue is pointed at another file, and another file has not been
      // measured: the measurement pass asks it as soon as the new path is in the cue.
      return patchedCue(cue, { filePath: resolved.get(cue.id)! })
    })
    return {
      cues,
      ...(failures !== s.silenceFailures ? { silenceFailures: failures } : {}),
      isDirty: true,
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
    }
  }),

  setMediaLengths: (answers) => set(s => {
    const next = { ...s.mediaLengths }
    let changed = false
    for (const [cueId, answer] of Object.entries(answers)) {
      if (answer === null) {
        if (cueId in next) { delete next[cueId]; changed = true }
      } else if (next[cueId]?.path !== answer.path || next[cueId]?.state !== answer.state) {
        next[cueId] = answer
        changed = true
      }
    }
    return changed ? { mediaLengths: next } : s
  }),

  setSilenceFailure: (cueId, filePath) => set(s => {
    const current = s.silenceFailures[cueId]
    if (filePath === null) {
      if (current === undefined) return s
      return { silenceFailures: forgetSilenceFailures(s.silenceFailures, [cueId]) }
    }
    if (current === filePath) return s
    return { silenceFailures: { ...s.silenceFailures, [cueId]: filePath } }
  }),

  setLicense: (license) => set({ license }),

  setAudioDeviceError: (audioDeviceError) => set({ audioDeviceError }),

  openSettings: (settingsTab) => set({ settingsTab }),

  closeSettings: () => set({ settingsTab: null }),

  openShowSettings: (showSettingsTab) => set({ showSettingsTab }),

  closeShowSettings: () => set({ showSettingsTab: null }),

  openChanges: (changesTab) => set({ changesTab }),

  closeChanges: () => set({ changesTab: null }),

  setMergeReport: (mergeReport) => set({ mergeReport }),

  markDirty: () => set({ isDirty: true }),

  loadWorkspace: (cues, name, path, audioSettings, midiSettings, showSettings, identity, triggerGuard, history) => set(() => {
    // Where the operator was standing when the file was saved is not in the file; a load
    // starts on the show's first cue.
    const first = cues.find(c => c.parentId === null)?.id ?? cues[0]?.id ?? null
    return {
      cues,
      workspaceName: name,
      workspacePath: path,
      // Loading a file adopts the show's identity; a load without one is a new show.
      workspaceId: identity?.id ?? crypto.randomUUID(),
      workspaceCreatedAt: identity?.createdAt ?? new Date().toISOString(),
      isDirty: false,
      ...(first === null ? NO_SELECTION : selectionFor(first)),
      // A show opens with its groups open: what the last one had folded away is not this
      // one's business.
      collapsedGroupIds: new Set<string>(),
      running: new Map(),
      lastRuns: {},
      notice: null,
      // Whatever the last workspace was missing says nothing about this one; the caller
      // sets this from the open result straight after.
      missingMedia: [],
      // What the last show's files answered says nothing about this one's either.
      mediaLengths: {},
      silenceFailures: {},
      audioSettings: audioSettings ?? { ...defaultAudioSettings },
      midiSettings: midiSettings ?? { ...defaultMidiSettings },
      showSettings: showSettings ?? defaultShowSettings(),
      // A file written before the guard existed has none: the normalizer both fills it in
      // and holds a value typed outside its range to the range.
      triggerGuard: normalizeTriggerGuard(triggerGuard),
      // The file's own record of its saves. A file that has never been saved has none.
      showHistory: history ?? [],
      // Where the last show's cursor sat says nothing about this one.
      waveformCursor: null,
      // Nothing has been told to this show's desk yet.
      deskState: {},
      deskSceneId: null,
      scenesEditing: false,
      past: [],
      future: [],
    }
  }),

  saveSucceeded: (path, name, history) => set({
    workspacePath: path,
    workspaceName: name,
    // The history the file was just written with, including the entry this save added.
    // Carrying it means the next save appends to a history instead of replacing one.
    showHistory: history,
    isDirty: false
  }),

  setWorkspaceName: (name) => set({ workspaceName: name, isDirty: true }),

  updateAudioSettings: (patch) => set(s => ({
    audioSettings: { ...s.audioSettings, ...patch },
    isDirty: true
  })),

  updateMidiSettings: (patch) => set(s => ({
    midiSettings: { ...s.midiSettings, ...patch },
    isDirty: true
  })),

  updateTriggerGuard: (patch) => set(s => ({
    triggerGuard: normalizeTriggerGuard({ ...s.triggerGuard, ...patch }),
    isDirty: true
  })),

  updateOscInSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, oscIn: { ...s.showSettings.oscIn, ...patch } },
    isDirty: true
  })),

  updateMidiInSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, midiIn: { ...s.showSettings.midiIn, ...patch } },
    isDirty: true
  })),

  // The plot is edited in a handful of places and is stored whole, so a patch is either a
  // change to the plot or a change to the settings around it. Only the plot is an edit an
  // operator would want back; a battery threshold is a preference, not a mistake.
  updateRfSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, rf: { ...s.showSettings.rf, ...patch } },
    past: 'plot' in patch ? pushPast(s.past, snapshotOf(s)) : s.past,
    future: 'plot' in patch ? [] : s.future,
    isDirty: true
  })),

  updatePresenceSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, presence: { ...s.showSettings.presence, ...patch } },
    isDirty: true
  })),

  updateScriptSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, script: { ...s.showSettings.script, ...patch } },
    isDirty: true
  })),

  updateCompanionSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, companion: { ...s.showSettings.companion, ...patch } },
    isDirty: true
  })),

  // Where the desk is travels with the show, and pointing it at the wrong address is a
  // press away from being undone.
  updateDeskSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, desk: { ...s.showSettings.desk, ...patch } },
    past: pushPast(s.past, snapshotOf(s)),
    future: [],
    isDirty: true
  })),

  // Scenes and who is open in them are the grid's work, so a delete or a stray cell is
  // one undo away from being back.
  updateScenesSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, scenes: { ...s.showSettings.scenes, ...patch } },
    past: 'list' in patch ? pushPast(s.past, snapshotOf(s)) : s.past,
    future: 'list' in patch ? [] : s.future,
    isDirty: true
  })),

  // The cast — the channels, the performers and the ensembles — is edited in a handful
  // of places, same as the scene list, and every list in it is one undo away: the DCAs
  // are the only part of the setup that a stray press cannot ruin, because they are
  // resized by a count rather than edited row by row.
  updateCastSettings: (patch) => set(s => {
    const record = 'performers' in patch || 'ensembles' in patch ||
      'channels' in patch || 'dcas' in patch
    return {
      showSettings: { ...s.showSettings, cast: { ...s.showSettings.cast, ...patch } },
      past: record ? pushPast(s.past, snapshotOf(s)) : s.past,
      future: record ? [] : s.future,
      isDirty: true
    }
  }),

  // Two sections change as one edit: the ensemble goes, and every scene that had it
  // applied no longer does.
  removeEnsemble: (ensembleId) => set(s => ({
    showSettings: {
      ...s.showSettings,
      cast: removeEnsembleFromCast(s.showSettings.cast, ensembleId),
      scenes: removeEnsembleFromScenes(s.showSettings.scenes, ensembleId)
    },
    past: pushPast(s.past, snapshotOf(s)),
    future: [],
    isDirty: true
  })),

  // Who is in the new ensemble is who is open in the scene it is made from, which is the
  // one thing the operator is looking at when they press it.
  addEnsembleFromScene: (sceneId) => set(s => {
    const scene = s.showSettings.scenes.list.find(candidate => candidate.id === sceneId)
    if (scene === undefined) return s

    const members = sceneLiveIds(scene, s.showSettings.cast.ensembles)
    const cast = addEnsemble(s.showSettings.cast, '', members)
    const ensemble = cast.ensembles[cast.ensembles.length - 1]
    return {
      showSettings: {
        ...s.showSettings,
        cast,
        scenes: setEnsembleApplied(s.showSettings.scenes, sceneId, ensemble, true)
      },
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
      isDirty: true
    }
  }),

  // Three sections change as one edit: the pack they wore is released (a swap in its
  // own right), the cast drops them, and any scene that had them open no longer does.
  removePerformer: (performerId) => set(s => {
    const at = Date.now()
    const release = releasePerformerPacks(
      s.showSettings.rf.plot,
      s.showSettings.cast.performers,
      performerId,
      at
    )
    const log = release.swaps.length === 0
      ? s.log
      : appendToLog(s.log, release.swaps.map(swap => ({
          level: 'info' as const,
          label: 'RF',
          message: `Swap: ${describeSwap(swap)}`
        })))
    return {
      showSettings: {
        ...s.showSettings,
        rf: {
          ...s.showSettings.rf,
          plot: release.plot,
          swaps: recordSwaps(s.showSettings.rf.swaps, release.swaps)
        },
        cast: removePerformerFromCast(s.showSettings.cast, performerId),
        scenes: removePerformerFromScenes(s.showSettings.scenes, performerId)
      },
      log,
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
      isDirty: true
    }
  }),

  setDeskState: (deskState, deskSceneId) => set({ deskState, deskSceneId }),

  setScenesEditing: (scenesEditing) => set({ scenesEditing }),

  pushModal: () => set(s => ({ modals: s.modals + 1 })),

  popModal: () => set(s => ({ modals: Math.max(0, s.modals - 1) }))
}))

export function useSelectedCue(): Cue | null {
  return useStore(s => s.cues.find(c => c.id === s.selectedId) ?? null)
}

/**
 * Whether this machine is licensed, which is what decides if the Pro surfaces are
 * drawn at all. Read through the store rather than from the main process directly so
 * that a surface and its gate agree within a frame.
 */
export function usePro(): boolean {
  return useStore(s => s.license.state === 'active')
}

// Returns the GroupCue that owns the given cue, or null.
export function useParentGroup(cueId: string): GroupCue | null {
  return useStore(s => {
    const cue = s.cues.find(c => c.id === cueId)
    if (!cue?.parentId) return null
    const parent = s.cues.find(c => c.id === cue.parentId)
    return parent?.type === 'group' ? (parent as GroupCue) : null
  })
}
