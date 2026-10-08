import type { Cue } from '../../../shared/cue'
import type { AudioProgress } from '../../../shared/audio'
import type { FeedbackRun, OscFeedbackSnapshot } from '../../../shared/oscFeedback'
import type { RunningCue } from '../store'
import { groupDurationMs } from './cueDuration'
import { runTiming } from './runTiming'

/**
 * The list the playhead stands in, as a QLab remote names it. The show has one list; the id is
 * constant so a remote that learnt it keeps it across a reload.
 */
export const FEEDBACK_LIST_ID = 'main'

/** What a snapshot is built from: the store's own fields, and the engine's progress. */
export interface SnapshotSource {
  workspaceId: string
  workspaceName: string
  cues: readonly Cue[]
  selectedId: string | null
  running: ReadonlyMap<string, RunningCue>
}

/**
 * The show as a remote reads it now. The running cues are in list order — the topmost is slot
 * 0 — and each carries how far it has got in the phase it is in, read the way the Active tab
 * reads it: an audio cue from the engine's own position, everything else from when its phase
 * began.
 */
export function buildFeedbackSnapshot(
  source: SnapshotSource,
  nowMs: number,
  progressOf: (cueId: string) => AudioProgress | null
): OscFeedbackSnapshot {
  const selected = source.cues.find(cue => cue.id === source.selectedId) ?? null
  const running: FeedbackRun[] = []
  for (const cue of source.cues) {
    const run = source.running.get(cue.id)
    if (run === undefined || run.state === 'idle') continue
    const totalMs = cue.type === 'group' ? groupDurationMs([...source.cues], cue.id) : cue.duration
    const timing = runTiming(cue, run, totalMs, nowMs, cue.type === 'audio' ? progressOf(cue.id) : null)
    running.push({
      id: cue.id,
      number: cue.number,
      name: cue.name,
      type: cue.type,
      state: run.state,
      elapsedMs: Math.round(timing.elapsedMs),
      durationMs: timing.remainingMs === null ? null : Math.round(timing.elapsedMs + timing.remainingMs)
    })
  }
  return {
    workspaceId: source.workspaceId,
    workspaceName: source.workspaceName,
    listId: FEEDBACK_LIST_ID,
    playhead: selected === null
      ? null
      : { id: selected.id, number: selected.number, name: selected.name, type: selected.type },
    running,
    cues: source.cues.map(cue => ({
      id: cue.id,
      number: cue.number,
      name: cue.name,
      type: cue.type,
      parentId: cue.parentId,
      isArmed: cue.isArmed,
      colorName: cue.colorLabel,
      // A remote shows a cue's notes in a line or two; the snapshot does not carry a novel.
      notes: cue.notes.length > 256 ? `${cue.notes.slice(0, 255)}…` : cue.notes
    }))
  }
}
