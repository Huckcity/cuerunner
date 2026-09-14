import { create } from 'zustand'
import type { Cue, CueType, AudioCue, GroupCue } from '../types/cue'
import type { MissingMedia } from '../../../shared/media'
import type { AudioSettings, MidiSettings, WorkspaceIdentity } from '../types/workspace'
import { defaultShowSettings } from '../types/show'
import type {
  CompanionSettings,
  DeskChannel,
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
import { removeDeskChannel } from '../utils/scenes'
import type { LicenseStatus } from '../types/license'

export type RunState = 'idle' | 'pre-wait' | 'playing' | 'post-wait'

/**
 * The tabs the settings dialog has. `license` is the machine's own settings rather
 * than the workspace's, which is why the dialog can be opened straight onto it.
 */
export type SettingsTab = 'audio' | 'midi' | 'network' | 'wireless' | 'license'

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

interface CueListState {
  // Workspace metadata. The identity belongs to the show, not to a save: it comes out of
  // the file it was opened from and is written back unchanged, so saving a show twice
  // does not rewrite it. Only a new show — or a template like the demo — mints one.
  workspaceName: string
  workspacePath: string | null
  workspaceId: string
  workspaceCreatedAt: string
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
  removeCue: (id: string) => void
  updateCue: (id: string, patch: Partial<Cue>) => void
  // Places the cue at fromIndex — together with its children when it is a group —
  // immediately before the cue currently at beforeIndex (cues.length moves it last).
  // newParentId is ignored when it would make the cue a child of itself or of one of
  // its own descendants (the cue keeps its current parent).
  moveCue: (fromIndex: number, beforeIndex: number, newParentId?: string | null) => void
  duplicateCue: (id: string) => void

  // Selection
  select: (id: string | null) => void

  // Running state
  setRunning: (id: string, state: RunningCue | null) => void
  clearAllRunning: () => void
  syncCueDuration: (id: string, durationMs: number) => void
  lastRuns: Record<string, CueRunResult>
  setLastRun: (id: string, result: CueRunResult) => void

  // Session log
  log: LogEntry[]
  appendLog: (entries: LogEntryInput[]) => void
  clearLog: () => void

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

  // License. The machine's, not the show's: it is read from the main process before
  // the first frame, it never travels in a workspace, and it never dirties one.
  license: LicenseStatus
  setLicense: (status: LicenseStatus) => void
  /** Which tab the settings dialog is on, or null when it is closed. */
  settingsTab: SettingsTab | null
  openSettings: (tab: SettingsTab) => void
  closeSettings: () => void

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
  updateScenesSettings: (patch: Partial<ScenesSettings>) => void
  /**
   * Removing a desk group takes the group and unpicks the packs that fed it, as one edit:
   * a pack pointing at a group that is gone is a mic nothing on the desk opens, and an
   * undo that put half of it back would be the same thing with the operator's blessing.
   */
  removeDeskGroup: (channelId: string) => void

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
    identity?: WorkspaceIdentity
  ) => void
  saveSucceeded: (path: string, name: string) => void
  setWorkspaceName: (name: string) => void
}

const HISTORY_LIMIT = 50

/**
 * What an undo puts back: the three things an edit in this app destroys. Together, because
 * one edit can span them — removing a desk group clears the pointer on every pack that fed
 * it, and half an undo of that would be a lie.
 */
interface EditSnapshot {
  cues: Cue[]
  scenes: { list: MicScene[]; channels: DeskChannel[] }
  plot: RfPlot
}

function snapshotOf(state: CueListState): EditSnapshot {
  return {
    cues: state.cues,
    scenes: {
      list: state.showSettings.scenes.list,
      channels: state.showSettings.scenes.channels
    },
    plot: state.showSettings.rf.plot
  }
}

