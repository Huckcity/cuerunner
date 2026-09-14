// The feature is the last part of this file: given who is open in a scene, what does the
// desk actually get told? Everything above it exists so that answer is a few messages
// rather than a sweep of every fader.
import { describe, it, expect } from 'vitest'
import {
  addDeskChannel,
  addScene,
  describeDeskMessage,
  deskSummary,
  midiNoteMessages,
  oscMessages,
  removeDeskChannel,
  removeScene,
  sceneChanges,
  setPackLive,
  updateDeskChannel,
  updateScene
} from './scenes'
import type { DeskChannel, MicScene, RfPack, ScenesSettings } from '../types/show'

const { mute, unmute } = midiNoteMessages('Yamaha', 1, 36)

function setup(): ScenesSettings {
  return {
    channels: [
      { id: 'dca-1', label: 'DCA 1 — Principals', mute, unmute },
      { id: 'dca-2', label: 'DCA 2 — Ensemble', mute, unmute },
      // A group the show knows about but has never been told how to drive.
      { id: 'dca-3', label: 'DCA 3 — Spare', mute: null, unmute: null }
    ],
    list: [{ id: 's-1', name: 'Wedding', live: ['pack-1'], notes: '' }]
  }
}

function pack(id: string, deskChannelId: string | null): RfPack {
  return { id, label: id, channelId: null, performerId: null, notes: '', deskChannelId }
}

function scene(live: string[]): MicScene {
  return { id: 's-1', name: 'Wedding', live, notes: '' }
}

describe('scenes', () => {
  it('names a new scene after the ones already there', () => {
    const first = addScene({ channels: [], list: [] })
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

  it('opens and closes one mic, and does not duplicate it', () => {
    const start = setup()
    const opened = setPackLive(setPackLive(start, 's-1', 'pack-2', true), 's-1', 'pack-2', true)
    const closed = setPackLive(opened, 's-1', 'pack-1', false)

    expect(opened.list[0].live).toEqual(['pack-1', 'pack-2'])
    expect(closed.list[0].live).toEqual(['pack-2'])
  })
})

describe('desk channels', () => {
  it('labels new groups after the ones already there', () => {
    expect(addDeskChannel({ channels: [], list: [] }).channels[0].label).toBe('DCA 1')
    expect(addDeskChannel({ channels: [], list: [] }, 'DCA 9 — Pit').channels[0].label).toBe('DCA 9 — Pit')
  })

  it('updates and removes without touching the scenes', () => {
    const start = setup()
    const patched = updateDeskChannel(start, 'dca-1', { unmute: mute })
    const removed = removeDeskChannel(start, 'dca-1')

    expect(patched.channels[0].unmute).toEqual(mute)
    expect(removed.channels.map(channel => channel.id)).toEqual(['dca-2', 'dca-3'])
    expect(removed.list).toEqual(start.list)
  })
})

describe('desk messages', () => {
  it('builds the ordinary wireless group: open on note-on, closed on note-off', () => {
    expect(unmute).toEqual({
      kind: 'midi', portName: 'Yamaha', message: { kind: 'noteOn', channel: 1, note: 36, velocity: 127 }
    })
    expect(mute).toEqual({
      kind: 'midi', portName: 'Yamaha', message: { kind: 'noteOff', channel: 1, note: 36, velocity: 0 }
    })
  })

  it('builds the same thing over OSC, where the value is the difference', () => {
    const pair = oscMessages('10.0.0.5', 9000, '/dca/2/mute')

    expect(pair.unmute).toEqual({ kind: 'osc', host: '10.0.0.5', port: 9000, address: '/dca/2/mute', args: [1] })
    expect(pair.mute).toEqual({ kind: 'osc', host: '10.0.0.5', port: 9000, address: '/dca/2/mute', args: [0] })
  })

  it('describes a message the way the editor and the log need it', () => {
    expect(describeDeskMessage(unmute)).toBe('noteOn ch1 → "Yamaha"')
    expect(describeDeskMessage(oscMessages('10.0.0.5', 9000, '/dca/2/mute').mute))
      .toBe('OSC /dca/2/mute 0 → 10.0.0.5:9000')
    expect(describeDeskMessage(null)).toBe('nothing')
  })
})

describe('sceneChanges', () => {
  const channels: DeskChannel[] = setup().channels
  const packs = [pack('pack-1', 'dca-1'), pack('pack-2', 'dca-2')]

  it('opens the groups carrying a mic that is live, and closes the rest', () => {
    const changes = sceneChanges(packs, channels, scene(['pack-1']), {})

    expect(changes).toEqual([
      { channelId: 'dca-1', label: 'DCA 1 — Principals', live: true, message: unmute },
      { channelId: 'dca-2', label: 'DCA 2 — Ensemble', live: false, message: mute }
    ])
  })

  it('stays silent about a group that is already in the state the scene asks for', () => {
    // This is what makes a recall a few messages: the desk is only told what changed.
    const changes = sceneChanges(packs, channels, scene(['pack-1']), { 'dca-1': true, 'dca-2': false })

    expect(changes).toEqual([])
  })

  it('opens a group when any one of its mics is live', () => {
    const shared = [pack('pack-1', 'dca-1'), pack('pack-2', 'dca-1')]

    expect(sceneChanges(shared, channels, scene(['pack-2']), {})).toHaveLength(1)
    expect(sceneChanges(shared, channels, scene(['pack-2']), {})[0]).toMatchObject({ channelId: 'dca-1', live: true })
  })

  it('leaves groups the plot does not drive alone, and groups with nothing to send', () => {
    // dca-3 has no packs assigned; a group with no message configured cannot be told anything.
    const changes = sceneChanges([pack('pack-1', 'dca-3')], channels, scene([]), {})

    expect(changes).toEqual([])
  })

  it('closes everything it knows about when there is no scene', () => {
    const changes = sceneChanges(packs, channels, null, { 'dca-1': true, 'dca-2': true })

    expect(changes.map(change => change.live)).toEqual([false, false])
  })

  it('reopens the desk after a scene was changed but not recalled', () => {
    // Recall, then close a mic in the scene: the difference is exactly one message.
    const recalled = sceneChanges(packs, channels, scene(['pack-1', 'pack-2']), {})
    const state = Object.fromEntries(recalled.map(change => [change.channelId, change.live]))
    const edited = sceneChanges(packs, channels, scene(['pack-1']), state)

    expect(edited).toEqual([
      { channelId: 'dca-2', label: 'DCA 2 — Ensemble', live: false, message: mute }
    ])
  })
})

describe('deskSummary', () => {
  it('says what each group is carrying and whether it is open now', () => {
    const summary = deskSummary([pack('pack-1', 'dca-1')], setup().channels, scene(['pack-1']))

    expect(summary.map(entry => [entry.channel.id, entry.packs.length, entry.live])).toEqual([
      ['dca-1', 1, true],
      ['dca-2', 0, false],
      ['dca-3', 0, false]
    ])
  })
})
