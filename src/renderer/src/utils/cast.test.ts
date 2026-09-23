// The cast's operations are pure: the channels on the console, the performers patched to
// them, the ensembles that group them and the faders the desk has. What is tested here is
// the setup the scenes are read against — plus the defaults that let a new show run before
// anything has been placed.
//
// Nothing here says which fader a channel rides: a strip is a name and a number, and the
// assignment belongs to the scene that makes it, so the only thing a DCA carries of its own
// is the desk number the operator typed when their desk numbers its faders differently.
import { describe, it, expect } from 'vitest'
import {
  addChannel,
  addEnsemble,
  addPerformer,
  channelLabel,
  ensembleMembers,
  performerChannel,
  removeChannel,
  removeEnsemble,
  removePerformerFromCast,
  setDcaCount,
  updateChannel,
  updateDca,
  updateEnsemble,
  updatePerformer
} from './cast'
import { DCA_LIMIT, defaultCastSettings, startingChannels, startingDcas } from '../../../shared/show'
import type { CastSettings, Performer } from '../../../shared/show'

function empty(): CastSettings {
  return { channels: [], performers: [], ensembles: [], dcas: [] }
}

/** Two faders and three strips: the smallest setup in which a strip can be patched to none. */
function wired(): CastSettings {
  return {
    ...setDcaCount(empty(), 2),
    channels: [
      { id: 'ch-1', name: 'Ruth' },
      { id: 'ch-2', name: 'Band' },
      { id: 'ch-3', name: '' }
    ]
  }
}

function patchTo(channelId: string | null): Performer {
  return { id: 'p1', name: 'Ruth', role: 'Lead', notes: '', channelId }
}

describe('a new show', () => {
  it('comes with a console: twelve strips and twelve faders, none of them placed', () => {
    const cast = defaultCastSettings()

    expect(cast.channels).toHaveLength(12)
    expect(cast.dcas).toHaveLength(12)
    expect(cast.channels.every(channel => channel.name === '')).toBe(true)
    expect(cast.dcas.map(dca => dca.label)).toEqual(cast.dcas.map((_, index) => `DCA ${index + 1}`))
    // Nothing has been assigned, to a strip or to a command: a new show's faders are where
    // the scenes put the channels, and every fader is addressed by the number its place
    // derives until somebody says otherwise.
    expect(cast.dcas.every(dca => dca.deskNumber === null)).toBe(true)
    expect(cast.performers).toEqual([])
    expect(cast.ensembles).toEqual([])
  })

  it('numbers its strips and its faders by their place, from one, and by nothing else', () => {
    // The ids are what a scene's placement names, so they are stable across two copies of
    // the same show: the third DCA of a show is its third DCA everywhere.
    expect(startingChannels().map(channel => channel.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `channel-${index + 1}`)
    )
    expect(startingDcas().map(dca => dca.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `dca-${index + 1}`)
    )
  })
})

