// The cast's operations are pure, same as the plot's: the channels on the console, the
// performers patched to them, the ensembles that group them and the DCAs they open. What
// is tested here is the resolution the whole feature hangs off — which DCA a performer's
// mic actually opens — plus the CRUD that keeps the four lists from drifting apart.
import { describe, it, expect } from 'vitest'
import {
  addChannel,
  addEnsemble,
  addPerformer,
  channelLabel,
  describeDeskMessage,
  ensembleMembers,
  midiNoteMessages,
  oscMessages,
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
import { DCA_LIMIT } from '../types/show'
import type { CastSettings, Performer, ShowChannel } from '../types/show'

function empty(): CastSettings {
  return { channels: [], performers: [], ensembles: [], dcas: [] }
}

/** Two DCAs and three strips, the second of them switched out of the patch. */
function wired(): CastSettings {
  const base = setDcaCount(empty(), 2)
  const [first, second] = base.dcas
  const channels: ShowChannel[] = [
    { id: 'ch-1', name: 'Ruth', enabled: true, dcaId: first.id },
    { id: 'ch-2', name: 'Band', enabled: false, dcaId: second.id },
    { id: 'ch-3', name: '', enabled: true, dcaId: null }
  ]
  return { ...base, channels }
}

describe('performers', () => {
  it('adds a performer who is patched to nothing yet', () => {
    const cast = addPerformer(empty(), 'Ruth', 'Lead')
    expect(cast.performers).toHaveLength(1)
    expect(cast.performers[0]).toMatchObject({ name: 'Ruth', role: 'Lead', channelId: null })
  })

  it('updates by id, leaving the rest alone', () => {
    const cast = addPerformer(addPerformer(empty(), 'Ruth', 'Lead'), 'Sancho', 'Comic')
    const [first, second] = cast.performers
    const next = updatePerformer(cast, second.id, { name: 'Sancho Panza' })
    expect(next.performers[0]).toEqual(first)
    expect(next.performers[1].name).toBe('Sancho Panza')
  })

  it('removes a performer from every ensemble as well as the cast list', () => {
    const cast = addPerformer(addPerformer(empty(), 'Ruth', 'Lead'), 'Sancho', 'Comic')
    const [ruth, sancho] = cast.performers
    const grouped = addEnsemble({ ...cast, ensembles: [] }, 'Chorus', [ruth.id, sancho.id])

    const next = removePerformerFromCast(grouped, ruth.id)
    expect(next.performers.map(performer => performer.id)).toEqual([sancho.id])
    expect(next.ensembles[0].members).toEqual([sancho.id])
  })
})

describe('channels', () => {
  it('appends a strip, named or not', () => {
    const cast = addChannel(addChannel(empty(), 'Ruth'), '')
    expect(cast.channels.map(channel => channel.name)).toEqual(['Ruth', ''])
    expect(cast.channels.every(channel => channel.enabled && channel.dcaId === null)).toBe(true)
  })

  it('unpatches whoever was on the strip it removes', () => {
    const cast = addPerformer(wired(), 'Ruth', 'Lead')
    const performerId = cast.performers[0].id
    const patched = updatePerformer(cast, performerId, { channelId: 'ch-1' })

    const next = removeChannel(patched, 'ch-1')
    expect(next.channels.map(channel => channel.id)).toEqual(['ch-2', 'ch-3'])
    expect(next.performers[0].channelId).toBeNull()
  })
})

describe('the DCA a mic opens', () => {
  it('is the one its strip is assigned to', () => {
    const cast = wired()
    expect(performerDcaId(patchTo('ch-1'), cast.channels)).toBe(cast.dcas[0].id)
  })

  it('is nothing when the strip is out of tonight’s patch', () => {
    const cast = wired()
    expect(performerDcaId(patchTo('ch-2'), cast.channels)).toBeNull()
  })

  it('is nothing when the performer is unpatched, or their strip is in no DCA', () => {
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
  it('grows to the count asked for, each one unpatched', () => {
    const cast = setDcaCount(empty(), 3)
    expect(cast.dcas).toHaveLength(3)
    expect(cast.dcas.map(dca => dca.label)).toEqual(['DCA 1', 'DCA 2', 'DCA 3'])
    expect(cast.dcas.every(dca => dca.mute === null && dca.unmute === null)).toBe(true)
  })

  it('takes the last ones off rather than renumbering, and unpicks what they carried', () => {
    const cast = wired()
    const next = setDcaCount(cast, 1)
    expect(next.dcas.map(dca => dca.label)).toEqual(['DCA 1'])
    // The strip that was in the second DCA is still there, in no DCA at all.
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

  it('is labelled and patched in place', () => {
    const cast = setDcaCount(empty(), 1)
    const id = cast.dcas[0].id
    const next = updateDca(cast, id, { label: 'Chorus', ...midiNoteMessages('Desk', 1, 12) })
    expect(next.dcas[0].label).toBe('Chorus')
    expect(describeDeskMessage(next.dcas[0].unmute)).toBe('noteOn ch1 → "Desk"')
    expect(describeDeskMessage(next.dcas[0].mute)).toBe('noteOff ch1 → "Desk"')
  })
})

describe('desk messages', () => {
  it('reads an OSC patch back the way it was set', () => {
    const { mute, unmute } = oscMessages('10.0.0.5', 9000, '/dca/2', [1], [0])
    expect(describeDeskMessage(unmute)).toBe('OSC /dca/2 1 → 10.0.0.5:9000')
    expect(describeDeskMessage(mute)).toBe('OSC /dca/2 0 → 10.0.0.5:9000')
  })

  it('says nothing happened when a DCA is unpatched', () => {
    expect(describeDeskMessage(null)).toBe('nothing')
  })
})

/** A performer with nothing on them but the patch under test. */
function patchTo(channelId: string | null): Performer {
  return { id: 'p1', name: 'Ruth', role: 'Lead', notes: '', channelId }
}
