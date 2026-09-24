// A scene owns the assignment, and this file is that model as pure operations: which
// channels a row carries, what placing one on it or taking it off does, and — at the bottom
// — what a recall actually writes. The last one is the point of the file: given a scene and
// what the desk was last told, the controlled channels that move, and nothing outside the
// show's own channel list ever.
//
// The mute a recall sends and the frames a membership write carries are `utils/desk.ts`'s
// subject, tested there; what is tested here is the model above them, and the diff no
// message can reach past.
import { describe, it, expect } from 'vitest'
import {
  addScene,
  channelDcas,
  ensembleState,
  placementFor,
  removeChannelsFromScenes,
  removeDcasFromScenes,
  removeEnsembleFromScenes,
  removeScene,
  rowChannels,
  rowPerformers,
  sceneChanges,
  sceneChannelIds,
  sceneStep,
  setChannelPlaced,
  setMemberExcluded,
  setRowEnsemble,
  UNKNOWN_DESK_STATE,
  updateScene
} from './scenes'
import { ALL_CLOSED_SCENE_ID, defaultShowSettings } from '../../../shared/show'
import type {
  CastSettings,
  Dca,
  Ensemble,
  MicScene,
  Performer,
  SceneDcaPlacement,
  ScenesSettings,
  ShowChannel,
  ShowSettings
} from '../../../shared/show'

function channel(id: string, name = ''): ShowChannel {
  return { id, name }
}

function performer(id: string, channelId: string | null): Performer {
  return { id, name: id, role: '', notes: '', channelId }
}

function dca(id: string, label: string): Dca {
  return { id, label, deskNumber: null }
}

/**
 * Three strips, two performers patched to the first two, and one ensemble over them: the
 * smallest show in which a row can say something by hand, by ensemble, and by neither.
 */
function cast(): CastSettings {
  return {
    channels: [channel('ch-1', 'Ruth'), channel('ch-2', 'Sancho'), channel('ch-3')],
    performers: [performer('p-1', 'ch-1'), performer('p-2', 'ch-2')],
    ensembles: [{ id: 'ens-1', name: 'Chorus', members: ['p-1', 'p-2'] }],
    dcas: [
      dca('dca-1', 'DCA 1 — Principals'),
      dca('dca-2', 'DCA 2 — Ensemble'),
      dca('dca-3', 'DCA 3 — Spare')
    ]
  }
}

const chorus: Ensemble = { id: 'ens-1', name: 'Chorus', members: ['p-1', 'p-2'] }

/** One scene, with whatever rows a case is about. */
function scenesOf(dcas: SceneDcaPlacement[] = [], allowDuplicateAssignment = true): ScenesSettings {
  return {
    list: [{ id: 's-1', name: 'Wedding', dcas, notes: '' }],
    allowDuplicateAssignment
  }
}

/** The row a case edited, or null when the scene says nothing about that fader. */
function row(settings: ScenesSettings, dcaId = 'dca-1'): SceneDcaPlacement | null {
  return placementFor(settings.list[0], dcaId)
}

/** What one row carries, read the way a recall reads it: the show's own channel order. A
 *  case that changed the cast passes the one the row is read through afterwards. */
function collected(
  settings: ScenesSettings,
  dcaId = 'dca-1',
  castSettings: CastSettings = cast()
): string[] {
  return rowChannels(castSettings, placementFor(settings.list[0], dcaId))
}

/** The scene every recall below is of: Sancho on the second fader, and nobody else. */
const wedding: MicScene = {
  id: 's-1',
  name: 'Wedding',
  dcas: [{ dcaId: 'dca-2', channels: ['ch-2'], ensembles: [], excluded: [] }],
  notes: ''
}

/** The whole show a recall reads: the cast above, the rule, and the scene it is of. */
function show(
  castSettings: CastSettings = cast(),
  allowDuplicateAssignment = true
): ShowSettings {
  return {
    ...defaultShowSettings(),
    cast: castSettings,
    scenes: { list: [wedding], allowDuplicateAssignment }
  }
}