describe('performers', () => {
  it('lands on the first strip nobody is on, so casting is a name and nothing else', () => {
    const cast = addPerformer(addPerformer(defaultCastSettings(), 'Ruth', 'Lead'), 'Sancho', 'Comic')

    const [ruth, sancho] = cast.performers
    expect(ruth.channelId).toBe(cast.channels[0].id)
    expect(sancho.channelId).toBe(cast.channels[1].id)
    // The strip they landed on is what carries them to the desk; which fader it rides is
    // the scene's decision, and neither strip has been placed by anything here.
    expect(performerChannel(ruth, cast.channels)?.id).toBe(cast.channels[0].id)
  })

  it('takes a new strip when every one is taken, because a row with no strip can never be open', () => {
    let cast = defaultCastSettings()
    for (let i = 0; i < 12; i++) cast = addPerformer(cast, `Performer ${i + 1}`, '')

    const thirteenth = addPerformer(cast, 'Swing', '')
    expect(thirteenth.channels).toHaveLength(13)
    expect(thirteenth.performers[12].channelId).toBe(thirteenth.channels[12].id)
    // The new strip is unnamed until they are, and it rides no fader until a scene places
    // it: a strip is a name and a number, and the placement is not its own.
    expect(thirteenth.channels[12].name).toBe('')
  })

  it('names the strip they are on, while nobody has named it themselves', () => {
    const cast = addPerformer(defaultCastSettings(), 'New performer', '')
    const id = cast.performers[0].id

    const named = updatePerformer(cast, id, { name: 'Ruth' })
    expect(named.channels[0].name).toBe('Ruth')

    // A strip somebody named is left alone: a swing wearing Ruth's spare mic is not Ruth.
    const theirOwn = updateChannel(named, named.channels[0].id, { name: 'Spare 1' })
    expect(updatePerformer(theirOwn, id, { name: 'Nell' }).channels[0].name).toBe('Spare 1')
  })

  it('removes a performer from every ensemble as well as the cast list', () => {
    const cast = addPerformer(addPerformer(empty(), 'Ruth', 'Lead'), 'Sancho', 'Comic')
    const [ruth, sancho] = cast.performers
    const grouped = addEnsemble(cast, 'Chorus', [ruth.id, sancho.id])

    const next = removePerformerFromCast(grouped, ruth.id)
    expect(next.performers.map(performer => performer.id)).toEqual([sancho.id])
    expect(next.ensembles[0].members).toEqual([sancho.id])
  })
})

describe('channels', () => {
  it('appends a strip after the last one, and places it nowhere', () => {
    const cast = defaultCastSettings()
    const grown = addChannel(cast, 'Spare')

    expect(grown.channels[12].name).toBe('Spare')
    // Nothing about the new strip says which fader it rides: an assignment is a scene's,
    // and there is no field here to carry one.
    expect(grown.channels[12]).toEqual({ id: grown.channels[12].id, name: 'Spare' })
    expect(Object.keys(grown.channels[12]).sort()).toEqual(['id', 'name'])
  })

  it('unpatches whoever was on the strip it removes', () => {
    const cast = addPerformer(wired(), 'Ruth', 'Lead')
    const next = removeChannel(cast, 'ch-1')

    expect(next.channels.map(channel => channel.id)).toEqual(['ch-2', 'ch-3'])
    expect(next.performers[0].channelId).toBeNull()
    // The numbers after it close up, because a strip's number is its place in the list.
    expect(channelLabel(next.channels, 'ch-2')).toBe('Ch 1 · Band')
  })

  it('finds the strip a performer is on, for a panel that shows it by name', () => {
    const cast = wired()
    expect(performerChannel(patchTo('ch-2'), cast.channels)?.name).toBe('Band')
    expect(performerChannel(patchTo(null), cast.channels)).toBeNull()
  })

  it('numbers a strip by its place in the list, named or not', () => {
    const cast = wired()
    expect(channelLabel(cast.channels, 'ch-3')).toBe('Ch 3')
    expect(channelLabel(cast.channels, 'ch-1')).toBe('Ch 1 · Ruth')
    expect(channelLabel(cast.channels, null)).toBe('')
  })
})

