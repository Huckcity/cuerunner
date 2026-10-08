import type { Cue } from '../../../shared/cue'
import type { AudioProgress } from '../../../shared/audio'
import type { FeedbackCue, FeedbackRun, OscFeedbackSnapshot } from '../../../shared/oscFeedback'
import { defaultCueLists, listMembership, MAIN_CUE_LIST_ID, type CueListInfo } from '../../../shared/cueLists'
import type { RunningCue } from '../store'
import { groupDurationMs } from './cueDuration'
import { runTiming } from './runTiming'

/** What a snapshot is built from: the store's own fields, and the engine's progress. */
export interface SnapshotSource {
  workspaceId: string
  workspaceName: string
  cues: readonly Cue[]
  /** The list in front's playhead. */
  selectedId: string | null
  running: ReadonlyMap<string, RunningCue>
  /** The show's lists; a source without them is a show of one, the main list. */
  cueLists?: readonly CueListInfo[]
  activeListId?: string
  /** Each list's own playhead: the selection for the list in front, a list's own cursor otherwise. */
  listPlayhead?: (listId: string) => string | null
}

const asFeedbackCue = (cue: Cue): FeedbackCue => ({ id: cue.id, number: cue.number, name: cue.name, type: cue.type })

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
  const byId = new Map(source.cues.map(cue => [cue.id, cue]))
  const selected = source.selectedId === null ? null : byId.get(source.selectedId) ?? null
  const membership = listMembership(source.cues)
  const lists = source.cueLists ?? defaultCueLists()
  const activeListId = source.activeListId ?? MAIN_CUE_LIST_ID
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
      listId: membership.get(cue.id) ?? MAIN_CUE_LIST_ID,
      state: run.state,
      elapsedMs: Math.round(timing.elapsedMs),
      durationMs: timing.remainingMs === null ? null : Math.round(timing.elapsedMs + timing.remainingMs)
    })
  }
  return {
    workspaceId: source.workspaceId,
    workspaceName: source.workspaceName,
    activeListId,
    playhead: selected === null ? null : asFeedbackCue(selected),
    lists: lists.map(list => {
      const headId = list.id === activeListId ? source.selectedId : source.listPlayhead?.(list.id) ?? null
      const head = headId === null ? undefined : byId.get(headId)
      return {
        id: list.id,
        name: list.name,
        playhead: head === undefined ? null : asFeedbackCue(head),
        cart: list.cart === true,
        disarmed: list.disarmed === true
      }
    }),
    running,
    cues: source.cues.map(cue => ({
      id: cue.id,
      number: cue.number,
      name: cue.name,
      type: cue.type,
      parentId: cue.parentId,
      listId: membership.get(cue.id) ?? MAIN_CUE_LIST_ID,
      isArmed: cue.isArmed,
      colorName: cue.colorLabel,
      // A remote shows a cue's notes in a line or two; the snapshot does not carry a novel.
      notes: cue.notes.length > 256 ? `${cue.notes.slice(0, 255)}…` : cue.notes
    }))
  }
}