describe('the scenes themselves', () => {
  it('names a new scene after the ones already there', () => {
    const first = addScene({ list: [], allowDuplicateAssignment: true })
    const named = addScene(first, '  Quick Change  ')
    const second = addScene(named)

    expect(first.list[0].name).toBe('Scene 1')
    expect(named.list[1].name).toBe('Quick Change')
    expect(second.list[2].name).toBe('Scene 3')
    // A new scene places nothing: which fader a channel rides is the decision the scene
    // exists to make, so guessing one here would be the app making it for the operator.
    expect(named.list[1].dcas).toEqual([])
  })

  it('renames, updates and removes by id', () => {
    const start = scenesOf()
    const renamed = updateScene(start, 's-1', { name: 'Wedding Scene' })
    const removed = removeScene(start, 's-1')

    expect(renamed.list[0].name).toBe('Wedding Scene')
    expect(removed.list).toEqual([])
    expect(updateScene(start, 'nope', { name: 'x' }).list[0].name).toBe('Wedding')
  })
})

describe('a row and what rides it', () => {
  it('carries what the scene placed on it, and says nothing when the scene has no row', () => {
    const placed = setChannelPlaced(scenesOf(), 's-1', 'dca-1', 'ch-1', true, cast())

    expect(row(placed)).toEqual({
      dcaId: 'dca-1',
      channels: ['ch-1'],
      ensembles: [],
      excluded: []
    })
    expect(collected(placed)).toEqual(['ch-1'])
    // A fader the scene speaks for nowhere is not a row of empty lists: a row that says
    // nothing is dropped rather than kept as a shell.
    expect(row(placed, 'dca-2')).toBeNull()
    expect(rowChannels(cast(), null)).toEqual([])
  })

  it('lists the channels it carries in the show’s own order, not the order they were placed', () => {
    // The desk numbers its inputs in the show's order, so a row read back must not be an
    // edit log: ch-3 was placed first and ch-1 is the first strip.
    const both = setChannelPlaced(
      setChannelPlaced(scenesOf(), 's-1', 'dca-1', 'ch-3', true, cast()),
      's-1',
      'dca-1',
      'ch-1',
      true,
      cast()
    )

    expect(row(both)?.channels).toEqual(['ch-3', 'ch-1'])
    expect(collected(both)).toEqual(['ch-1', 'ch-3'])
  })

  it('takes a channel off the row, and drops the row the edit leaves saying nothing', () => {
    const placed = setChannelPlaced(scenesOf(), 's-1', 'dca-1', 'ch-1', true, cast())
    const off = setChannelPlaced(placed, 's-1', 'dca-1', 'ch-1', false, cast())

    expect(off.list[0].dcas).toEqual([])
    // ...while a row that says something else keeps it.
    const two = setChannelPlaced(placed, 's-1', 'dca-1', 'ch-2', true, cast())
    expect(setChannelPlaced(two, 's-1', 'dca-1', 'ch-1', false, cast()).list[0].dcas).toEqual([
      { dcaId: 'dca-1', channels: ['ch-2'], ensembles: [], excluded: [] }
    ])
  })

  it('reads a fader list per channel, in the show’s DCA order', () => {
    const twoRows = setChannelPlaced(
      setChannelPlaced(scenesOf(), 's-1', 'dca-3', 'ch-1', true, cast()),
      's-1',
      'dca-1',
      'ch-1',
      true,
      cast()
    )

    expect(channelDcas(twoRows.list[0], 'ch-1', cast())).toEqual(['dca-1', 'dca-3'])
    expect(channelDcas(twoRows.list[0], 'ch-2', cast())).toEqual([])
    expect(channelDcas(null, 'ch-1', cast())).toEqual([])
    expect(sceneChannelIds(twoRows.list[0], cast())).toEqual(['ch-1'])
    expect(sceneChannelIds(null, cast())).toEqual([])
  })
})

