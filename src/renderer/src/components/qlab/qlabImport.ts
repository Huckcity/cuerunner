// The window's half of File → Import QLab Workspace…: which dialog is up, what the
// operator typed for a running QLab, and the flows the buttons run.
//
// The show itself lives in the app's store like any other; only the import's own state —
// the dialog, the address, the workspaces a QLab listed, and the report — is kept here, in
// a store of its own, because nothing else in the window reads it.

import { create } from 'zustand'
import { useStore } from '../../store'
import { guardDirty, loadIntoStore } from '../../hooks/useWorkspace'
import { buildWorkspace } from '../../utils/workspace'
import {
  QLAB_OSC_PORT,
  type QLabImported,
  type QLabImportReport,
  type QLabImportResult,
  type QLabWorkspaceEntry
} from '../../../../shared/ipc/qlab'

export interface QLabImportState {
  /** Which dialog is up: choosing where the show comes from, or the report on what came. */
  stage: 'closed' | 'choose' | 'report'
  /** A request is out: the buttons wait for it. */
  busy: boolean
  /** The last refusal, in the import's own words, shown in the dialog that asked. */
  error: string | null
  host: string
  port: string
  passcode: string
  /** What the running QLab said it has open, once it has been asked. */
  workspaces: QLabWorkspaceEntry[] | null
  workspaceId: string | null
  report: QLabImportReport | null
  /** How many files the last folder search found, for the line under the missing list. */
  lastFound: number | null
}

const INITIAL: QLabImportState = {
  stage: 'closed',
  busy: false,
  error: null,
  host: '127.0.0.1',
  port: String(QLAB_OSC_PORT),
  passcode: '',
  workspaces: null,
  workspaceId: null,
  report: null,
  lastFound: null
}

export const useQLabImport = create<QLabImportState>(() => ({ ...INITIAL }))

function set(patch: Partial<QLabImportState>): void {
  useQLabImport.setState(patch)
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Writes a refusal into the dialog and the log: the dialog is where the operator is looking. */
function refuse(message: string): void {
  set({ busy: false, error: message })
  useStore.getState().appendLog([{ level: 'error', message: `QLab import: ${message}` }])
}

/** File → Import QLab Workspace…: the dialog that asks where the show comes from. */
export function openQLabImport(): void {
  // The address the operator typed last time stays: the Mac running QLab has not moved.
  set({ stage: 'choose', busy: false, error: null, report: null, lastFound: null })
}

export function closeQLabImport(): void {
  set({ stage: 'closed', busy: false, error: null })
}

export function setQLabAddress(patch: Partial<Pick<QLabImportState, 'host' | 'port' | 'passcode' | 'workspaceId'>>): void {
  set(patch)
}

/**
 * The converted show, opened as a new show with no file of its own. It is marked unsaved
 * because it is: nothing has been written anywhere, and closing it should ask. The
 * machine's own audio and MIDI choices stay, because a QLab show's outputs name another
 * machine's devices.
 */
function open(imported: QLabImported): void {
  const { audioSettings, midiSettings } = useStore.getState()
  loadIntoStore(
    { ...imported.workspace, audioSettings, midiSettings },
    null,
    imported.missingMedia,
    imported.loadNotes
  )
  useStore.getState().markDirty()
  set({ stage: 'report', busy: false, error: null, report: imported.report, lastFound: null })
  useStore.getState().appendLog([{
    level: 'info',
    message: `Imported “${imported.report.workspaceName}” from QLab: ${imported.report.totalCues} cues`
  }])
}

async function run(request: () => Promise<QLabImportResult>): Promise<void> {
  if (!await guardDirty()) return
  set({ busy: true, error: null })
  try {
    const answer = await request()
    if (!answer.ok) {
      refuse(answer.error)
      return
    }
    if (answer.imported === null) {
      set({ busy: false })
      return
    }
    open(answer.imported)
  } catch (error) {
    refuse(`the import failed: ${failure(error)}`)
  }
}

/** A workspace file, picked in the operating system's own dialog. */
export function importQLabFile(): Promise<void> {
  return run(() => window.cuerunner.qlab.importFile())
}

/** The port the operator typed, or null for text that is not one. */
function typedPort(): number | null {
  const text = useQLabImport.getState().port.trim()
  if (!/^\d{1,5}$/.test(text)) return null
  const port = Number(text)
  return port >= 1 && port <= 65535 ? port : null
}

/** Asks the QLab at the typed address which workspaces it has open. */
export async function findQLabWorkspaces(): Promise<void> {
  const { host } = useQLabImport.getState()
  const port = typedPort()
  if (port === null) {
    refuse(`${useQLabImport.getState().port} is not a port: QLab listens on ${QLAB_OSC_PORT}`)
    return
  }
  set({ busy: true, error: null, workspaces: null, workspaceId: null })
  try {
    const answer = await window.cuerunner.qlab.listWorkspaces(host, port)
    if (!answer.ok) {
      refuse(answer.error)
      return
    }
    set({
      busy: false,
      workspaces: answer.workspaces,
      workspaceId: answer.workspaces[0]?.id ?? null,
      error: answer.workspaces.length === 0 ? 'QLab answered, but it has no workspace open' : null
    })
  } catch (error) {
    refuse(`QLab could not be asked: ${failure(error)}`)
  }
}

/** Reads the chosen workspace from the running QLab, cue by cue. */
export function importQLabLive(): Promise<void> {
  const { host, passcode, workspaceId } = useQLabImport.getState()
  const port = typedPort()
  if (port === null || workspaceId === null) {
    refuse('ask QLab for its workspaces first, then pick one')
    return Promise.resolve()
  }
  return run(() => window.cuerunner.qlab.importLive({ host, port, workspaceId, passcode }))
}

/** Asks for a folder and relinks every missing audio file the show can find in it. */
export async function findQLabMediaInFolder(): Promise<void> {
  const store = useStore.getState()
  const workspace = buildWorkspace({
    id: store.workspaceId,
    name: store.workspaceName,
    createdAt: store.workspaceCreatedAt,
    audioSettings: store.audioSettings,
    midiSettings: store.midiSettings,
    showSettings: store.showSettings,
    triggerGuard: store.triggerGuard,
    lighting: store.lighting,
    timecode: store.timecode,
    videoOutputs: store.videoOutputs,
    pictures: store.pictures,
    cues: store.cues
  })
  set({ busy: true, error: null })
  try {
    const answer = await window.cuerunner.qlab.findMedia(workspace, store.workspacePath)
    if (!answer.ok) {
      refuse(answer.error)
      return
    }
    if (answer.found === null) {
      set({ busy: false })
      return
    }
    // Only cues whose file moved are written back, the same as a single relink.
    const now = useStore.getState()
    const resolved: Record<string, string> = {}
    for (const cue of answer.found.workspace.cues) {
      if (cue.type !== 'audio') continue
      const current = now.cues.find(candidate => candidate.id === cue.id)
      if (current?.type === 'audio' && current.filePath !== cue.filePath) resolved[cue.id] = cue.filePath
    }
    now.applyRelinkedMedia(resolved)
    now.setMissingMedia(answer.found.missingMedia)
    set({ busy: false, lastFound: answer.found.found })
  } catch (error) {
    refuse(`the folder could not be searched: ${failure(error)}`)
  }
}
