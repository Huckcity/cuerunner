// The cast's operations are pure, same as the plot's: performers, the ensembles that
// group them, and the desk groups they drive. What is tested here is the one thing the
// whole feature exists for — resolving which group a performer's mic actually opens —
// plus the CRUD that keeps performers, ensembles and groups from drifting apart.
import { describe, it, expect } from 'vitest'
import {
  addDeskGroup,
  addEnsemble,
  addPerformer,
  clearDeskGroupPointers,
  describeDeskMessage,
  ensembleMembers,
  midiNoteMessages,
  oscMessages,
  removeDeskGroup,
  removeEnsemble,
  removePerformerFromCast,
  resolvedGroupId,
  updateDeskGroup,
  updateEnsemble,
  updatePerformer
} from './cast'
import type { CastSettings } from '../types/show'

function empty(): CastSettings {
  return { groups: [], performers: [], ensembles: [] }
}

describe('performers', () => {
  it('adds a performer unassigned to any group or ensemble', () => {
    const cast = addPerformer(empty(), 'Aldonza', 'lead', 'cannot lose audio')

    expect(cast.performers[0]).toMatchObject({
      name: 'Aldonza', role: 'lead', notes: 'cannot lose audio', ensembleId: null, deskChannelId: null
    })
  })

  it('updates by id, leaving the rest alone', () => {
    const cast = addPerformer(addPerformer(empty(), 'Aldonza', 'lead'), 'Sancho', 'comic lead')
    const updated = updatePerformer(cast, cast.performers[0].id, { name: 'Aldonza (cover)' })

    expect(updated.performers[0].name).toBe('Aldonza (cover)')
    expect(updated.performers[1].name).toBe('Sancho')
  })

  it('drops a performer from the cast list', () => {
    const cast = addPerformer(empty(), 'Aldonza', 'lead')

    expect(removePerformerFromCast(cast, cast.performers[0].id).performers).toEqual([])
  })
})

describe('ensembles', () => {
  it('names a fresh ensemble by count when none is given', () => {
    const cast = addEnsemble(addEnsemble(empty()))

    expect(cast.ensembles.map(e => e.name)).toEqual(['Ensemble 1', 'Ensemble 2'])
  })

  it('updates a group by id', () => {
    const cast = addEnsemble(empty(), 'Ensemble')
    const updated = updateEnsemble(cast, cast.ensembles[0].id, { deskChannelId: 'dca-1' })

    expect(updated.ensembles[0].deskChannelId).toBe('dca-1')
  })

  it('removing an ensemble takes its members out of it, not out of the cast', () => {
    let cast = addPerformer(addEnsemble(empty(), 'Ensemble'), 'Aldonza', 'lead')
    const ensembleId = cast.ensembles[0].id
    cast = updatePerformer(cast, cast.performers[0].id, { ensembleId })

    const after = removeEnsemble(cast, ensembleId)

    expect(after.ensembles).toEqual([])
    expect(after.performers[0].ensembleId).toBeNull()
    expect(after.performers[0].name).toBe('Aldonza')
  })

  it('lists members by their pointer, not a separate roster', () => {
    let cast = addPerformer(addPerformer(addEnsemble(empty(), 'Ensemble'), 'Aldonza', 'lead'), 'Sancho', 'comic lead')
    const ensembleId = cast.ensembles[0].id
    cast = updatePerformer(cast, cast.performers[0].id, { ensembleId })

    expect(ensembleMembers(cast, ensembleId).map(p => p.name)).toEqual(['Aldonza'])
  })
})