describe('an ensemble applied to a row', () => {
  it('is membership rather than a copy: its members ride without being named', () => {
    const applied = setRowEnsemble(scenesOf(), 's-1', 'dca-1', chorus, true, cast())

    expect(row(applied)).toEqual({
      dcaId: 'dca-1',
      channels: [],
      ensembles: ['ens-1'],
      excluded: []
    })
    expect(collected(applied)).toEqual(['ch-1', 'ch-2'])
  })

  it('takes its members’ hand placements and exclusions off the row when it is applied', () => {
    // The ensemble says where they ride now, which is what lets it grow later without the
    // scene being edited again — so a hand placement of a member and an exclusion of
    // another are both things the ensemble supersedes.
    const byHand = setChannelPlaced(
      setChannelPlaced(scenesOf(), 's-1', 'dca-1', 'ch-2', true, cast()),
      's-1',
      'dca-1',
      'ch-3',
      true,
      cast()
    )
    const applied = setRowEnsemble(
      setMemberExcluded(byHand, 's-1', 'dca-1', 'ch-1', true),
      's-1',
      'dca-1',
      chorus,
      true,
      cast()
    )

    expect(row(applied)?.channels).toEqual(['ch-3'])
    expect(row(applied)?.excluded).toEqual([])
    // ch-1 is back without anybody placing it: the ensemble holds them all.
    expect(collected(applied)).toEqual(['ch-1', 'ch-2', 'ch-3'])
  })

  it('leaves what was placed by hand where it was when it is unapplied', () => {
    const applied = setRowEnsemble(
      setChannelPlaced(scenesOf(), 's-1', 'dca-1', 'ch-3', true, cast()),
      's-1',
      'dca-1',
      chorus,
      true,
      cast()
    )
    const handPlaced = setChannelPlaced(applied, 's-1', 'dca-1', 'ch-2', true, cast())
    const off = setRowEnsemble(handPlaced, 's-1', 'dca-1', chorus, false, cast())

    expect(row(off)?.ensembles).toEqual([])
    // ch-2 was placed by hand while the ensemble was applied, so it stays: that is the
    // operator's decision, not the ensemble's.
    expect(row(off)?.channels).toEqual(['ch-3', 'ch-2'])
    expect(collected(off)).toEqual(['ch-2', 'ch-3'])
  })

  it('takes its members’ exclusions with it, because an exclusion means nothing without it', () => {
    const applied = setRowEnsemble(scenesOf(), 's-1', 'dca-1', chorus, true, cast())
    const oneOff = setMemberExcluded(applied, 's-1', 'dca-1', 'ch-1', true)
    const off = setRowEnsemble(oneOff, 's-1', 'dca-1', chorus, false, cast())

    expect(collected(oneOff)).toEqual(['ch-2'])
    // The ensemble and its exclusion both go, so the row is left saying nothing and is
    // dropped rather than kept as a shell of empty lists.
    expect(row(off)).toBeNull()
    expect(off.list[0].dcas).toEqual([])
  })

  it('reads as off, on, or partly on — the third state a cell cannot be a tick for', () => {
    const applied = setRowEnsemble(scenesOf(), 's-1', 'dca-1', chorus, true, cast())
    const oneOff = setMemberExcluded(applied, 's-1', 'dca-1', 'ch-2', true)

    expect(ensembleState(scenesOf().list[0], 'dca-1', chorus, cast())).toBe('off')
    expect(ensembleState(applied.list[0], 'dca-1', chorus, cast())).toBe('on')
    expect(ensembleState(oneOff.list[0], 'dca-1', chorus, cast())).toBe('partial')
    // Another fader's row is off however the first one reads.
    expect(ensembleState(applied.list[0], 'dca-2', chorus, cast())).toBe('off')
  })
})

describe('the performers a set of strips holds', () => {
  // What the builder's picks come to: it names strips and an ensemble holds performers, so
  // the members are whoever is standing on the strips that were moved across.
  it('is whoever is cast on them, and nobody for a strip nobody is on', () => {
    expect(rowPerformers(cast(), ['ch-1', 'ch-2'])).toEqual(['p-1', 'p-2'])
    // A strip nobody is patched to opens nothing, so it contributes nobody — which is what
    // leaves the builder with nothing to make when those are the only strips picked.
    expect(rowPerformers(cast(), ['ch-3'])).toEqual([])
    expect(rowPerformers(cast(), ['ch-3', 'ch-2'])).toEqual(['p-2'])
    expect(rowPerformers(cast(), [])).toEqual([])
  })
})

