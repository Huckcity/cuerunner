import { create } from 'zustand'
import type { Cue, CueType, AudioCue, GroupCue, OscPatch, SoundRegion } from '../../../shared/cue'
import { withPatch } from '../../../shared/cueTargets'
import { heldOscPatches } from '../../../shared/oscPatches'
import type { MissingMedia } from '../../../shared/media'
import type { ShowHistoryEntry } from '../../../shared/showfile'
import type { MergeNote, MergeTally } from '../../../shared/showfileMerge'
import type { AudioSettings, LoadNote, MidiSettings, TriggerGuardSettings, WorkspaceIdentity } from '../../../shared/workspace'
import { DEFAULT_TRIGGER_GUARD, normalizeTriggerGuard, UNTITLED_SHOW } from '../../../shared/workspace'
import { MAX_OUTPUTS, carriesMediaFile, createOutput, normalizeVideoOutputs, type VideoOutput } from '../../../shared/visual'
import { defaultShowSettings } from '../../../shared/show'
import type { RedundancySettings, RedundancyStatus } from '../../../shared/redundancy'
import type {
  CastSettings,
  CompanionSettings,
  DeskSettings,
  DeviceState,
  DeviceEvent,
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
} from '../../../shared/show'
import { createCue, nextCueNumber } from '../utils/cueDefaults'
import { partName, regionEndMs, splitAudioCue } from '../utils/cueSplit'
import type { MediaLengthAnswer } from '../utils/mediaLength'
import {
  addEnsemble,
  updateEnsemble,
  removeChannel as removeChannelFromCast,
  removeEnsemble as removeEnsembleFromCast,
  removePerformerFromCast,
  setChannelCount as setChannelCountInCast,
  setDcaCount as setDcaCountInCast
} from '../utils/cast'
import {
  forgetChannels,
  forgetDcas,
  removeChannelsFromScenes,
  removeDcasFromScenes,
  removeEnsembleFromScenes,
  setRowMember,
  UNKNOWN_DESK_STATE,
  type DeskState
} from '../utils/scenes'
import { describeSwap, recordSwaps, releasePerformerPacks } from '../utils/rfPlot'
import { incidentsFrom, MAX_INCIDENTS } from '../utils/rfIncidents'
import type { RfIncident } from '../utils/rfIncidents'
import { liveCue } from '../utils/liveCue'
import type { LicenseStatus } from '../../../shared/license'
import { defaultLightingSettings, heldLighting, type LightingSettings } from '../../../shared/dmx'
import {
  defaultTimecodeShowSettings,
  heldTimecode,
  normalizeTimecodeShowSettings,
  type TimecodeShowSettings
} from '../../../shared/timecode'

export type RunState = 'idle' | 'pre-wait' | 'playing' | 'post-wait' | 'paused'

/**
 * The tabs the settings dialog has. `license` is the machine's own settings rather
 * than the workspace's, which is why the dialog can be opened straight onto it.
 */