describe('desk groups', () => {
  it('names a fresh group by count when none is given', () => {
    const cast = addDeskGroup(addDeskGroup(empty()))

    expect(cast.groups.map(g => g.label)).toEqual(['DCA 1', 'DCA 2'])
  })

  it('updates a group by id', () => {
    const cast = addDeskGroup(empty(), 'DCA 1')
    const updated = updateDeskGroup(cast, cast.groups[0].id, { label: 'DCA 1 — Principals' })

    expect(updated.groups[0].label).toBe('DCA 1 — Principals')
  })

  it('removing a group leaves stale pointers until the caller clears them', () => {
    let cast = addPerformer(addDeskGroup(empty(), 'DCA 1'), 'Aldonza', 'lead')
    const groupId = cast.groups[0].id
    cast = updatePerformer(cast, cast.performers[0].id, { deskChannelId: groupId })

    const removed = removeDeskGroup(cast, groupId)
    expect(removed.groups).toEqual([])
    expect(removed.performers[0].deskChannelId).toBe(groupId)

    const cleared = clearDeskGroupPointers(removed, groupId)
    expect(cleared.performers[0].deskChannelId).toBeNull()
  })

  it('clears the pointer on ensembles as well as performers', () => {
    let cast = addEnsemble(addDeskGroup(empty(), 'DCA 1'), 'Ensemble')
    const groupId = cast.groups[0].id
    cast = updateEnsemble(cast, cast.ensembles[0].id, { deskChannelId: groupId })

    const cleared = clearDeskGroupPointers(cast, groupId)
    expect(cleared.ensembles[0].deskChannelId).toBeNull()
  })
})

describe('desk messages', () => {
  it('builds the ordinary wireless group: open on note-on, closed on note-off', () => {
    const { mute, unmute } = midiNoteMessages('Yamaha', 1, 36)

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
    const { unmute } = midiNoteMessages('Yamaha', 1, 36)

    expect(describeDeskMessage(unmute)).toBe('noteOn ch1 → "Yamaha"')
    expect(describeDeskMessage(oscMessages('10.0.0.5', 9000, '/dca/2/mute').mute))
      .toBe('OSC /dca/2/mute 0 → 10.0.0.5:9000')
    expect(describeDeskMessage(null)).toBe('nothing')
  })
})

describe('resolvedGroupId', () => {
  it('takes a performer routed directly, over anything their ensemble says', () => {
    let cast = addPerformer(addEnsemble(addDeskGroup(addDeskGroup(empty(), 'DCA 1'), 'DCA 2'), 'Ensemble'), 'Aldonza', 'lead')
    const [dca1, dca2] = cast.groups
    cast = updateEnsemble(cast, cast.ensembles[0].id, { deskChannelId: dca2.id })
    cast = updatePerformer(cast, cast.performers[0].id, { ensembleId: cast.ensembles[0].id, deskChannelId: dca1.id })

    expect(resolvedGroupId(cast.performers[0], cast.ensembles)).toBe(dca1.id)
  })

  it('falls through to the ensemble when the performer has no group of their own', () => {
    let cast = addPerformer(addEnsemble(addDeskGroup(empty(), 'DCA 1'), 'Ensemble'), 'Aldonza', 'lead')
    const groupId = cast.groups[0].id
    cast = updateEnsemble(cast, cast.ensembles[0].id, { deskChannelId: groupId })
    cast = updatePerformer(cast, cast.performers[0].id, { ensembleId: cast.ensembles[0].id })

    expect(resolvedGroupId(cast.performers[0], cast.ensembles)).toBe(groupId)
  })

  it('resolves to nothing for a performer with no group and no ensemble', () => {
    const cast = addPerformer(empty(), 'Aldonza', 'lead')

    expect(resolvedGroupId(cast.performers[0], cast.ensembles)).toBeNull()
  })

  it('resolves to nothing when the ensemble itself has no group', () => {
    let cast = addPerformer(addEnsemble(empty(), 'Ensemble'), 'Aldonza', 'lead')
    cast = updatePerformer(cast, cast.performers[0].id, { ensembleId: cast.ensembles[0].id })

    expect(resolvedGroupId(cast.performers[0], cast.ensembles)).toBeNull()
  })
})
