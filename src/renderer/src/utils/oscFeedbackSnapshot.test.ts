// The show as the window publishes it for the OSC feedback: the playhead, the running cues in
// list order with how far each has got, and the list.
import { describe, it, expect } from 'vitest'
import { buildFeedbackSnapshot, FEEDBACK_LIST_ID } from './oscFeedbackSnapshot'
import { createCue } from './cueDefaults'
import type { Cue } from '../../../shared/cue'
import type { RunningCue } from '../store'

const cue = (type: Cue['type'], id: string, patch: Partial<Cue> = {}): Cue =>
  ({ ...createCue(type, id), id, name: `Cue ${id}`, ...patch } as Cue)

describe('the feedback snapshot', () => {
  it('stands on the selected cue, and lists the running cues in list order with their progress', () => {
    const cues = [cue('wait', 'w1', { duration: 10_000 }), cue('audio', 'a1', { duration: 20_000 }), cue('wait', 'w2', { notes: 'x'.repeat(400) })]
    const running = new Map<string, RunningCue>([
      ['a1', { cueId: 'a1', state: 'playing', startedAt: 0, progress: 0 }],
      ['w1', { cueId: 'w1', state: 'playing', startedAt: 1000, progress: 0 }]
    ])
    const snapshot = buildFeedbackSnapshot(
      { workspaceId: 'WS', workspaceName: 'Show', cues, selectedId: 'w2', running },
      5000,
      id => (id === 'a1' ? { elapsedMs: 4000, durationMs: 20_000 } as never : null)
    )
    expect(snapshot.listId).toBe(FEEDBACK_LIST_ID)
    expect(snapshot.playhead).toEqual({ id: 'w2', number: 'w2', name: 'Cue w2', type: 'wait' })
    expect(snapshot.running.map(run => [run.id, run.elapsedMs, run.durationMs])).toEqual([
      ['w1', 4000, 10_000],
      ['a1', 4000, 20_000]
    ])
    // Notes are a line or two to a remote, not the whole of them.
    expect(snapshot.cues[2].notes.length).toBe(256)
  })

  it('stands on nothing at the end of the show', () => {
    const snapshot = buildFeedbackSnapshot(
      { workspaceId: 'WS', workspaceName: 'Show', cues: [], selectedId: null, running: new Map() },
      0,
      () => null
    )
    expect(snapshot.playhead).toBeNull()
    expect(snapshot.running).toEqual([])
  })
})