describe('taking a channel off a row it was placed on by hand', () => {
  it('is an exclusion when an applied ensemble carries it', () => {
    // The ensemble still holds them: taking them off this row is leaving them out of *this*
    // row, so the next scene that applies the chorus rides them again.
    const applied = setRowEnsemble(scenesOf(), 's-1', 'dca-1', chorus, true, cast())
    const placed = setChannelPlaced(applied, 's-1', 'dca-1', 'ch-2', true, cast())
    const off = setChannelPlaced(placed, 's-1', 'dca-1', 'ch-2', false, cast())

    expect(row(off)?.channels).toEqual([])
    expect(row(off)?.excluded).toEqual(['ch-2'])
    expect(collected(off)).toEqual(['ch-1'])
    expect(ensembleState(off.list[0], 'dca-1', chorus, cast())).toBe('partial')
  })

  it('is a plain removal when nothing carries them, and the row goes with it', () => {
    const placed = setChannelPlaced(scenesOf(), 's-1', 'dca-1', 'ch-2', true, cast())

    expect(setChannelPlaced(placed, 's-1', 'dca-1', 'ch-2', false, cast()).list[0].dcas).toEqual([])
  })

  it('is taken back by a hand placement, which says where the channel goes', () => {
    const applied = setRowEnsemble(scenesOf(), 's-1', 'dca-1', chorus, true, cast())
    const oneOff = setMemberExcluded(applied, 's-1', 'dca-1', 'ch-2', true)
    const back = setChannelPlaced(oneOff, 's-1', 'dca-1', 'ch-2', true, cast())

    expect(row(back)?.excluded).toEqual([])
    expect(row(back)?.channels).toEqual(['ch-2'])
    expect(collected(back)).toEqual(['ch-1', 'ch-2'])
    expect(ensembleState(back.list[0], 'dca-1', chorus, cast())).toBe('on')
  })

  it('drops a row whose only content was the exclusion, once it is taken back', () => {
    const excluded = setMemberExcluded(scenesOf(), 's-1', 'dca-1', 'ch-2', true)

    expect(row(excluded)?.excluded).toEqual(['ch-2'])
    expect(setMemberExcluded(excluded, 's-1', 'dca-1', 'ch-2', false).list[0].dcas).toEqual([])
  })
})

describe('a show that keeps one fader per channel', () => {
  it('takes a channel off the scene’s other rows when it is placed', () => {
    const elsewhere = setChannelPlaced(scenesOf([], false), 's-1', 'dca-2', 'ch-1', true, cast())
    const moved = setChannelPlaced(elsewhere, 's-1', 'dca-1', 'ch-1', true, cast())

    expect(channelDcas(moved.list[0], 'ch-1', cast())).toEqual(['dca-1'])
    expect(row(moved, 'dca-2')).toBeNull()
  })

  it('leaves the other rows alone while a channel may ride more than one', () => {
    // On by default: a show with a chorus and a band shares channels all the time.
    const elsewhere = setChannelPlaced(scenesOf(), 's-1', 'dca-2', 'ch-1', true, cast())
    const moved = setChannelPlaced(elsewhere, 's-1', 'dca-1', 'ch-1', true, cast())

    expect(channelDcas(moved.list[0], 'ch-1', cast())).toEqual(['dca-1', 'dca-2'])
  })

  it('collapses a duplicate a file still carries to the lowest-numbered fader', () => {
    // A scene written while the rule was on, read by a show that has turned it off. The
    // editor never builds one; a file can arrive with one, and a recall must write one
    // fader rather than two.
    const duplicated = scenesOf([
      { dcaId: 'dca-3', channels: ['ch-1'], ensembles: [], excluded: [] },
      { dcaId: 'dca-1', channels: ['ch-1'], ensembles: [], excluded: [] }
    ], false)
    const changes = sceneChanges(show(), duplicated.list[0], UNKNOWN_DESK_STATE)
    const kept = sceneChanges(show(cast(), false), duplicated.list[0], UNKNOWN_DESK_STATE)

    // With the rule on the file's duplicate is the show's own answer, both faders and all.
    expect(changes[0]).toEqual({
      channelId: 'ch-1',
      label: 'Ch 1 · Ruth',
      open: true,
      dcas: ['dca-1', 'dca-3']
    })
    expect(kept[0]).toEqual({
      channelId: 'ch-1',
      label: 'Ch 1 · Ruth',
      open: true,
      dcas: ['dca-1']
    })
  })
})

describe('a channel that leaves the console', () => {
  it('comes out of every scene’s placements and exclusions, and drops the rows it empties', () => {
    const settings = scenesOf([
      { dcaId: 'dca-1', channels: ['ch-1', 'ch-3'], ensembles: [], excluded: [] },
      { dcaId: 'dca-2', channels: [], ensembles: ['ens-1'], excluded: ['ch-1'] }
    ])
    const next = removeChannelsFromScenes(settings, ['ch-1'])

    expect(next.list[0].dcas[0].channels).toEqual(['ch-3'])
    // The exclusion goes too: a strip that is gone is not a member any row leaves off.
    expect(next.list[0].dcas[1].excluded).toEqual([])
    // ...and a row left saying nothing is dropped rather than kept as a shell.
    expect(removeChannelsFromScenes(settings, ['ch-3']).list[0].dcas[0].channels)
      .toEqual(['ch-1'])
    expect(removeChannelsFromScenes(
      scenesOf([{ dcaId: 'dca-1', channels: ['ch-1'], ensembles: [], excluded: [] }]),
      ['ch-1']
    ).list[0].dcas).toEqual([])
  })

  it('takes the whole tail of a count’s shrink out at once, in one pass', () => {
    // What a count shrinks by is several strips rather than one, and each of them leaves
    // every row the way a single strip does — placements, exclusions and emptied rows.
    const settings = scenesOf([
      { dcaId: 'dca-1', channels: ['ch-1', 'ch-2', 'ch-3'], ensembles: [], excluded: ['ch-2'] },
      { dcaId: 'dca-2', channels: ['ch-2'], ensembles: [], excluded: [] }
    ])
    const next = removeChannelsFromScenes(settings, ['ch-2', 'ch-3'])

    expect(next.list[0].dcas).toEqual([
      { dcaId: 'dca-1', channels: ['ch-1'], ensembles: [], excluded: [] }
    ])
    // Nothing dropped is nothing to do, and the list is the same one rather than a copy.
    expect(removeChannelsFromScenes(settings, [])).toBe(settings)
  })
})

