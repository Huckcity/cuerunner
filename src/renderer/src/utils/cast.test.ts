// The cast's operations are pure: the channels on the console, the performers patched to
// them, the ensembles that group them and the DCAs they open. What is tested here is the
// resolution the whole feature hangs off — which DCA a performer's mic actually opens —
// plus the que that keeps the four lists from drifting apart, and the defaults that let a
// new show run before anything has been assigned.
import { describe, it, expect } from 'vitest'
import {
  addChannel,
  addEnsemble,
  addPerformer,
  channelLabel,
  ensembleMembers,
  performerChannel,
  performerDcaId,
  removeChannel,
  removeEnsemble,
  removePerformerFromCast,
  setDcaCount,
  updateChannel,
  updateDca,
  updateEnsemble,
  updatePerformer
} from './cast'
import { DCA_LIMIT, defaultCastSettings, startingDcas, startingChannels } from '../types/show'
import type { CastSettings, Performer } from '../types/show'

function empty(): CastSettings {
  return { channels: [], performers: [], ensembles: [], dcas: [] }
}

/** Two DCAs and two strips, the first of them driving the first DCA. */
function wired(): CastSettings {
  const base = setDcaCount(empty(), 2)
  const [first, second] = base.dcas
  const channels = [
    { id: 'ch-1', name: 'Ruth', dcaId: first.id },
    { id: 'ch-2', name: 'Band', dcaId: second.id },
    { id: 'ch-3', name: '', dcaId: null }
  ]
  return { ...base, channels }
}

function patchTo(channelId: string | null): Performer {
  return { id: 'p1', name: 'Ruth', role: 'Lead', notes: '', channelId }
}

describe('a new show', () => {
  it('comes with a console: twelve strips, twelve DCAs, strip n on DCA n', () => {
    const cast = defaultCastSettings()

    expect(cast.channels).toHaveLength(12)
    expect(cast.dcas).toHaveLength(12)
    expect(cast.channels.map(channel => channel.dcaId))
      .toEqual(cast.dcas.map(dca => dca.id))
    expect(cast.dcas.map(dca => dca.label)).toEqual(cast.dcas.map((_, index) => `DCA ${index + 1}`))
    expect(cast.dcas.every(dca => dca.note === null && dca.address === null)).toBe(true)
  })

  it('counts a strip by its place, in the DCAs it is given', () => {
    const dcas = startingDcas()
    const channels = startingChannels(dcas)
    expect(channels[0].dcaId).toBe(dcas[0].id)
    expect(channels[11].dcaId).toBe(dcas[11].id)
  })
})

describe('performers', () => {
  it('lands on the first strip nobody is on, so casting is a name and nothing else', () => {
    const cast = addPerformer(addPerformer(defaultCastSettings(), 'Ruth', 'Lead'), 'Sancho', 'Comic')

    const [ruth, sancho] = cast.performers
    expect(ruth.channelId).toBe(cast.channels[0].id)
    expect(sancho.channelId).toBe(cast.channels[1].id)
    // ...and the DCA their mic opens is that strip's, which is the one of its number.
    expect(performerDcaId(ruth, cast.channels)).toBe(cast.dcas[0].id)
    expect(performerDcaId(sancho, cast.channels)).toBe(cast.dcas[1].id)
  })

  it('takes a new strip when every one is taken, because a row with no strip can never be open', () => {
    let cast = defaultCastSettings()
    for (let i = 0; i < 12; i++) cast = addPerformer(cast, `Performer ${i + 1}`, '')

    const thirteenth = addPerformer(cast, 'Swing', '')
    expect(thirteenth.channels).toHaveLength(13)
    expect(thirteenth.performers[12].channelId).toBe(thirteenth.channels[12].id)
    // The thirteenth strip is past the last DCA, so it drives nothing until somebody says
    // which fader it rides.
    expect(thirteenth.channels[12].dcaId).toBeNull()
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
  it('appends a strip driving the DCA of its own place', () => {
    const cast = defaultCastSettings()
    const grown = addChannel(cast, 'Spare')

    expect(grown.channels[12].name).toBe('Spare')
    // Past the twelfth DCA there is no fader of its own number, so it drives none.
    expect(grown.channels[12].dcaId).toBeNull()
  })

  it('unpatches whoever was on the strip it removes', () => {
    const cast = addPerformer(wired(), 'Ruth', 'Lead')
    const next = removeChannel(cast, 'ch-1')

    expect(next.channels.map(channel => channel.id)).toEqual(['ch-2', 'ch-3'])
    expect(next.performers[0].channelId).toBeNull()
  })
})

describe('the DCA a mic opens', () => {
  it('is the one its strip drives', () => {
    const cast = wired()
    expect(performerDcaId(patchTo('ch-1'), cast.channels)).toBe(cast.dcas[0].id)
  })

  it('is nothing when the performer is unpatched, or their strip drives no fader', () => {
    const cast = wired()
    expect(performerDcaId(patchTo(null), cast.channels)).toBeNull()
    expect(performerDcaId(patchTo('ch-3'), cast.channels)).toBeNull()
  })

  it('follows a strip that is moved to another DCA', () => {
    const cast = wired()
    const moved = updateChannel(cast, 'ch-1', { dcaId: cast.dcas[1].id })
    expect(performerDcaId(patchTo('ch-1'), moved.channels)).toBe(cast.dcas[1].id)
  })

  it('finds the strip itself, for a panel that shows it by name', () => {
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
  it('grows to the count asked for, each one labelling and driving itself', () => {
    const cast = setDcaCount(empty(), 3)
    expect(cast.dcas).toHaveLength(3)
    expect(cast.dcas.map(dca => dca.label)).toEqual(['DCA 1', 'DCA 2', 'DCA 3'])
    expect(cast.dcas.every(dca => dca.note === null && dca.address === null)).toBe(true)
  })

  it('puts the strips of the DCAs it drops back on the fader of their own number', () => {
    const cast = wired()
    const next = setDcaCount(cast, 1)

    expect(next.dcas.map(dca => dca.label)).toEqual(['DCA 1'])
    // The strip that was on the second DCA falls back to the DCA of its own place — the
    // second place, which is now past the end — rather than pointing at a fader that is gone.
    expect(next.channels.find(channel => channel.id === 'ch-2')?.dcaId).toBeNull()
    expect(next.channels.find(channel => channel.id === 'ch-1')?.dcaId).toBe(cast.dcas[0].id)
  })

  it('is not moved by a count it already has', () => {
    const cast = wired()
    expect(setDcaCount(cast, 2)).toBe(cast)
  })

  it('stays inside the range a desk can be asked for', () => {
    expect(setDcaCount(empty(), 40).dcas).toHaveLength(DCA_LIMIT)
    expect(setDcaCount(wired(), -3).dcas).toHaveLength(0)
  })

  it('is labelled and given an override of its own where the desk differs', () => {
    const cast = setDcaCount(empty(), 1)
    const id = cast.dcas[0].id
    const next = updateDca(cast, id, { label: 'Chorus', note: 12, address: '/mixer/chorus' })

    expect(next.dcas[0]).toMatchObject({ label: 'Chorus', note: 12, address: '/mixer/chorus' })
  })
})
