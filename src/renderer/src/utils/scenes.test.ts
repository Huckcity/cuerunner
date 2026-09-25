// A scene owns the assignment, and this file is that model as pure operations: what one
// row of a scene holds, what placing a channel or an ensemble on it — or nothing — does,
// and — at the bottom — what a recall actually writes. The last one is the point of the
// file: given a scene and what the desk was last told, the controlled channels that move,
// and nothing outside the show's own channel list ever.
//
// The mute a recall sends and the frames a membership write carries are `utils/desk.ts`'s
// subject, tested there; what is tested here is the model above them, and the diff no
// message can reach past.
import { describe, it, expect } from 'vitest'
import {
  addScene,
  channelDcas,
  placementFor,
  removeChannelsFromScenes,
  removeDcasFromScenes,
  removeEnsembleFromScenes,
  removeScene,
  rowChannels,
  rowEnsemble,
  rowPerformers,
  sceneChanges,
  sceneChannelIds,
  sceneStep,
  setRowMember,
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
  RowMember,
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

function dca(id: string): Dca {
  return { id, deskNumber: null }
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
    dcas: [dca('dca-1'), dca('dca-2'), dca('dca-3')]
  }
}

const chorus: Ensemble = { id: 'ens-1', name: 'Chorus', members: ['p-1', 'p-2'] }

/** What a case puts on a row: a channel, by id. A row holds one thing. */
function channelOn(channelId: string): RowMember {
  return { kind: 'channel', memberId: channelId }
}

/** The chorus as what a row holds: the row names the group, never its members. */
const chorusOn: RowMember = { kind: 'ensemble', memberId: chorus.id }

/** One scene, with whatever rows a case is about. */
function scenesOf(dcas: SceneDcaPlacement[] = [], allowDuplicateAssignment = true): ScenesSettings {
  return {
    list: [{ id: 's-1', name: 'Wedding', dcas, notes: '' }],
    allowDuplicateAssignment
  }
}

