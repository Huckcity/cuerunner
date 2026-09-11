import { create } from 'zustand'
import type { Cue, CueType, AudioCue, GroupCue } from '../types/cue'
import type { AudioSettings, MidiSettings } from '../types/workspace'
import { defaultShowSettings } from '../types/show'
import type {
  CompanionSettings,
  DeviceState,
  DeviceEvent,
  MidiInSettings,
  OscInSettings,
  PresenceSettings,
  RfSettings,
  ScriptSettings,
  ServiceEvent,
  ServiceStatus,
  ShowAlert,
  ShowEvent,
  ShowSettings,
  ShowSnapshot
} from '../types/show'
import { createCue } from '../utils/cueDefaults'

export type RunState = 'idle' | 'pre-wait' | 'playing' | 'post-wait'

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
  /** Failure detail — a fetch/CORS/timeout error, an HTTP error status, or a thrown script error. */
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
  // Workspace metadata
  workspaceName: string
  workspacePath: string | null
  isDirty: boolean

  // Settings
  audioSettings: AudioSettings
  midiSettings: MidiSettings

  // Cue data
  cues: Cue[]
  selectedId: string | null
  running: Map<string, RunningCue>

  // Undo / redo history (snapshots of cues[])
  past: Cue[][]
  future: Cue[][]

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

  /** Marks the session as having unsaved changes, e.g. after recovering a snapshot. */
  markDirty: () => void

  // Settings
  updateAudioSettings: (patch: Partial<AudioSettings>) => void
  updateMidiSettings: (patch: Partial<MidiSettings>) => void
  updateOscInSettings: (patch: Partial<OscInSettings>) => void
  updateMidiInSettings: (patch: Partial<MidiInSettings>) => void
  updateRfSettings: (patch: Partial<RfSettings>) => void
  updatePresenceSettings: (patch: Partial<PresenceSettings>) => void
  updateScriptSettings: (patch: Partial<ScriptSettings>) => void
  updateCompanionSettings: (patch: Partial<CompanionSettings>) => void

  // Undo / redo
  undo: () => void
  redo: () => void

  // Workspace lifecycle
  loadWorkspace: (cues: Cue[], name: string, path: string | null, audioSettings?: AudioSettings, midiSettings?: MidiSettings, showSettings?: ShowSettings) => void
  saveSucceeded: (path: string, name: string) => void
  setWorkspaceName: (name: string) => void
}

const HISTORY_LIMIT = 50

// Monotonic id source for log entries — React keys and ordering in the log panel.
let _logSeq = 0

function pushPast(past: Cue[][], snapshot: Cue[]): Cue[][] {
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
  notice: null,
  past: [],
  future: [],

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
    return { cues, selectedId: cue.id, isDirty: true, past: pushPast(s.past, s.cues), future: [] }
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
    return { cues, selectedId: lastAdded.id, isDirty: true, past: pushPast(s.past, s.cues), future: [] }
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
      past: pushPast(s.past, s.cues),
      future: [],
    }
  }),

  updateCue: (id, patch) => set(s => {
    const record = shouldRecordUpdate(id)
    return {
      cues: s.cues.map(c => c.id === id ? { ...c, ...patch } as Cue : c),
      isDirty: true,
      past: record ? pushPast(s.past, s.cues) : s.past,
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

    return { cues, isDirty: true, past: pushPast(s.past, s.cues), future: [] }
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
    return { cues, selectedId: copies[0].id, isDirty: true, past: pushPast(s.past, s.cues), future: [] }
  }),

  undo: () => set(s => {
    if (s.past.length === 0) return s
    const past = [...s.past]
    const cues = past.pop()!
    return { cues, past, future: [s.cues, ...s.future.slice(0, HISTORY_LIMIT - 1)] }
  }),

  redo: () => set(s => {
    if (s.future.length === 0) return s
    const future = [...s.future]
    const cues = future.shift()!
    return { cues, future, past: pushPast(s.past, s.cues) }
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

  markDirty: () => set({ isDirty: true }),

  loadWorkspace: (cues, name, path, audioSettings, midiSettings, showSettings) => set({
    cues,
    workspaceName: name,
    workspacePath: path,
    isDirty: false,
    selectedId: cues.find(c => c.parentId === null)?.id ?? cues[0]?.id ?? null,
    running: new Map(),
    lastRuns: {},
    notice: null,
    audioSettings: audioSettings ?? { ...defaultAudioSettings },
    midiSettings: midiSettings ?? { ...defaultMidiSettings },
    showSettings: showSettings ?? defaultShowSettings(),
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

  updateRfSettings: (patch) => set(s => ({
    showSettings: { ...s.showSettings, rf: { ...s.showSettings.rf, ...patch } },
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
  }))
}))

export function useSelectedCue(): Cue | null {
  return useStore(s => s.cues.find(c => c.id === s.selectedId) ?? null)
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
