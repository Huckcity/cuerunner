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
  setChannelCount,
  setDcaCount,
  stripLabel,
  updateChannel,
  updateDca,
  updateEnsemble,
  updatePerformer
} from './cast'
import {
  CHANNEL_LIMIT,
  DCA_LIMIT,
  defaultCastSettings,
  startingChannels,
  startingDcas
} from '../../../shared/show'
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

  it('names a strip for the grid: its own name, or whoever is standing on it, its number last', () => {
    // The grid is where the show is built out of people, so "Ch 1" is the one thing it
    // should not say about a strip that has been named or cast. The console's own reading,
    // number first, stays the desk's vocabulary — the run log and the change list.
    const cast = wired()
    expect(stripLabel(cast.channels, cast.performers, 'ch-1')).toBe('Ruth')
    expect(stripLabel(cast.channels, cast.performers, 'ch-3')).toBe('Ch 3')
    expect(stripLabel(cast.channels, cast.performers, null)).toBe('')

    // A name the operator gave the strip wins over the performer's: the strip is what the
    // console is called, and whoever is on it is who the name was written for.
    const named = { ...cast, channels: [{ id: 'ch-1', name: 'Vocal 1' }] }
    expect(stripLabel(named.channels, named.performers, 'ch-1')).toBe('Vocal 1')

    // A performer with no name of their own is called by their part, on a strip the
    // operator has not named either.
    const roley = {
      ...cast,
      performers: [{ id: 'p9', name: '', role: 'Swing', notes: '', channelId: 'ch-3' }]
    }
    expect(stripLabel(roley.channels, roley.performers, 'ch-3')).toBe('Swing')
  })

  it('grows to the count asked for, minting strips the way one added by hand is', () => {
    const cast = wired()
    const grown = setChannelCount(cast, 5)

    expect(grown.channels).toHaveLength(5)
    // What survives the count is the same strip: same order, same names, same ids.
    expect(grown.channels.slice(0, 3)).toEqual(cast.channels)
    expect(grown.channels.slice(3).map(channel => channel.name)).toEqual(['', ''])
    // A strip a count adds is a new entity, exactly as `+ Channel` makes one.
    const added = grown.channels[3]
    expect(added.id).not.toBe('')
    expect(new Set(grown.channels.map(channel => channel.id)).size).toBe(5)
  })

  it('drops the tail when the count shrinks, and leaves the rest of the cast alone', () => {
    const cast = wired()
    const next = setChannelCount(cast, 2)

    expect(next.channels.map(channel => channel.id)).toEqual(['ch-1', 'ch-2'])
    expect(next.dcas).toEqual(cast.dcas)
    expect(next.performers).toEqual(cast.performers)
    // Who was patched to a strip that went, and what the scenes placed on it, are the
    // store action's consequences — not something a pure resize decides on its own.
    expect(setChannelCount(cast, 0).channels).toEqual([])
  })

  it('is not moved by a count it already has', () => {
    const cast = wired()
    expect(setChannelCount(cast, 3)).toBe(cast)
  })

  it('leaves a show that is already past the cap the size it is', () => {
    // A show grows past the dial's cap by hand — `+ Channel`, and a performer minting a
    // strip when every one is taken — and the dial then offers it back its own count. That
    // count is not an instruction to trim: the cap bounds growth, and a show asked for the
    // size it has is the show it already was.
    const cast: CastSettings = {
      ...empty(),
      channels: Array.from({ length: CHANNEL_LIMIT + 4 }, (_, index) => ({
        id: `ch-${index + 1}`,
        name: ''
      })),
      performers: [patchTo(`ch-${CHANNEL_LIMIT + 4}`)]
    }

    expect(setChannelCount(cast, cast.channels.length)).toBe(cast)
    expect(setChannelCount(cast, 500)).toBe(cast)
    expect(cast.performers[0].channelId).toBe(`ch-${CHANNEL_LIMIT + 4}`)
    // It still shrinks when it is asked to, mic and all.
    expect(setChannelCount(cast, 2).channels).toHaveLength(2)
    expect(setChannelCount(cast, 2).performers[0].channelId).toBeNull()
  })

  it('stays inside the range the dial can offer', () => {
    expect(setChannelCount(empty(), 200).channels).toHaveLength(CHANNEL_LIMIT)
    expect(setChannelCount(wired(), -3).channels).toEqual([])
    expect(setChannelCount(empty(), 2.6).channels).toHaveLength(3)
  })

  it('drops the tail’s mics with the strips, the way removing one strip does', () => {
    const cast: CastSettings = { ...wired(), performers: [patchTo('ch-3')] }
    const next = setChannelCount(cast, 2)

    expect(next.performers[0].channelId).toBeNull()
    // A strip that survives keeps its mic: nobody moves who was not standing on the tail.
    expect(setChannelCount({ ...cast, performers: [patchTo('ch-1')] }, 2).performers[0].channelId)
      .toBe('ch-1')
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
    // The count is the show's list of faders, and nothing else moves with it here: what
    // happens to the scenes that named the faders that went is the store action's, which
    // drops those rows in the same edit. A strip has no assignment of its own to fall back
    // to, and none to lose.
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

  it('keeps a fader list already past the cap at the size it is', () => {
    // A file can carry more faders than the dial offers and the DCAs section offers that
    // count back. Taking it is not an instruction to trim the list — the cap bounds what
    // the show is asked to grow to, never what it holds.
    const cast: CastSettings = {
      ...empty(),
      dcas: Array.from({ length: DCA_LIMIT + 3 }, (_, index) => ({
        id: `dca-${index + 1}`,
        label: `DCA ${index + 1}`,
        deskNumber: null
      }))
    }

    expect(setDcaCount(cast, cast.dcas.length)).toBe(cast)
    expect(setDcaCount(cast, 500)).toBe(cast)
    expect(setDcaCount(cast, 1).dcas).toHaveLength(1)
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