export type SettingsTab = 'general' | 'audio' | 'midi' | 'network' | 'wireless' | 'redundancy' | 'license' | 'timecode'

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
  /**
   * Where the line came from when it is not the window's own: a failure main reported, which
   * main writes to the log file itself, so the window does not write it a second time.
   */
  origin?: 'main'
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
  /**
   * Adds a cue after `afterId` (inside it, when that is a group), and selects it. `initial`
   * is what the cue is born with beyond its type's defaults — a fade made from a selected
   * cue is born aimed at it — so the add is one edit and one undo, rather than an add and
   * then a change to the cue that was just added.
   */
  addCue: (type: CueType, afterId?: string, initial?: Partial<Cue>) => void
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
  /**
   * Writes a patch of its own to each cue as a single edit — a batch edit whose fields do not
   * apply to every cue in the set (a volume to the audio cues and not to the waits).
   */
  patchCues: (patches: Record<string, Partial<Cue>>) => void
  /**
   * Puts a block of new cues — a group and its children, already in order — into the list as
   * one edit, and selects the first of them: at the top level after the top-level cue that
   * holds `afterId`, or in front of the cue at a flat index (`cues.length` is the end), where
   * a drop put it with the parent it gave the block's first cue.
   */
  insertCues: (block: Cue[], at: string | null | { beforeIndex: number }) => void

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
  setRegionBoundary: (id: string, edge: 'start' | 'end', ms: number, dragging?: boolean) => void

  /** The region grip has been let go, so the next drag of it opens a new edit. */
  endRegionDrag: () => void

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

  /**
   * The lighting rig: workspace content, so an edit dirties the show and enters undo with the
   * cue list it is read beside. The levels on the rig are not here — they are the lighting
   * engine's, in main — only what the show says the rig is.
   */
  lighting: LightingSettings
  setLighting: (next: LightingSettings) => void

  /**
   * How the show follows an incoming SMPTE clock: chase, what the cues do when it stops, the
   * offset, the rate it is read at. Workspace content — it travels in the file — so an edit
   * dirties the show and enters undo. Where the clock arrives is the machine's, not here.
   */
  timecode: TimecodeShowSettings
  setTimecode: (patch: Partial<TimecodeShowSettings>) => void

  /**
   * The show's video outputs (src/shared/visual.ts). Workspace content: what each output is
   * travels with the show; where it is on this machine does not (main keeps that).
   */
  videoOutputs: VideoOutput[]
  /** Adds an output named for its place in the list, and answers its id. */
  addVideoOutput: () => string
  updateVideoOutput: (id: string, patch: Partial<Omit<VideoOutput, 'id'>>) => void
  removeVideoOutput: (id: string) => void

  /**
   * The show's named OSC destinations: workspace content, so an edit dirties the show and
   * enters undo with the cues whose messages name them.
   */
  oscPatches: OscPatch[]
  setOscPatches: (next: OscPatch[]) => void

  // Show services. Everything here is reported by the main process and rendered by the
  // monitor panel: what is listening, what is on stage, and what has gone wrong. None
  // of it is workspace content, so none of it dirties the show or enters undo.
  showSettings: ShowSettings
  showServices: ServiceStatus[]
  showDevices: DeviceState[]
  showAlerts: ShowAlert[]
  /**
   * What went wrong with a pack this session, and what was playing when it did: the report's
   * answer to "when". Session state — it is the night, not the show — and it starts over with the
   * app, like the service's own count of dropouts that it explains.
   */
  rfIncidents: RfIncident[]
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
   * Grouping repairs the loaded workspace needed, with the cue each is about. The file
   * on disk does not hold them yet — loading never writes — so this is what tells the
   * operator the grouping on screen is not what they saved. A successful save writes
   * the repair and ends the condition, which clears them.
   */
  loadNotes: LoadNote[]
  setLoadNotes: (notes: LoadNote[]) => void
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
  /** The Report a Problem dialog is open. */
  reportOpen: boolean
  openReport: () => void
  closeReport: () => void
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
   * Drops an ensemble and empties every row that held it, as one edit: a scene still
   * pointing at an ensemble that is gone is a row of mics nobody can open or close from the
   * grid again.
   */
  removeEnsemble: (ensembleId: string) => void

  /**
   * Saves the ensemble the builder is holding, and puts it on the row it was opened from.
   * One edit rather than two: an ensemble built from a row and not put on it is a grouping
   * that disappears the moment the operator looks away from the grid.
   *
   * `ensembleId` is the group being edited, or null for a new one — the builder is the only
   * place a group is named and filled now, so it is both of those — and `channelIds` are the
   * strips it holds, which is what the builder shows and what the row will open.
   */
  saveEnsembleOnRow: (
    sceneId: string,
    dcaId: string,
    ensembleId: string | null,
    name: string,
    channelIds: string[]
  ) => void
  /**
   * Drops a performer from the cast: released from every pack they wore, each a swap of its
   * own. The plot and its history are one section and change as one edit, because a pack
   * still pointing at somebody who is gone is a name that no longer means anything. What the
   * scenes and the groups say is untouched: they name strips, and the strip stays on the
   * console after the person has left it.
   */
  removePerformer: (performerId: string) => void
  /**
   * Drops a strip from the console: out of the cast and out of every scene's placements,
   * as one edit, because a placement naming a channel that is gone is a cell that can never
   * be read again.
   */
  removeChannel: (channelId: string) => void

  /**
   * How many strips the console has, as one edit: the list, whoever was patched to the
   * strips that went, and every scene's placements of them. One edit because the halves are
   * a single decision — a show that was set up too large is corrected by one count, and half
   * an undo of that would put the strips back under scenes that no longer place them.
   */
  setChannelCount: (count: number) => void
  /**
   * How many faders the show drives, the same way: shrinking drops the last ones off and
   * takes every scene's rows for those places with them, so no scene names a fader the show
   * no longer has. A fader grown back is a new place and comes back empty.
   */
  setDcaCount: (count: number) => void

  // Where the desk was left. Session state, not workspace content: a show that has just
  // loaded has not told the desk anything yet, and saying otherwise would stop the first
  // recall from sending what it needs to. Two facts per controlled channel — the mic's mute
  // and the faders it was written onto — because a recall is a diff against both, and the
  // desk that would answer for either one does not answer here: the base is what Cuerunner
  // last sent.
  deskState: DeskState
  deskSceneId: string | null
  setDeskState: (deskState: DeskState, deskSceneId: string | null) => void

  /**
   * Writes the facts one recall actually moved onto the record as it stands, rather than
   * publishing the whole record it read at the start of the sends: two recalls in flight at
   * once — two scene cues at one timeline offset, a batch of triggers — would otherwise lose
   * one another's writes, and a channel recorded as muted while it is open on the desk is
   * never told anything again. The scene id is left alone unless one is given, so a recall
   * can record its facts as they land and name its scene at the end.
   */
  mergeDeskState: (patch: Partial<DeskState>, deskSceneId?: string | null) => void

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
    history?: ShowHistoryEntry[],
    lighting?: LightingSettings,
    timecode?: TimecodeShowSettings,
    videoOutputs?: VideoOutput[],
    oscPatches?: OscPatch[]
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
  scenes: ScenesSettings
  cast: CastSettings
  desk: DeskSettings
  plot: RfPlot
  lighting: LightingSettings
  timecode: TimecodeShowSettings
  videoOutputs: VideoOutput[]
  oscPatches: OscPatch[]
}