/** One placement edit: the scene after its `dca-1` row is set to `member`. */
function placed(settings: ScenesSettings, member: RowMember | null, dcaId = 'dca-1'): ScenesSettings {
  return setRowMember(settings, 's-1', dcaId, member)
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
  dcas: [{ dcaId: 'dca-2', kind: 'channel', memberId: 'ch-2' }],
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
  it('carries the one thing the scene placed on it, and says nothing when the scene has no row', () => {
    const oneRow = placed(scenesOf(), channelOn('ch-1'))

    expect(row(oneRow)).toEqual({ dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' })
    expect(collected(oneRow)).toEqual(['ch-1'])
    // A fader the scene speaks for nowhere is not a row of empty lists: a row that says
    // nothing is dropped rather than kept as a shell.
    expect(row(oneRow, 'dca-2')).toBeNull()
    expect(rowChannels(cast(), null)).toEqual([])
  })

  it('holds one thing at a time: a placement replaces what the row had', () => {
    // A row means one thing, so a second placement is not a second member — it is the
    // row's new answer, and the channel it held before stops riding it.
    const oneRow = placed(scenesOf(), channelOn('ch-1'))
    const both = placed(oneRow, channelOn('ch-2'))

    expect(row(both)).toEqual({ dcaId: 'dca-1', kind: 'channel', memberId: 'ch-2' })
    expect(collected(both)).toEqual(['ch-2'])
  })

  it('takes the row out of the scene when the edit leaves it holding nothing', () => {
    const oneRow = placed(scenesOf(), channelOn('ch-1'))
    const off = placed(oneRow, null)

    // A null member is not a row of empty lists: it is the row leaving the scene, and a
    // scene that says nothing about a fader says nothing about it at all.
    expect(off.list[0].dcas).toEqual([])
    expect(row(off)).toBeNull()
  })

  it('reads a fader list per channel, in the show’s DCA order', () => {
    const twoRows = placed(placed(scenesOf(), channelOn('ch-1'), 'dca-3'), channelOn('ch-1'))

    expect(channelDcas(twoRows.list[0], 'ch-1', cast())).toEqual(['dca-1', 'dca-3'])
    expect(channelDcas(twoRows.list[0], 'ch-2', cast())).toEqual([])
    expect(channelDcas(null, 'ch-1', cast())).toEqual([])
    expect(sceneChannelIds(twoRows.list[0], cast())).toEqual(['ch-1'])
    expect(sceneChannelIds(null, cast())).toEqual([])
  })
})

describe('an ensemble applied to a row', () => {
  it('is membership rather than a copy: its members ride without being named', () => {
    const applied = placed(scenesOf(), chorusOn)

    expect(row(applied)).toEqual({ dcaId: 'dca-1', kind: 'ensemble', memberId: 'ens-1' })
    expect(rowEnsemble(cast(), row(applied))).toEqual(chorus)
    expect(collected(applied)).toEqual(['ch-1', 'ch-2'])
  })

  it('opens them in the show’s own order, not the order the group names them', () => {
    // The desk numbers its inputs in the show's order, so a row read back must not be the
    // member list: the chorus names p-2 first, and ch-1 is the first strip.
    const reversed: CastSettings = {
      ...cast(),
      ensembles: [{ ...chorus, members: ['p-2', 'p-1'] }]
    }
    const applied = placed(scenesOf(), chorusOn)

    expect(rowChannels(reversed, row(applied))).toEqual(['ch-1', 'ch-2'])
  })

  it('opens all of it, including whoever joins it after the scene was written', () => {
    // The row names the group rather than the members it happened to have, which is what
    // lets the chorus grow without the scene being edited again.
    const applied = placed(scenesOf(), chorusOn)
    const grown: CastSettings = {
      ...cast(),
      performers: [...cast().performers, performer('p-3', 'ch-3')],
      ensembles: [{ ...chorus, members: ['p-1', 'p-2', 'p-3'] }]
    }

    expect(collected(applied, 'dca-1', grown)).toEqual(['ch-1', 'ch-2', 'ch-3'])
  })

  it('replaces the channel the row held, the way any other placement does', () => {
    const applied = placed(placed(scenesOf(), channelOn('ch-3')), chorusOn)

    expect(row(applied)).toEqual({ dcaId: 'dca-1', kind: 'ensemble', memberId: 'ens-1' })
    // ch-3 was the row's own answer, and the row says one thing: the group supersedes it.
    expect(collected(applied)).toEqual(['ch-1', 'ch-2'])
  })

  it('reads as no ensemble on a row that holds a channel, or on one the scene never had', () => {
    const channelRow = placed(scenesOf(), channelOn('ch-1'))
    const applied = placed(scenesOf(), chorusOn)
    const off = placed(applied, null)

    expect(rowEnsemble(cast(), row(channelRow))).toBeNull()
    expect(rowEnsemble(cast(), row(applied))).toEqual(chorus)
    expect(rowEnsemble(cast(), row(off))).toBeNull()
    expect(rowEnsemble(cast(), null)).toBeNull()
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

describe('a show that keeps one fader per channel', () => {
  it('takes a channel off the scene’s other rows when it is placed', () => {
    const elsewhere = placed(scenesOf([], false), channelOn('ch-1'), 'dca-2')
    const moved = placed(elsewhere, channelOn('ch-1'))

    expect(channelDcas(moved.list[0], 'ch-1', cast())).toEqual(['dca-1'])
    expect(row(moved, 'dca-2')).toBeNull()
  })

  it('leaves the other rows alone while a channel may ride more than one', () => {
    // On by default: a show with a chorus and a band shares channels all the time.
    const elsewhere = placed(scenesOf(), channelOn('ch-1'), 'dca-2')
    const moved = placed(elsewhere, channelOn('ch-1'))

    expect(channelDcas(moved.list[0], 'ch-1', cast())).toEqual(['dca-1', 'dca-2'])
  })

  it('clears channel rows and never the group holding a channel', () => {
    // A scene that applies the chorus and also rides one of its members by hand is not the
    // duplicate the rule is about: the group is not a channel placement.
    const byHand = placed(scenesOf([], false), channelOn('ch-1'))
    const applied = placed(byHand, chorusOn, 'dca-2')

    expect(channelDcas(applied.list[0], 'ch-1', cast())).toEqual(['dca-1', 'dca-2'])
    // And the other way round: placing a channel clears the scene's other channel rows, and
    // the group's row is not one of them.
    const moved = placed(placed(scenesOf([], false), chorusOn, 'dca-2'), channelOn('ch-1'))
    expect(channelDcas(moved.list[0], 'ch-1', cast())).toEqual(['dca-1', 'dca-2'])
    expect(rowEnsemble(cast(), row(moved, 'dca-2'))).toEqual(chorus)
  })

  it('collapses a duplicate a file still carries to the lowest-numbered fader', () => {
    // A scene written while the rule was on, read by a show that has turned it off. The
    // editor never builds one; a file can arrive with one, and a recall must write one
    // fader rather than two.
    const duplicated = scenesOf([
      { dcaId: 'dca-3', kind: 'channel', memberId: 'ch-1' },
      { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' }
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
  it('comes out of the scenes’ rows, and a row left holding nothing goes with it', () => {
    const settings = scenesOf([
      { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' },
      { dcaId: 'dca-2', kind: 'ensemble', memberId: 'ens-1' }
    ])

    // The row that named the strip goes...
    expect(removeChannelsFromScenes(settings, ['ch-1']).list[0].dcas).toEqual([
      { dcaId: 'dca-2', kind: 'ensemble', memberId: 'ens-1' }
    ])
    // ...while a row holding an ensemble stays: the group still exists, and who stands on
    // the strips it opens is the cast's business rather than the scene's.
    expect(removeChannelsFromScenes(settings, ['ch-2']).list[0].dcas).toEqual(settings.list[0].dcas)
  })

  it('takes the whole tail of a count’s shrink out at once, in one pass', () => {
    // What a count shrinks by is several strips rather than one, and each of them leaves
    // every row the way a single strip does — the rows that held them go, the rest stay.
    const settings = scenesOf([
      { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-2' },
      { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-1' },
      { dcaId: 'dca-3', kind: 'ensemble', memberId: 'ens-1' }
    ])
    const next = removeChannelsFromScenes(settings, ['ch-2', 'ch-3'])

    expect(next.list[0].dcas).toEqual([
      { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-1' },
      { dcaId: 'dca-3', kind: 'ensemble', memberId: 'ens-1' }
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
      { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' },
      { dcaId: 'dca-2', kind: 'ensemble', memberId: 'ens-1' }
    ])
    const next = removeDcasFromScenes(settings, ['dca-2'])

    expect(next.list[0].dcas).toEqual([
      { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' }
    ])
    expect(removeDcasFromScenes(settings, [])).toBe(settings)
  })
})

describe('an ensemble that leaves the cast', () => {
  it('drops every row that held it, and leaves the rows that hold a channel', () => {
    const settings = scenesOf([
      { dcaId: 'dca-1', kind: 'ensemble', memberId: 'ens-1' },
      { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-1' }
    ])
    const next = removeEnsembleFromScenes(settings, 'ens-1')

    // A row that was only the group goes: there is nothing left for it to say.
    expect(next.list[0].dcas).toEqual([
      { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-1' }
    ])
    // A row holding a channel is not the group's business, and stays.
    expect(removeEnsembleFromScenes(settings, 'ens-2').list[0].dcas).toEqual(settings.list[0].dcas)
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
