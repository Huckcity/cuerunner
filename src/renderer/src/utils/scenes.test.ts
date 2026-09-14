// The feature is the last part of this file: given who is open in a scene, what does the
// desk actually get told? Everything above it exists so that answer is a few messages
// rather than a sweep of every fader. Which DCA a performer's mic routes to is resolved by
// `utils/cast.ts` (tested there); what is tested here is what a scene does with it — the
// performers it names, the ensembles it applies, and the members it closes anyway.
import { describe, it, expect } from 'vitest'
import { midiNoteMessages } from './cast'
import {
  addScene,
  ensembleState,
  isPerformerLive,
  removeEnsembleFromScenes,
  removePerformerFromScenes,
  removeScene,
  sceneChanges,
  sceneLiveIds,
  setEnsembleApplied,
  setPerformerLive,
  updateScene
} from './scenes'
import type {
  CastSettings,
  Dca,
  Ensemble,
  MicScene,
  Performer,
  ScenesSettings,
  ShowChannel
} from '../types/show'

const { mute, unmute } = midiNoteMessages('Yamaha', 1, 36)

const DCAS: Dca[] = [
  { id: 'dca-1', label: 'DCA 1 — Principals', mute, unmute },
  { id: 'dca-2', label: 'DCA 2 — Ensemble', mute, unmute },
  // A DCA the show knows about but has never been told how to drive.
  { id: 'dca-3', label: 'DCA 3 — Spare', mute: null, unmute: null }
]

function setup(): ScenesSettings {
  return {
    list: [{ id: 's-1', name: 'Wedding', live: ['perf-1'], ensembles: [], excluded: [], notes: '' }]
  }
}

function scene(live: string[], ensembles: string[] = [], excluded: string[] = []): MicScene {
  return { id: 's-1', name: 'Wedding', live, ensembles, excluded, notes: '' }
}

function performer(id: string, channelId: string | null): Performer {
  return { id, name: id, role: '', notes: '', channelId }
}

function channel(id: string, dcaId: string | null, enabled = true): ShowChannel {
  return { id, name: id, enabled, dcaId }
}

/**
 * Two performers, each on their own strip: perf-1 opens DCA 1, perf-2 opens DCA 2. A
 * third is in no DCA at all, which is what an unpatched mic looks like.
 */
function cast(): CastSettings {
  return {
    channels: [channel('ch-1', 'dca-1'), channel('ch-2', 'dca-2'), channel('ch-3', null)],
    performers: [performer('perf-1', 'ch-1'), performer('perf-2', 'ch-2'), performer('perf-3', 'ch-3')],
    ensembles: [],
    dcas: DCAS
  }
}

function ensemble(id: string, members: string[]): Ensemble {
  return { id, name: id, members }
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
    expect(named.list[1].ensembles).toEqual([])
    expect(named.list[1].excluded).toEqual([])
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
    const opened = setPerformerLive(
      setPerformerLive(start, 's-1', 'perf-2', true, []), 's-1', 'perf-2', true, []
    )
    const closed = setPerformerLive(opened, 's-1', 'perf-1', false, [])

    expect(opened.list[0].live).toEqual(['perf-1', 'perf-2'])
    expect(closed.list[0].live).toEqual(['perf-2'])
  })

  it('takes a performer off the cast list out of every scene, exclusions included', () => {
    const start: ScenesSettings = {
      list: [scene(['perf-1', 'perf-2'], [], ['perf-2'])]
    }
    const next = removePerformerFromScenes(start, 'perf-2')

    expect(next.list[0].live).toEqual(['perf-1'])
    expect(next.list[0].excluded).toEqual([])
  })
})