function snapshotOf(state: CueListState): EditSnapshot {
  return {
    cues: state.cues,
    scenes: state.showSettings.scenes,
    cast: state.showSettings.cast,
    desk: state.showSettings.desk,
    plot: state.showSettings.rf.plot,
    lighting: state.lighting,
    timecode: state.timecode,
    videoOutputs: state.videoOutputs,
    oscPatches: state.oscPatches
  }
}

/** The show settings an undo puts back, leaving the rest of them where they are. */
function restoreSettings(showSettings: ShowSettings, snapshot: EditSnapshot): ShowSettings {
  return {
    ...showSettings,
    scenes: snapshot.scenes,
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
// The region grip whose drag is in progress ("<cueId>:<edge>"), so the moves of one drag
// fold into the single edit it opened.
let _regionGrip: string | null = null

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
  // A field the patch names as undefined is taken off the cue rather than left on it as
  // undefined: that is how an edit moves a cue from one spelling of a field to another — a
  // fade's single legacy target to its list (`fadeTargetsPatch`) — without carrying both.
  const next = withPatch(cue, patch) as Cue
  // Only an audio cue has a file to point somewhere else, and only a measurement has a
  // file to belong to.
  const was = cue.type === 'audio' ? cue : null
  if (next.type === 'audio' && 'filePath' in patch && patch.filePath !== was?.filePath) {
    // The route pair the cue was read with names the file it no longer plays, and a pair
    // is read before the cue's own path: keeping it would resolve a recovered session to
    // the file the cue was moved off, and a save would write that route back. The path
    // the cue holds now is the one to write a route from, which is what saving does for
    // a cue that never carried a pair.
    delete (next as unknown as Record<string, unknown>).media
    // The scan and the length both came back from the file that answered, so neither
    // outlives it — unless the patch carries the new file's own length with it, which is
    // what the inspector's file pick does. A length left from the last file is a row, a
    // group sum and a timeline width that all describe a different take, and nothing
    // would ever ask again: `mediaLengthState` reads a length as measured. An empty
    // length is what puts the cue back in the measurement pass.
    next.soundRegion = null
    if (!('duration' in patch)) next.duration = 0
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

/**
 * The cue a removal leaves in the removed cue's place: the first one after it that is still
 * in the show and on screen, or failing that the last one before it. Null when the show is
 * empty. A cue folded away under a collapsed group is passed over — a selection nobody can
 * see is not somewhere to leave the operator's hand.
 */
function neighbourOfRemoved(
  cues: Cue[],
  removed: ReadonlySet<string>,
  removedId: string,
  collapsed: ReadonlySet<string>
): string | null {
  const at = cues.findIndex(cue => cue.id === removedId)
  if (at < 0) return null
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  const onScreen = (cue: Cue): boolean => {
    if (removed.has(cue.id)) return false
    const seen = new Set<string>()
    for (let parent = cue.parentId; parent !== null && !seen.has(parent); parent = byId.get(parent)?.parentId ?? null) {
      if (collapsed.has(parent)) return false
      seen.add(parent)
    }
    return true
  }
  for (let i = at + 1; i < cues.length; i++) if (onScreen(cues[i])) return cues[i].id
  for (let i = at - 1; i >= 0; i--) if (onScreen(cues[i])) return cues[i].id
  return null
}

export const useStore = create<CueListState>((set) => ({
  workspaceName: UNTITLED_SHOW,
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
  lighting: defaultLightingSettings(),
  timecode: defaultTimecodeShowSettings(),
  videoOutputs: [],
  oscPatches: [],
  showServices: [],
  showDevices: [],
  showAlerts: [],
  rfIncidents: [],
  showEvents: [],
  redundancy: null,
  redundancySettings: null,
  deskState: UNKNOWN_DESK_STATE,
  deskSceneId: null,
  scenesEditing: false,
  modals: 0,
  audioDeviceError: null,
  notice: null,
  missingMedia: [],
  loadNotes: [],
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
  reportOpen: false,
  mergeReport: null,

  addCue: (type, afterId, initial) => set(s => {
    const cue = { ...createCue(type, nextCueNumber(s.cues)), ...initial } as Cue
    // Adding a cue is the one moment the show's answer to trimming silence is read: the
    // setting is a default for new cues, never a switch over the ones already in the
    // list, so turning it off does not rewrite the show behind the operator.
    if (cue.type === 'audio') cue.trimSilence = s.audioSettings.autoTrimSilence === true
    const cues = [...s.cues]

    let insertIdx: number
    if (!afterId) {
      insertIdx = cues.length
    } else {
      const afterIdx = cues.findIndex(c => c.id === afterId)
      const afterCue = afterIdx >= 0 ? cues[afterIdx] : undefined
      if (afterCue?.type === 'group') {
        // Inserting after a group header → becomes its last child
        cue.parentId = afterId
        insertIdx = subtreeEndIndex(cues, afterIdx) + 1
      } else {
        // Inserting after a regular cue or group child → inherit context. After a nested
        // group header that means past its whole subtree, or the new sibling would split
        // the header from its children.
        cue.parentId = afterCue?.parentId ?? null
        insertIdx = afterIdx < 0 ? 0 : subtreeEndIndex(cues, afterIdx) + 1
      }
    }

    cues.splice(insertIdx, 0, cue)
    return { cues, ...selectionFor(cue.id), isDirty: true, past: pushPast(s.past, snapshotOf(s)), future: [] }
  }),

  addAudioCuesFromFiles: (files, afterId) => set(s => {
    // A drop of nothing is nothing: the selection helper below needs a cue to point at,
    // and an empty list has none.
    if (files.length === 0) return s
    const cues = [...s.cues]
    let insertIdx: number
    let parentId: string | null = null

    if (!afterId) {
      insertIdx = cues.length
    } else {
      const afterIdx = cues.findIndex(c => c.id === afterId)
      const afterCue = afterIdx >= 0 ? cues[afterIdx] : undefined
      if (afterCue?.type === 'group') {
        parentId = afterId
        insertIdx = subtreeEndIndex(cues, afterIdx) + 1
      } else {
        parentId = afterCue?.parentId ?? null
        insertIdx = afterIdx < 0 ? 0 : subtreeEndIndex(cues, afterIdx) + 1
      }
    }

    // One count for the whole drop: the files take the next numbers in the order they
    // were dropped, starting one past what the show already uses.
    const firstNumber = Number(nextCueNumber(s.cues))
    const newCues: Cue[] = files.map(({ filePath, name }, index) => ({
      ...(createCue('audio', String(firstNumber + index)) as AudioCue),
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
    // Everything the operator was holding has gone: the hand comes to rest on the cue that
    // took its place. Left on nothing, the next Delete did nothing and the next GO fired
    // the first cue of the show — from wherever in it the operator had been working.
    const heldIsGone = selectedIds.length === 0 && s.selectedId !== null && removed.has(s.selectedId)
    const neighbour = heldIsGone ? neighbourOfRemoved(s.cues, removed, s.selectedId!, s.collapsedGroupIds) : null
    if (neighbour !== null) {
      return {
        cues: s.cues.filter(c => !removed.has(c.id)),
        ...selectionFor(neighbour),
        lastRuns: Object.fromEntries(
          Object.entries(s.lastRuns).filter(([cueId]) => !removed.has(cueId))
        ),
        isDirty: true,
        past: pushPast(s.past, snapshotOf(s)),
        future: [],
      }
    }
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

  patchCues: (patches) => set(s => {
    const ids = Object.keys(patches).filter(id => s.cues.some(cue => cue.id === id))
    if (ids.length === 0) return s
    const retargeted = ids.filter(id => cueRetargeted(s.cues, id, patches[id]))
    return {
      cues: s.cues.map(c => c.id in patches ? patchedCue(c, patches[c.id]) : c),
      ...(retargeted.length > 0
        ? { silenceFailures: forgetSilenceFailures(s.silenceFailures, retargeted) }
        : {}),
      isDirty: true,
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
    }
  }),

  insertCues: (block, at) => set(s => {
    if (block.length === 0) return s
    const cues = [...s.cues]
    let insertIdx: number
    if (at !== null && typeof at === 'object') {
      insertIdx = Math.min(Math.max(at.beforeIndex, 0), cues.length)
    } else {
      // The block goes after the top-level cue that holds `at`, past its whole subtree:
      // inside a group it would become part of what it acts on.
      let anchor = at === null ? -1 : cues.findIndex(c => c.id === at)
      while (anchor >= 0 && cues[anchor].parentId !== null) {
        const parentId = cues[anchor].parentId
        anchor = cues.findIndex(c => c.id === parentId)
      }
      insertIdx = anchor < 0 ? cues.length : subtreeEndIndex(cues, anchor) + 1
    }
    cues.splice(insertIdx, 0, ...block)
    return { cues, ...selectionFor(block[0].id), isDirty: true, past: pushPast(s.past, snapshotOf(s)), future: [] }
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
    // The copies that answer the cues asked for, as opposed to the children that came
    // along with a group: these are what the operator is left holding.
    const asked = new Set<string>()
    for (const id of ids) {
      const srcIdx = s.cues.findIndex(c => c.id === id)
      if (srcIdx < 0) continue
      const src = s.cues[srcIdx]
      const newGroupId = crypto.randomUUID()

      const copies: Cue[] = [{
        ...src,
        id: src.type === 'group' ? newGroupId : crypto.randomUUID()
      }]
      asked.add(copies[0].id)
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
      // A group's copies land after its subtree, and that index can coincide with a
      // descendant's own: accumulate rather than overwrite, or selecting a group and
      // its last child duplicates only the child.
      const at = src.type === 'group' ? subtreeEndIndex(s.cues, srcIdx) : srcIdx
      insertAfter.set(at, [...(insertAfter.get(at) ?? []), ...copies])
    }
    if (insertAfter.size === 0) return s

    // A copy is a new cue, so it is numbered as one: the next free number, counted down
    // the list in the order the copies land in it. A copy used to take its original's
    // number with " copy" after it — which no row had the width to draw, and which a
    // second duplicate made "copy copy" — and a group's children took their originals'
    // numbers unchanged, so duplicating a group left the show with two of each.
    let nextNumber = Number(nextCueNumber(s.cues))
    const cues: Cue[] = []
    const copied: string[] = []
    s.cues.forEach((cue, index) => {
      cues.push(cue)
      const copies = insertAfter.get(index)
      if (copies === undefined) return
      for (const copy of copies) {
        cues.push({ ...copy, number: String(nextNumber++) })
        if (asked.has(copy.id)) copied.push(copy.id)
      }
    })

    // The copies are what the operator is holding now: a second press duplicates them
    // again rather than the originals. A group's copy is held by its header, as the group
    // it was copied from was — with its children in the set as well, that second press
    // duplicated each of them inside the first copy besides duplicating the group.
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
      lighting: snapshot.lighting,
      timecode: snapshot.timecode,
      videoOutputs: snapshot.videoOutputs,
      oscPatches: snapshot.oscPatches,
      past,
      future: [snapshotOf(s), ...s.future.slice(0, HISTORY_LIMIT - 1)],
      // An undo after a save moves the cues away from the file's bytes: the session is
      // dirty again, or the close prompt and autosave stand down over unsaved work.
      isDirty: true
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
      lighting: snapshot.lighting,
      timecode: snapshot.timecode,
      videoOutputs: snapshot.videoOutputs,
      oscPatches: snapshot.oscPatches,
      future,
      past: pushPast(s.past, snapshotOf(s)),
      // A redo after a save is an edit like any other: it leaves the file behind.
      isDirty: true
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
    // hand was on and the cue they shift-clicked, inclusive. An anchor the list does not
    // hold — a child of a group that has been collapsed since — has no run to give, so
    // the click is a fresh selection and the anchor moves to it: leaving the anchor off
    // the list would make every later shift-click a plain selection.
    const ids = fromIndex < 0
      ? [toId]
      : orderedIds.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1)
    return { selectedIds: ids, selectedId: toId, selectionAnchorId: fromIndex < 0 ? toId : from }
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
  setRegionBoundary: (id, edge, ms, dragging = false) => set(s => {
    const cue = s.cues.find(c => c.id === id)
    if (!cue || cue.type !== 'audio') return s
    const filesEnd = Math.max(cue.duration, regionEndMs(cue))
    const cuePatch: Partial<AudioCue> = edge === 'end' ? { endTime: 0 } : { startTime: 0 }

    // The cue that continues this one at the edge being moved, when the two meet there.
    // Read from the times as they stand, before this move: the pairing is what the two
    // cues were, not what they are about to be. The pair moves as one, so this cue's
    // target is also bounded by the far edge of the other one — dragging the head past
    // the tail's end would write a region that runs backwards, which plays nothing.
    const partner: AudioCue | undefined = s.cues.find((c): c is AudioCue =>
      c.id !== id && c.type === 'audio' && c.filePath === cue.filePath && (edge === 'end'
        ? c.startTime === cue.endTime
        : regionEndMs(c) === cue.startTime))

    // Whichever edge is being moved, the cue's own other edge wins when they would
    // touch: a region of no length plays nothing, and the two grips would have no way
    // to be pulled apart again.
    const floor = edge === 'end'
      ? cue.startTime + 1
      : partner ? partner.startTime + 1 : 0
    const ceiling = edge === 'start'
      ? regionEndMs(cue) - 1
      : partner ? regionEndMs(partner) - 1 : Infinity
    const target = Math.max(floor, Math.min(Math.round(ms), filesEnd, ceiling))

    if (edge === 'end') cuePatch.endTime = target
    else cuePatch.startTime = target

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
    // One edit per drag: the grip reports every pointer move, and they all belong to the
    // entry the first one opened. `endRegionDrag` says the pen is up; a move that is not
    // part of a drag — the keyboard, a caller that never says — is its own edit.
    const grip = `${cue.id}:${edge}`
    const record = !dragging || _regionGrip !== grip
    _regionGrip = dragging ? grip : null
    if (unchanged) return s
    return {
      cues: next,
      isDirty: true,
      future: [],
      ...(record ? { past: pushPast(s.past, snapshotOf(s)) } : {})
    }
  }),

  endRegionDrag: () => { _regionGrip = null },

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
      name: tailName,
      // On a timeline the pair has to be placed as well as cut: the children are fired
      // at their own offsets, so a tail left at the head's offset would play the second
      // half of the file over the first. It takes up where the head's sound reaches the
      // cut — the head's offset plus its own region before the cut.
      timelineOffset: cue.parentId === null
        ? split.tail.timelineOffset
        : cue.timelineOffset + Math.max(0, atMs - cue.startTime)
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
    // A pack going quiet is noted against what is playing now: only the window knows that.
    const playing = liveCue(s.cues, s.running)
    const incidents = incidentsFrom(
      s.showDevices,
      events,
      s.showSettings.rf.thresholds,
      playing === null ? null : { number: playing.number, name: playing.name }
    )
    return {
      rfIncidents: incidents.length === 0 ? s.rfIncidents : [...s.rfIncidents, ...incidents].slice(-MAX_INCIDENTS),
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

  setLoadNotes: (loadNotes) => set({ loadNotes }),

  applyRelinkedMedia: (paths) => set(s => {
    const resolved = new Map(Object.entries(paths))
    if (resolved.size === 0) return s
    let failures = s.silenceFailures
    const cues = s.cues.map(cue => {
      if (!carriesMediaFile(cue) || !resolved.has(cue.id)) return cue
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

  openReport: () => set({ reportOpen: true }),

  closeReport: () => set({ reportOpen: false }),

  closeChanges: () => set({ changesTab: null }),

  setMergeReport: (mergeReport) => set({ mergeReport }),

  markDirty: () => set({ isDirty: true }),

  loadWorkspace: (cues, name, path, audioSettings, midiSettings, showSettings, identity, triggerGuard, history, lighting, timecode, videoOutputs, oscPatches) => set(() => {
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
      // The same for what the last one's grouping needed repaired.
      loadNotes: [],
      // What the last show's files answered says nothing about this one's either.
      mediaLengths: {},
      silenceFailures: {},
      audioSettings: audioSettings ?? { ...defaultAudioSettings },
      midiSettings: midiSettings ?? { ...defaultMidiSettings },
      showSettings: showSettings ?? defaultShowSettings(),
      // A file written before the guard existed has none: the normalizer both fills it in
      // and holds a value typed outside its range to the range.
      triggerGuard: normalizeTriggerGuard(triggerGuard),
      // A show with no lights opens with an empty rig.
      lighting: heldLighting(lighting),
      // A show that says nothing about timecode follows it with the defaults.
      timecode: heldTimecode(timecode),
      // A show with no outputs has none; one that has them has them held to their ranges.
      videoOutputs: normalizeVideoOutputs(videoOutputs),
      // A show with no OSC patches opens with none.
      oscPatches: heldOscPatches(oscPatches),
      // The file's own record of its saves. A file that has never been saved has none.
      showHistory: history ?? [],
      // Where the last show's cursor sat says nothing about this one.
      waveformCursor: null,
      // Nothing has been told to this show's desk yet.
      deskState: UNKNOWN_DESK_STATE,
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
    // The file on disk now holds the repaired grouping the notes described, so the
    // condition they reported — and the "unchanged on disk" copy that went with it —
    // has ended.
    loadNotes: [],
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

  setLighting: (lighting) => set(s => ({
    lighting,
    isDirty: true,
    past: pushPast(s.past, snapshotOf(s)),
    future: []
  })),

  setTimecode: (patch) => set(s => ({
    timecode: normalizeTimecodeShowSettings({ ...s.timecode, ...patch }),
    isDirty: true,
    past: pushPast(s.past, snapshotOf(s)),
    future: []
  })),

  addVideoOutput: () => {
    const id = crypto.randomUUID()
    set(s => ({
      videoOutputs: s.videoOutputs.length >= MAX_OUTPUTS
        ? s.videoOutputs
        : [...s.videoOutputs, createOutput(id, `Output ${s.videoOutputs.length + 1}`)],
      isDirty: true,
      past: pushPast(s.past, snapshotOf(s)),
      future: []
    }))
    return id
  },

  updateVideoOutput: (id, patch) => set(s => ({
    // Held to the ranges a file is: an edit in the panel can no more set a corner off the
    // output than a hand-edited file can.
    videoOutputs: normalizeVideoOutputs(s.videoOutputs.map(output => output.id === id ? { ...output, ...patch, id } : output)),
    isDirty: true,
    past: pushPast(s.past, snapshotOf(s)),
    future: []
  })),

  removeVideoOutput: (id) => set(s => ({
    videoOutputs: s.videoOutputs.filter(output => output.id !== id),
    isDirty: true,
    past: pushPast(s.past, snapshotOf(s)),
    future: []
  })),

  setOscPatches: (oscPatches) => set(s => ({
    oscPatches,
    isDirty: true,
    past: pushPast(s.past, snapshotOf(s)),
    future: []
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

  // Placements and scene names are the grid's work, so a delete or a stray press is one
  // undo away from being back. The duplicate rule travels with the list rather than beside
  // it: it decides what an edit does, so half an undo of it would be a lie.
  updateScenesSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, scenes: { ...s.showSettings.scenes, ...patch } },
    past: pushPast(s.past, snapshotOf(s)),
    future: [],
    isDirty: true
  })),

  // The cast — the channels, the performers and the ensembles — is edited in a handful
  // of places, same as the scene list, and every list in it is one undo away. The two
  // lists that are sized by a count rather than edited row by row — the strips and the
  // faders — have actions of their own instead, because a shrink takes what named the
  // places that went with it.
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

  // Two sections change as one edit: the ensemble goes, and every row that had it applied
  // no longer does. Its members' channels keep whatever the rows placed by hand.
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

  // The cast and the scenes as one edit: dropping the strip and leaving a placement naming
  // it behind would be a cell nobody can read again.
  removeChannel: (channelId) => set(s => ({
    showSettings: {
      ...s.showSettings,
      cast: removeChannelFromCast(s.showSettings.cast, channelId),
      scenes: removeChannelsFromScenes(s.showSettings.scenes, [channelId])
    },
    // The desk record goes with it: what Cuerunner was last told it wrote about this strip
    // is a fact about nothing once the show has no such strip.
    deskState: forgetChannels(s.deskState, [channelId]),
    past: pushPast(s.past, snapshotOf(s)),
    future: [],
    isDirty: true
  })),

  // The count reshapes the list, so everything that was true of the strips that went has to
  // stop being: their mics are unpatched by the count itself and their placements leave
  // every scene here, in the same edit. A count re-chosen at its own value is not an edit at
  // all — no new state, no history line, and the show stays as clean as it was.
  setChannelCount: (count) => set(s => {
    const cast = s.showSettings.cast
    const next = setChannelCountInCast(cast, count)
    if (next === cast) return s

    // Only a shrink drops anything, and what it drops is the tail: a grow's empty list
    // leaves every scene exactly where it was.
    const dropped = cast.channels.slice(next.channels.length).map(channel => channel.id)
    return {
      showSettings: {
        ...s.showSettings,
        cast: next,
        scenes: removeChannelsFromScenes(s.showSettings.scenes, dropped)
      },
      // And the record of what the desk was told about the strips that went, for the same
      // reason the scenes are pruned in this edit: nothing can write them again.
      deskState: forgetChannels(s.deskState, dropped),
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
      isDirty: true
    }
  }),

  // One rule for both counts: whichever list shrinks, the places that went leave every
  // scene's rows in the same edit. A row naming a fader the show no longer has is a cell
  // nothing reads and nothing can revive, and a fader grown back is minted fresh.
  setDcaCount: (count) => set(s => {
    const cast = s.showSettings.cast
    const next = setDcaCountInCast(cast, count)
    if (next === cast) return s

    const gone = cast.dcas.slice(next.dcas.length).map(dca => dca.id)
    return {
      showSettings: {
        ...s.showSettings,
        cast: next,
        scenes: removeDcasFromScenes(s.showSettings.scenes, gone)
      },
      // A channel last written onto a fader that is gone was written onto the faders that
      // are left; the record follows the show in the same edit it reshapes.
      deskState: forgetDcas(s.deskState, gone),
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
      isDirty: true
    }
  }),

  // The builder names the strips and a group holds strips, so the membership is what it was
  // given — the one list, with no second identity to map it through. The grouping and the row
  // it was opened from are one write, so one undo takes both back. Nothing here is a desk
  // command: this is how the scene names its membership, not what a recall sends.
  saveEnsembleOnRow: (sceneId, dcaId, ensembleId, name, channelIds) => set(s => {
    const cast = s.showSettings.cast
    const scene = s.showSettings.scenes.list.find(candidate => candidate.id === sceneId)
    if (scene === undefined) return s
    // A group with nothing in it opens nothing, and the row would hold a block that stands
    // for nothing: the press that made it must not write.
    if (channelIds.length === 0) return s

    const existing = cast.ensembles.find(ensemble => ensemble.id === ensembleId)
    const grouped = ensembleId === null
      ? addEnsemble(cast, name, channelIds)
      : updateEnsemble(cast, ensembleId, {
          // A group is read by its name, so an empty field keeps the one it had rather than
          // leaving a row holding a block with nothing to draw.
          name: name.trim() === '' ? existing?.name ?? '' : name.trim(),
          channelIds
        })
    const ensemble = ensembleId === null
      ? grouped.ensembles[grouped.ensembles.length - 1]
      : grouped.ensembles.find(candidate => candidate.id === ensembleId)
    if (ensemble === undefined) return s

    return {
      showSettings: {
        ...s.showSettings,
        cast: grouped,
        scenes: setRowMember(
          s.showSettings.scenes,
          sceneId,
          dcaId,
          { kind: 'ensemble', memberId: ensemble.id }
        )
      },
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
      isDirty: true
    }
  }),

  // Two sections change as one edit: the pack they wore is released (a swap in its own
  // right) and the cast drops them. The scenes are not touched — they name channels, and the
  // strip stays on the console after the person who was on it has gone.
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
        cast: removePerformerFromCast(s.showSettings.cast, performerId)
      },
      log,
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
      isDirty: true
    }
  }),

  setDeskState: (deskState, deskSceneId) => set({ deskState, deskSceneId }),

  mergeDeskState: (patch, deskSceneId) => set(s => ({
    deskState: {
      mutes: { ...s.deskState.mutes, ...patch.mutes },
      assignments: { ...s.deskState.assignments, ...patch.assignments }
    },
    ...(deskSceneId === undefined ? {} : { deskSceneId })
  })),

  setScenesEditing: (scenesEditing) => set({ scenesEditing }),

  pushModal: () => set(s => ({ modals: s.modals + 1 })),

  popModal: () => set(s => ({ modals: Math.max(0, s.modals - 1) }))
}))

/**
 * Hears about a change to the parts of the store it names, and to nothing else.
 *
 * A plain `subscribe` is told about every write — a log line, a show event, a row lighting
 * up — and a listener that walks or serialises the cue list on each of them is doing that
 * work for news that was never about the cue list. `parts` names what the listener reads;
 * the store replaces a slice when it changes, so identity is the comparison.
 */
export function subscribeToParts(
  parts: (state: CueListState) => readonly unknown[],
  listener: () => void
): () => void {
  return useStore.subscribe((state, previous) => {
    const now = parts(state)
    const before = parts(previous)
    if (now.some((part, index) => part !== before[index])) listener()
  })
}

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
