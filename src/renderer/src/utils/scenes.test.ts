// The feature is the last part of this file: given who is open in a scene, what does the
// desk actually get told? Everything above it exists so that answer is a few messages
// rather than a sweep of every fader. Which group a performer routes to is resolved by
// `utils/cast.ts` (tested there); what is tested here is what a scene does with it.
import { describe, it, expect } from 'vitest'
import { midiNoteMessages } from './cast'
import { addScene, deskSummary, removeScene, sceneChanges, setPerformerLive, updateScene } from './scenes'
import type { DeskChannel, MicScene, RfPerformer, ScenesSettings } from '../types/show'

const { mute, unmute } = midiNoteMessages('Yamaha', 1, 36)

const GROUPS: DeskChannel[] = [
  { id: 'dca-1', label: 'DCA 1 — Principals', mute, unmute },
  { id: 'dca-2', label: 'DCA 2 — Ensemble', mute, unmute },
  // A group the show knows about but has never been told how to drive.
  { id: 'dca-3', label: 'DCA 3 — Spare', mute: null, unmute: null }
]

function setup(): ScenesSettings {
  return { list: [{ id: 's-1', name: 'Wedding', live: ['perf-1'], notes: '' }] }
}

function performer(id: string, deskChannelId: string | null): RfPerformer {
  return { id, name: id, role: '', notes: '', ensembleId: null, deskChannelId }
}

function scene(live: string[]): MicScene {
  return { id: 's-1', name: 'Wedding', live, notes: '' }
}

describe('scenes', () => {
  it('names a new scene after the ones already there', () => {
    const first = addScene({ list: [] })
    const named = addScene(first, '  Quick Change  ')
    const second = addScene(named)

    expect(first.list[0].name).toBe('Scene 1')
    expect(named.list[1].name).toBe('Quick Change')
    expect(second.list[2].name).toBe('Scene 3')
    expect(named.list[1].live).toEqual([])
  })

  it('renames, updates and removes by id', () => {
    const start = setup()
    const renamed = updateScene(start, 's-1', { name: 'Wedding Scene' })
    const removed = removeScene(start, 's-1')

    expect(renamed.list[0].name).toBe('Wedding Scene')
    expect(removed.list).toEqual([])
    expect(updateScene(start, 'nope', { name: 'x' }).list[0].name).toBe('Wedding')
  })

  it('opens and closes one performer, and does not duplicate it', () => {
    const start = setup()
    const opened = setPerformerLive(setPerformerLive(start, 's-1', 'perf-2', true), 's-1', 'perf-2', true)
    const closed = setPerformerLive(opened, 's-1', 'perf-1', false)

    expect(opened.list[0].live).toEqual(['perf-1', 'perf-2'])
    expect(closed.list[0].live).toEqual(['perf-2'])
  })
})

describe('sceneChanges', () => {
  const performers = [performer('perf-1', 'dca-1'), performer('perf-2', 'dca-2')]

  it('opens the groups carrying a performer who is live, and closes the rest', () => {
    const changes = sceneChanges(performers, [], GROUPS, scene(['perf-1']), {})

    expect(changes).toEqual([
      { channelId: 'dca-1', label: 'DCA 1 — Principals', live: true, message: unmute },
      { channelId: 'dca-2', label: 'DCA 2 — Ensemble', live: false, message: mute }
    ])
  })

  it('stays silent about a group that is already in the state the scene asks for', () => {
    // This is what makes a recall a few messages: the desk is only told what changed.
    const changes = sceneChanges(performers, [], GROUPS, scene(['perf-1']), { 'dca-1': true, 'dca-2': false })

    expect(changes).toEqual([])
  })

  it('opens a group when any one of its performers is live', () => {
    const shared = [performer('perf-1', 'dca-1'), performer('perf-2', 'dca-1')]

    expect(sceneChanges(shared, [], GROUPS, scene(['perf-2']), {})).toHaveLength(1)
    expect(sceneChanges(shared, [], GROUPS, scene(['perf-2']), {})[0]).toMatchObject({ channelId: 'dca-1', live: true })
  })

  it('leaves groups nobody routes to alone, and groups with nothing to send', () => {
    // dca-3 has nobody routed to it; a group with no message configured cannot be told
    // anything either way.
    const changes = sceneChanges([performer('perf-1', 'dca-3')], [], GROUPS, scene([]), {})

    expect(changes).toEqual([])
  })

  it('closes everything it knows about when there is no scene', () => {
    const changes = sceneChanges(performers, [], GROUPS, null, { 'dca-1': true, 'dca-2': true })

    expect(changes.map(change => change.live)).toEqual([false, false])
  })

  it('reopens the desk after a scene was changed but not recalled', () => {
    // Recall, then close a performer in the scene: the difference is exactly one message.
    const recalled = sceneChanges(performers, [], GROUPS, scene(['perf-1', 'perf-2']), {})
    const state = Object.fromEntries(recalled.map(change => [change.channelId, change.live]))
    const edited = sceneChanges(performers, [], GROUPS, scene(['perf-1']), state)

    expect(edited).toEqual([
      { channelId: 'dca-2', label: 'DCA 2 — Ensemble', live: false, message: mute }
    ])
  })
})

describe('deskSummary', () => {
  it('says what each group is carrying and whether it is open now', () => {
    const summary = deskSummary([performer('perf-1', 'dca-1')], [], GROUPS, scene(['perf-1']))

    expect(summary.map(entry => [entry.channel.id, entry.performers.length, entry.live])).toEqual([
      ['dca-1', 1, true],
      ['dca-2', 0, false],
      ['dca-3', 0, false]
    ])
  })
})