describe('an ensemble applied to a scene', () => {
  const chorus = ensemble('ens-1', ['perf-1', 'perf-2'])

  it('opens every member, whoever the scene named by hand', () => {
    const applied = setEnsembleApplied(setup(), 's-1', chorus, true)

    expect(applied.list[0].ensembles).toEqual(['ens-1'])
    // perf-1 was named by hand and is a member, so the ensemble carries them now: that is
    // what lets an ensemble grow later without the scene being edited again.
    expect(applied.list[0].live).toEqual([])
    expect(sceneLiveIds(applied.list[0], [chorus])).toEqual(['perf-1', 'perf-2'])
  })

  it('closes a member as an exclusion rather than as a removal', () => {
    const applied = setEnsembleApplied(setup(), 's-1', chorus, true)
    const oneOff = setPerformerLive(applied, 's-1', 'perf-2', false, [chorus])

    expect(oneOff.list[0].excluded).toEqual(['perf-2'])
    expect(oneOff.list[0].ensembles).toEqual(['ens-1'])
    expect(sceneLiveIds(oneOff.list[0], [chorus])).toEqual(['perf-1'])
    expect(ensembleState(oneOff.list[0], chorus)).toBe('partial')

    // Pressing the same cell again puts them back: the exclusion is the only thing
    // standing between the ensemble and the mic being open.
    const back = sceneLiveIds(setPerformerLive(oneOff, 's-1', 'perf-2', true, [chorus]).list[0], [chorus])
    expect(back.sort()).toEqual(['perf-1', 'perf-2'])
  })

  it('reads as off, on, or partly on', () => {
    const applied = setEnsembleApplied(setup(), 's-1', chorus, true)
    const oneOff = setPerformerLive(applied, 's-1', 'perf-2', false, [chorus])

    expect(ensembleState(setup().list[0], chorus)).toBe('off')
    expect(ensembleState(applied.list[0], chorus)).toBe('on')
    expect(ensembleState(oneOff.list[0], chorus)).toBe('partial')
  })

  it('closes who it was holding open when it is unapplied, and keeps the rest', () => {
    const applied = setEnsembleApplied({ list: [scene([], [], [])] }, 's-1', chorus, true)
    const off = setEnsembleApplied(applied, 's-1', chorus, false)

    expect(off.list[0].ensembles).toEqual([])
    expect(off.list[0].excluded).toEqual([])
    expect(sceneLiveIds(off.list[0], [chorus])).toEqual([])

    // A performer the scene named by hand is the operator's decision, not the ensemble's.
    const handPicked = setPerformerLive(off, 's-1', 'perf-1', true, [chorus])
    expect(sceneLiveIds(handPicked.list[0], [chorus])).toEqual(['perf-1'])
  })

  it('unapplies itself from every scene when the ensemble is deleted', () => {
    const applied = setEnsembleApplied(setup(), 's-1', chorus, true)
    expect(removeEnsembleFromScenes(applied, 'ens-1').list[0].ensembles).toEqual([])
  })

  it('knows who is open by either route', () => {
    const applied = setEnsembleApplied(setup(), 's-1', chorus, true)
    expect(isPerformerLive(applied.list[0], [chorus], 'perf-1')).toBe(true)
    expect(isPerformerLive(applied.list[0], [chorus], 'perf-3')).toBe(false)
    expect(isPerformerLive(null, [chorus], 'perf-1')).toBe(false)
  })
})

describe('sceneChanges', () => {
  const show = cast()

  it('opens the DCAs carrying a performer who is live, and closes the rest', () => {
    const changes = sceneChanges(show, scene(['perf-1']), {})

    expect(changes).toEqual([
      { channelId: 'dca-1', label: 'DCA 1 — Principals', live: true, message: unmute },
      { channelId: 'dca-2', label: 'DCA 2 — Ensemble', live: false, message: mute }
    ])
  })

  it('stays silent about a DCA that is already in the state the scene asks for', () => {
    // This is what makes a recall a few messages: the desk is only told what changed.
    const changes = sceneChanges(show, scene(['perf-1']), { 'dca-1': true, 'dca-2': false })

    expect(changes).toEqual([])
  })

  it('opens a DCA when any one of the strips in it is live', () => {
    const shared: CastSettings = {
      ...show,
      channels: [channel('ch-1', 'dca-1'), channel('ch-2', 'dca-1'), channel('ch-3', null)]
    }

    const changes = sceneChanges(shared, scene(['perf-2']), {})
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ channelId: 'dca-1', live: true })
  })

  it('leaves DCAs nobody routes to alone, and DCAs with nothing to send', () => {
    // Nobody is on a strip that feeds a DCA: the show has nothing to say about the desk.
    const unrouted: CastSettings = { ...show, performers: [performer('perf-3', 'ch-3')] }
    expect(sceneChanges(unrouted, scene(['perf-3']), {})).toEqual([])

    // A DCA with no message configured cannot be told anything either way, however many
    // mics are routed to it.
    const unpatched: CastSettings = {
      channels: [channel('ch-1', 'dca-3')],
      performers: [performer('perf-1', 'ch-1')],
      ensembles: [],
      dcas: [{ id: 'dca-3', label: 'DCA 3 — Spare', mute: null, unmute: null }]
    }
    expect(sceneChanges(unpatched, scene(['perf-1']), {})).toEqual([])
  })

  it('drives nothing for a strip that is out of the patch', () => {
    const patchedOut: CastSettings = {
      ...show,
      channels: [channel('ch-1', 'dca-1', false), channel('ch-2', 'dca-2'), channel('ch-3', null)]
    }

    expect(sceneChanges(patchedOut, scene(['perf-1']), {}))
      .toEqual([{ channelId: 'dca-2', label: 'DCA 2 — Ensemble', live: false, message: mute }])
  })

  it('closes everything it knows about when there is no scene', () => {
    const changes = sceneChanges(show, null, { 'dca-1': true, 'dca-2': true })

    expect(changes.map(change => change.live)).toEqual([false, false])
  })

  it('reopens the desk after a scene was changed but not recalled', () => {
    // Recall, then close a performer in the scene: the difference is exactly one message.
    const recalled = sceneChanges(show, scene(['perf-1', 'perf-2']), {})
    const state = Object.fromEntries(recalled.map(change => [change.channelId, change.live]))
    const edited = sceneChanges(show, scene(['perf-1']), state)

    expect(edited).toEqual([
      { channelId: 'dca-2', label: 'DCA 2 — Ensemble', live: false, message: mute }
    ])
  })

  it('opens the DCAs of an applied ensemble', () => {
    const chorus = ensemble('ens-1', ['perf-1', 'perf-2'])
    const withChorus: CastSettings = { ...show, ensembles: [chorus] }
    const applied = setEnsembleApplied(setup(), 's-1', chorus, true)

    expect(sceneChanges(withChorus, applied.list[0], {}).map(change => change.live))
      .toEqual([true, true])
  })
})