describe('a fader that leaves the show', () => {
  it('takes its rows out of every scene, and leaves the other faders’ rows where they are', () => {
    // A row is a scene's word about one place on the desk, so a place the show no longer
    // has leaves no row behind: nothing to read, nothing to revive.
    const settings = scenesOf([
      { dcaId: 'dca-1', channels: ['ch-1'], ensembles: [], excluded: [] },
      { dcaId: 'dca-2', channels: ['ch-2'], ensembles: ['ens-1'], excluded: [] }
    ])
    const next = removeDcasFromScenes(settings, ['dca-2'])

    expect(next.list[0].dcas).toEqual([
      { dcaId: 'dca-1', channels: ['ch-1'], ensembles: [], excluded: [] }
    ])
    expect(removeDcasFromScenes(settings, [])).toBe(settings)
  })
})

describe('an ensemble that leaves the cast', () => {
  it('is unapplied from every row that had it, once it has gone', () => {
    const applied = setRowEnsemble(scenesOf(), 's-1', 'dca-1', chorus, true, cast())
    const kept = setChannelPlaced(applied, 's-1', 'dca-1', 'ch-3', true, cast())
    const next = removeEnsembleFromScenes(kept, 'ens-1')

    expect(next.list[0].dcas[0].ensembles).toEqual([])
    // What the row places by hand outlives the ensemble, exactly as it does on unapply.
    expect(next.list[0].dcas[0].channels).toEqual(['ch-3'])
    // A row that was only the ensemble goes: there is nothing left for it to say.
    expect(removeEnsembleFromScenes(applied, 'ens-1').list[0].dcas).toEqual([])
  })
})

