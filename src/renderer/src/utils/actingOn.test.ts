// The Active tab's line for a cue that acts on cues, and the sounds a running fade is moving.
import { describe, it, expect } from 'vitest'
import { actingOn, fadedBy } from './actingOn'
import { createCue } from './cueDefaults'
import type { Cue, FadeCue, StopCue } from '../../../shared/cue'
import type { RunningCue } from '../store'

const named = (type: Cue['type'], id: string, number: string, name: string, parentId: string | null = null): Cue =>
  ({ ...createCue(type, number), id, name, parentId })

const cues: Cue[] = [
  named('audio', 'a', '1', 'Walk-in'),
  named('audio', 'b', '2', 'Storm'),
  named('group', 'g', '3', 'Act 2'),
  named('audio', 'c', '3.1', 'Rain', 'g'),
  named('audio', 'd', '4', 'Wind'),
  named('audio', 'e', '5', 'Birds')
]

describe('what a cue is acting on', () => {
  it('names its targets, a lost one as lost, and past three how many more', () => {
    expect(actingOn({ ...(createCue('fade') as FadeCue), targetCueIds: ['a', 'gone'] }, cues)).toBe('1 Walk-in, a cue not in this show')
    expect(actingOn({ ...(createCue('fade') as FadeCue), targetCueIds: ['a', 'b', 'd', 'e'] }, cues)).toBe('1 Walk-in, 2 Storm, 4 Wind +1 more')
  })

  it('says everything for a stop of everything, nothing chosen for an empty one, and nothing for other cues', () => {
    expect(actingOn(createCue('stop') as StopCue, cues)).toBe('everything')
    expect(actingOn({ ...(createCue('stop') as StopCue), targetCueId: undefined, targetCueIds: [] }, cues)).toBe('nothing chosen')
    expect(actingOn(createCue('wait'), cues)).toBeNull()
  })
})

describe('the sounds a running fade is moving', () => {
  it('are every sound it names and every one in a group it names, while it plays', () => {
    const fading = { ...(createCue('fade') as FadeCue), id: 'f', targetCueIds: ['a', 'g'] }
    const running = new Map<string, RunningCue>([['f', { cueId: 'f', state: 'playing', startedAt: 0, progress: 0 }]])
    expect([...fadedBy([...cues, fading], running)].sort()).toEqual(['a', 'c'])
    running.set('f', { cueId: 'f', state: 'post-wait', startedAt: 0, progress: 1 })
    expect(fadedBy([...cues, fading], running).size).toBe(0)
  })
})