describe('ensembles', () => {
  it('is created with whoever it is made from, and named if it was not', () => {
    const first = addEnsemble(empty())
    expect(first.ensembles[0].name).toBe('Ensemble 1')
    expect(first.ensembles[0].members).toEqual([])

    const second = addEnsemble(first, '  Chorus  ', ['p1', 'p2'])
    expect(second.ensembles[1]).toMatchObject({ name: 'Chorus', members: ['p1', 'p2'] })
  })

  it('holds membership as a list, so a performer can be in two of them', () => {
    const cast = addPerformer(addPerformer(empty(), 'Ruth', 'Lead'), 'Sancho', 'Comic')
    const [ruth, sancho] = cast.performers
    const two = addEnsemble(addEnsemble(cast, 'Chorus', [ruth.id]), 'Band', [ruth.id, sancho.id])

    expect(ensembleMembers(two, two.ensembles[0].id).map(performer => performer.name)).toEqual(['Ruth'])
    expect(ensembleMembers(two, two.ensembles[1].id).map(performer => performer.name))
      .toEqual(['Ruth', 'Sancho'])
  })

  it('lists members in cast order and drops the ones who have left', () => {
    const cast = addPerformer(addPerformer(empty(), 'Ruth', 'Lead'), 'Sancho', 'Comic')
    const [ruth, sancho] = cast.performers
    const grouped = addEnsemble(cast, 'Chorus', [sancho.id, ruth.id])

    expect(ensembleMembers(grouped, grouped.ensembles[0].id).map(p => p.name)).toEqual(['Ruth', 'Sancho'])
    expect(ensembleMembers(removePerformerFromCast(grouped, ruth.id), grouped.ensembles[0].id)
      .map(p => p.name)).toEqual(['Sancho'])
  })

  it('removes the ensemble and nothing else', () => {
    const cast = addPerformer(empty(), 'Ruth', 'Lead')
    const grouped = addEnsemble(cast, 'Chorus', [cast.performers[0].id])
    const next = removeEnsemble(grouped, grouped.ensembles[0].id)
    expect(next.ensembles).toEqual([])
    expect(next.performers).toEqual(cast.performers)
  })

  it('renames and re-members in one edit', () => {
    const cast = addPerformer(addPerformer(empty(), 'Ruth', 'Lead'), 'Sancho', 'Comic')
    const [ruth, sancho] = cast.performers
    const grouped = addEnsemble(cast, 'Chorus', [ruth.id])
    const id = grouped.ensembles[0].id

    const next = updateEnsemble(grouped, id, { members: [sancho.id] })
    expect(ensembleMembers(next, id).map(performer => performer.name)).toEqual(['Sancho'])
  })
})

describe('DCAs', () => {
  it('grows to the count asked for, each one labelling itself and addressing its own place', () => {
    const cast = setDcaCount(empty(), 3)
    expect(cast.dcas).toHaveLength(3)
    expect(cast.dcas.map(dca => dca.label)).toEqual(['DCA 1', 'DCA 2', 'DCA 3'])
    expect(cast.dcas.every(dca => dca.deskNumber === null)).toBe(true)
  })

  it('leaves the strips exactly as they were when the list shrinks', () => {
    // The count is the show's list of faders, and nothing else moves with it: a scene that
    // placed a channel on a fader that is gone keeps the entry — it names a fader the show
    // no longer has, so no row and no recall reads it, and the place comes back if the
    // fader does. A strip has no assignment of its own to fall back to, and none to lose.
    const cast = wired()
    const next = setDcaCount(cast, 1)

    expect(next.dcas.map(dca => dca.label)).toEqual(['DCA 1'])
    expect(next.channels).toEqual(cast.channels)
    expect(setDcaCount(cast, 0).dcas).toEqual([])
    expect(setDcaCount(cast, 0).channels).toEqual(cast.channels)
  })

  it('is not moved by a count it already has', () => {
    const cast = wired()
    expect(setDcaCount(cast, 2)).toBe(cast)
  })

  it('stays inside the range a desk can be asked for', () => {
    expect(setDcaCount(empty(), 40).dcas).toHaveLength(DCA_LIMIT)
    expect(setDcaCount(wired(), -3).dcas).toHaveLength(0)
  })

  it('is labelled and given by hand the number its desk addresses it by', () => {
    // The override is the desk's own numbering: an operator whose desk calls its first
    // fader something else types that number, and every route to the fader reads it.
    const cast = setDcaCount(empty(), 1)
    const next = updateDca(cast, cast.dcas[0].id, { label: 'Chorus', deskNumber: 36 })

    expect(next.dcas[0]).toMatchObject({ label: 'Chorus', deskNumber: 36 })
    expect(next.dcas[0].id).toBe(cast.dcas[0].id)
  })
})