describe('sceneChanges: what a recall writes', () => {
  it('gives every controlled channel an open and the faders it rides', () => {
    // The walk is the show's own channel list, so a channel the scene never mentions is
    // not left alone by accident — it is named here, closed, with no faders.
    expect(sceneChanges(show(), wedding, UNKNOWN_DESK_STATE)).toEqual([
      { channelId: 'ch-1', label: 'Ch 1 · Ruth', open: false, dcas: [] },
      { channelId: 'ch-2', label: 'Ch 2 · Sancho', open: true, dcas: ['dca-2'] },
      { channelId: 'ch-3', label: 'Ch 3', open: false, dcas: [] }
    ])
  })

  it('says nothing about a channel the record and the scene already agree about', () => {
    // This is what makes a recall a few messages rather than a sweep: both facts have to
    // match, which is why the record keeps a mute and a fader list per channel.
    expect(sceneChanges(show(), wedding, {
      mutes: { 'ch-1': true, 'ch-2': false, 'ch-3': true },
      assignments: { 'ch-1': [], 'ch-2': ['dca-2'], 'ch-3': [] }
    })).toEqual([])
  })

  it('writes a fact nothing is known about, rather than assuming the desk is where the show wants it', () => {
    // A fresh show, or the resync's emptied base: an absent key is a fact to write, not a
    // fact that happens to match.
    const known = {
      mutes: { 'ch-1': true, 'ch-2': false, 'ch-3': true },
      assignments: { 'ch-1': [], 'ch-2': ['dca-2'], 'ch-3': [] }
    }
    expect(sceneChanges(show(), wedding, { ...known, mutes: { 'ch-1': true, 'ch-2': false } }))
      .toEqual([{ channelId: 'ch-3', label: 'Ch 3', open: false, dcas: [] }])
    expect(sceneChanges(show(), wedding, { ...known, assignments: { 'ch-1': [], 'ch-3': [] } }))
      .toEqual([{ channelId: 'ch-2', label: 'Ch 2 · Sancho', open: true, dcas: ['dca-2'] }])
  })

  it('writes a channel whose fader moved while its mute did not', () => {
    // The mic that changes fader keeps playing: the record's mute still matches and the
    // faders do not — which is the whole reason the two facts are kept apart.
    const moved = sceneChanges(show(), wedding, {
      mutes: { 'ch-1': true, 'ch-2': false, 'ch-3': true },
      assignments: { 'ch-1': [], 'ch-2': ['dca-1'], 'ch-3': [] }
    })

    expect(moved).toEqual([{ channelId: 'ch-2', label: 'Ch 2 · Sancho', open: true, dcas: ['dca-2'] }])
  })

  it('closes the controlled set with no scene at all', () => {
    // The all-closed column is a real place the desk can be left, so it is a real recall:
    // every controlled channel is closed, and one the record believes is already muted is
    // not mentioned again.
    expect(sceneChanges(show(), null, UNKNOWN_DESK_STATE).map(change => change.open))
      .toEqual([false, false, false])
    expect(sceneChanges(show(), null, {
      mutes: { 'ch-1': true, 'ch-2': true, 'ch-3': true },
      assignments: { 'ch-1': [], 'ch-2': [], 'ch-3': [] }
    })).toEqual([])
  })

  it('names a channel the way the operator reads it, unnamed strips included', () => {
    expect(sceneChanges(show(), wedding, UNKNOWN_DESK_STATE).map(change => change.label))
      .toEqual(['Ch 1 · Ruth', 'Ch 2 · Sancho', 'Ch 3'])
  })
})

  it('is nothing at all for a channel the record has already settled', () => {
    // The record knows the channel is muted and has never carried an assignment: reading
    // that as "no faders" is what a recall would write from it, so a channel the scene
    // places nowhere is not a change. Reading it as *unknown* instead is a change that
    // produces no write — a "Recall now (n)" that never clears, on every desk whose
    // assignment route is refused, which is every note and OSC desk.
    const settled = {
      mutes: Object.fromEntries(cast().channels.map(channel => [channel.id, true])),
      assignments: {}
    }
    expect(sceneChanges(show(cast()), null, settled)).toEqual([])
    // A channel the record has never been told about at all is still a change: its mute is
    // a fact to write, and the empty stage is a real recall of the controlled set.
    expect(sceneChanges(show(cast()), null, { mutes: {}, assignments: {} }))
      .toHaveLength(cast().channels.length)
  })

describe('the walk a desk’s keys take through the scenes', () => {
  const list: MicScene[] = [
    { id: 's-1', name: 'Wedding', dcas: [], notes: '' },
    { id: 's-2', name: 'Interval', dcas: [], notes: '' },
    { id: 's-3', name: 'Finale', dcas: [], notes: '' }
  ]

  it('starts at the first scene when nothing has been recalled', () => {
    expect(sceneStep(list, null, 1)?.id).toBe('s-1')
  })

  it('moves one scene at a time, either way', () => {
    expect(sceneStep(list, 's-1', 1)?.id).toBe('s-2')
    expect(sceneStep(list, 's-3', -1)?.id).toBe('s-2')
  })

  it('has nowhere to go at either end', () => {
    expect(sceneStep(list, 's-3', 1)).toBeNull()
    expect(sceneStep(list, 's-1', -1)).toBeNull()
    expect(sceneStep(list, null, -1)).toBeNull()
  })

  it('starts the list again from the all-closed scene, which is before it rather than in it', () => {
    // Every mic closed is where a desk sits between numbers: it is not a scene to move into or
    // out of, so the walk treats it as the top of the list.
    expect(sceneStep(list, ALL_CLOSED_SCENE_ID, 1)?.id).toBe('s-1')
    expect(sceneStep(list, ALL_CLOSED_SCENE_ID, -1)).toBeNull()
  })

  it('starts the list again from a scene the show no longer has', () => {
    // Deleting a scene leaves wherever the desk stood pointing at nothing; the next GO should
    // begin the list rather than refuse with nothing to recall.
    expect(sceneStep(list, 's-gone', 1)?.id).toBe('s-1')
    expect(sceneStep(list, 's-gone', -1)).toBeNull()
  })

  it('has nowhere to go in a show with no scenes', () => {
    expect(sceneStep([], null, 1)).toBeNull()
  })
})