/** The show settings an undo puts back, leaving the rest of them where they are. */
function restoreSettings(showSettings: ShowSettings, snapshot: EditSnapshot): ShowSettings {
  return {
    ...showSettings,
    scenes: {
      ...showSettings.scenes,
      list: snapshot.scenes.list,
      channels: snapshot.scenes.channels
    },
    rf: { ...showSettings.rf, plot: snapshot.plot }
  }
}

// Monotonic id source for log entries — React keys and ordering in the log panel.
let _logSeq = 0

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

// Coalesce rapid updateCue calls for the same cue into one history entry.
let _coalesceId: string | null = null
let _coalesceTime = 0

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
  isDirty: false,

  audioSettings: { ...defaultAudioSettings },
  midiSettings: { ...defaultMidiSettings },

  cues: [],
  selectedId: null,
  running: new Map(),
  lastRuns: {},
  log: [],
  showSettings: defaultShowSettings(),
  showServices: [],
  showDevices: [],
  showAlerts: [],
  showEvents: [],
  deskState: {},
  deskSceneId: null,
  scenesEditing: false,
  audioDeviceError: null,
  notice: null,
  missingMedia: [],
  past: [],
  future: [],

  // Locked until the main process says otherwise: the window is told what this machine
  // holds before it draws anything, and a failure to read it must not unlock the app.
  license: { state: 'unlicensed' },
  settingsTab: null,

  addCue: (type, afterId) => set(s => {
    const cue = createCue(type)
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
    return { cues, selectedId: cue.id, isDirty: true, past: pushPast(s.past, snapshotOf(s)), future: [] }
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
    }))
    cues.splice(insertIdx, 0, ...newCues)
    const lastAdded = newCues[newCues.length - 1]
    return { cues, selectedId: lastAdded.id, isDirty: true, past: pushPast(s.past, snapshotOf(s)), future: [] }
  }),

  removeCue: (id) => set(s => {
    // Collect the cue and all its children (if it's a group)
    const toRemove = new Set<string>([id])
    for (const c of s.cues) {
      if (c.parentId === id) toRemove.add(c.id)
    }
    return {
      cues: s.cues.filter(c => !toRemove.has(c.id)),
      selectedId: toRemove.has(s.selectedId ?? '') ? null : s.selectedId,
      lastRuns: Object.fromEntries(
        Object.entries(s.lastRuns).filter(([cueId]) => !toRemove.has(cueId))
      ),
      isDirty: true,
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
    }
  }),

  updateCue: (id, patch) => set(s => {
    const record = shouldRecordUpdate(id)
    return {
      cues: s.cues.map(c => c.id === id ? { ...c, ...patch } as Cue : c),
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

  duplicateCue: (id) => set(s => {
    const src = s.cues.find(c => c.id === id)
    if (!src) return s

    const newGroupId = crypto.randomUUID()
    const isGroup = src.type === 'group'

    // Build the duplicated cue(s)
    const copies: Cue[] = [{
      ...src,
      id: isGroup ? newGroupId : crypto.randomUUID(),
      number: src.number + ' copy'
    }]

    if (isGroup) {
      // Duplicate all children with updated parentId
      const children = s.cues.filter(c => c.parentId === id)
      for (const child of children) {
        copies.push({ ...child, id: crypto.randomUUID(), parentId: newGroupId })
      }
    }

    // Insert after the original cue (and its children)
    const srcIdx = s.cues.findIndex(c => c.id === id)
    const insertAfter = isGroup ? lastChildIndex([...s.cues], id) : srcIdx
    const cues = [...s.cues]
    cues.splice(insertAfter + 1, 0, ...copies)
    return { cues, selectedId: copies[0].id, isDirty: true, past: pushPast(s.past, snapshotOf(s)), future: [] }
  }),

  undo: () => set(s => {
    if (s.past.length === 0) return s
    const past = [...s.past]
    const snapshot = past.pop()!
    return {
      cues: snapshot.cues,
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
      showSettings: restoreSettings(s.showSettings, snapshot),
      future,
      past: pushPast(s.past, snapshotOf(s))
    }
  }),

  select: (id) => set({ selectedId: id }),

  setRunning: (id, state) => set(s => {
    const running = new Map(s.running)
    if (state === null) running.delete(id)
    else running.set(id, state)
    return { running }
  }),

  clearAllRunning: () => set({ running: new Map() }),

  syncCueDuration: (id, durationMs) => set(s => {
    const cue = s.cues.find(c => c.id === id)
    if (!cue || cue.duration === durationMs) return s
    return { cues: s.cues.map(c => c.id === id ? { ...c, duration: durationMs } : c) }
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
    showEvents: snapshot.events.slice(-SHOW_EVENT_LIMIT)
  })),

  dismissAlert: (id) => set(s => ({ showAlerts: s.showAlerts.filter(a => a.id !== id) })),

  clearShowEvents: () => set({ showEvents: [] }),

  setNotice: (message) => set({ notice: message }),

  setMissingMedia: (missingMedia) => set({ missingMedia }),

  applyRelinkedMedia: (paths) => set(s => {
    const resolved = new Map(Object.entries(paths))
    if (resolved.size === 0) return s
    return {
      cues: s.cues.map(cue =>
        cue.type === 'audio' && resolved.has(cue.id)
          ? { ...cue, filePath: resolved.get(cue.id)! }
          : cue
      ),
      isDirty: true,
      past: pushPast(s.past, snapshotOf(s)),
      future: [],
    }
  }),

  setLicense: (license) => set({ license }),

  setAudioDeviceError: (audioDeviceError) => set({ audioDeviceError }),

  openSettings: (settingsTab) => set({ settingsTab }),

  closeSettings: () => set({ settingsTab: null }),

  markDirty: () => set({ isDirty: true }),

  loadWorkspace: (cues, name, path, audioSettings, midiSettings, showSettings, identity) => set({
    cues,
    workspaceName: name,
    workspacePath: path,
    // Loading a file adopts the show's identity; a load without one is a new show.
    workspaceId: identity?.id ?? crypto.randomUUID(),
    workspaceCreatedAt: identity?.createdAt ?? new Date().toISOString(),
    isDirty: false,
    selectedId: cues.find(c => c.parentId === null)?.id ?? cues[0]?.id ?? null,
    running: new Map(),
    lastRuns: {},
    notice: null,
    // Whatever the last workspace was missing says nothing about this one; the caller
    // sets this from the open result straight after.
    missingMedia: [],
    audioSettings: audioSettings ?? { ...defaultAudioSettings },
    midiSettings: midiSettings ?? { ...defaultMidiSettings },
    showSettings: showSettings ?? defaultShowSettings(),
    // Nothing has been told to this show's desk yet.
    deskState: {},
    deskSceneId: null,
    scenesEditing: false,
    past: [],
    future: [],
  }),

  saveSucceeded: (path, name) => set({
    workspacePath: path,
    workspaceName: name,
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

  // Scenes and their mics are the grid's work, so a delete or a stray cell is one undo
  // away from being back. The desk groups are set up once and are not.
  updateScenesSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, scenes: { ...s.showSettings.scenes, ...patch } },
    past: 'list' in patch ? pushPast(s.past, snapshotOf(s)) : s.past,
    future: 'list' in patch ? [] : s.future,
    isDirty: true
  })),

  removeDeskGroup: (channelId) => set(s => ({
    showSettings: {
      ...s.showSettings,
      scenes: removeDeskChannel(s.showSettings.scenes, channelId),
      rf: {
        ...s.showSettings.rf,
        plot: {
          ...s.showSettings.rf.plot,
          packs: s.showSettings.rf.plot.packs.map(pack =>
            pack.deskChannelId === channelId ? { ...pack, deskChannelId: null } : pack)
        }
      }
    },
    past: pushPast(s.past, snapshotOf(s)),
    future: [],
    isDirty: true
  })),

  setDeskState: (deskState, deskSceneId) => set({ deskState, deskSceneId }),

  setScenesEditing: (scenesEditing) => set({ scenesEditing })
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
