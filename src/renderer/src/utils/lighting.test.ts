import { describe, expect, it } from 'vitest'
import {
  addFixtures,
  addGroup,
  addOutput,
  recordLook,
  removeFixtures,
  removeType,
  trackingSheet,
  updateOutput,
  userType
} from './lighting'
import { importOflFixture } from './oflImport'
import { defaultLightingSettings, patchWarnings, type LightingSettings } from '../../../shared/dmx'
import type { Cue, LightCue } from '../../../shared/cue'

const BASE = {
  colorLabel: 'none' as const, parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
  advance: 'none' as const, isArmed: true, notes: '', duration: 0, effects: [], curve: 'linear' as const,
  intensity: 'ltp' as const
}

function lightCue(id: string, look: LightCue['look']): LightCue {
  return { ...BASE, id, number: id, name: id, type: 'light', look }
}

function patched(count: number, typeId = 'builtin:dimmer-rgb', mode = '4 channel'): LightingSettings {
  const result = addFixtures(defaultLightingSettings(), { typeId, mode, universe: 1, address: null, count, name: 'Par' })
  if ('error' in result) throw new Error(result.error)
  return result.lighting
}

describe('patching', () => {
  it('patches a bar of fixtures in the gaps, numbered, and copies the type into the show', () => {
    const lighting = patched(3)
    expect(lighting.fixtures.map(fixture => [fixture.name, fixture.address])).toEqual([
      ['Par 1', 1], ['Par 2', 5], ['Par 3', 9]
    ])
    expect(lighting.types.map(type => type.id)).toEqual(['builtin:dimmer-rgb'])
    expect(patchWarnings(lighting)).toEqual([])
  })

  it('refuses a patch that does not fit rather than overlapping', () => {
    const result = addFixtures(defaultLightingSettings(), {
      typeId: 'builtin:moving-head', mode: '16-bit, 6 channel', universe: 1, address: null, count: 86, name: 'Spot'
    })
    expect(result).toEqual({ error: 'universe 1 has no room for them all' })
  })

  it('unpatches a fixture out of every group it was in, and keeps a type in use', () => {
    const lighting = patched(2)
    const grouped = addGroup(lighting, 'Wash', lighting.fixtures.map(fixture => fixture.id))
    const removed = removeFixtures(grouped, [lighting.fixtures[0].id])
    expect(removed.groups[0].fixtureIds).toEqual([lighting.fixtures[1].id])
    expect(removeType(removed, 'builtin:dimmer-rgb')).toEqual({ error: '1 fixture is patched as this type' })
  })

  it('builds a user type from a channel list', () => {
    const type = userType('Strobe', 'Acme', [
      { label: 'Intensity', kind: 'intensity' },
      { label: 'Rate', kind: 'other' },
      { label: 'Rate', kind: 'other' }
    ])
    expect(type.modes[0].params.map(entry => [entry.key, entry.offset])).toEqual([['dimmer', 0], ['rate', 1], ['rate-3', 2]])
    expect(type.source).toBe('user')
  })

  it('gives an output its protocol’s own transport and numbering', () => {
    const lighting = addOutput(defaultLightingSettings(), 3, 'sacn')
    expect(lighting.outputs[0]).toMatchObject({ transport: 'multicast', wireUniverse: 3, priority: 100 })
    const artnet = updateOutput(lighting, lighting.outputs[0].id, { protocol: 'artnet' })
    expect(artnet.outputs[0]).toMatchObject({ transport: 'broadcast', wireUniverse: 2 })
  })
})

describe('recording the faders into a cue', () => {
  const programmer = [
    { u: 1, s: 0, f: null, i: true, h: 0, v: 0.75, fixtureId: 'f1', param: 'dimmer' },
    { u: 1, s: 1, f: null, i: false, h: 0, v: 0.333333, fixtureId: 'f1', param: 'red' }
  ]

  it('replaces a level the look had for that parameter, and adds the rest after it', () => {
    const look = recordLook(
      [{ target: 'group', id: 'g', param: 'dimmer', value: 1 }, { target: 'fixture', id: 'f1', param: 'dimmer', value: 0.1 }],
      programmer,
      'merge'
    )
    expect(look).toEqual([
      { target: 'group', id: 'g', param: 'dimmer', value: 1 },
      { target: 'fixture', id: 'f1', param: 'dimmer', value: 0.75 },
      { target: 'fixture', id: 'f1', param: 'red', value: 0.333 }
    ])
  })

  it('starts from the faders alone when asked to replace', () => {
    expect(recordLook([{ target: 'group', id: 'g', param: 'dimmer', value: 1 }], programmer, 'replace')).toHaveLength(2)
  })
})

describe('the tracking sheet', () => {
  it('says what a cue moves, what it sets to where it already was, and what it leaves tracking', () => {
    const lighting = patched(2)
    const [a, b] = lighting.fixtures
    const grouped = addGroup(lighting, 'Wash', [a.id, b.id])
    const group = grouped.groups[0]
    const cues: Cue[] = [
      lightCue('1', [{ target: 'group', id: group.id, param: 'dimmer', value: 0.8 }, { target: 'fixture', id: a.id, param: 'red', value: 1 }]),
      lightCue('2', [{ target: 'fixture', id: a.id, param: 'dimmer', value: 0.8 }, { target: 'fixture', id: b.id, param: 'blue', value: 1 }])
    ]
    const sheet = trackingSheet(cues, grouped, cues[1] as LightCue)
    const roles = sheet.map(row => [row.fixtureId === a.id ? 'a' : 'b', row.param, row.role, row.cueId])
    expect(roles).toEqual([
      ['a', 'dimmer', 'repeated', '2'],
      ['a', 'red', 'tracked', '1'],
      ['b', 'blue', 'changed', '2'],
      ['b', 'dimmer', 'tracked', '1']
    ])
  })
})

describe('an Open Fixture Library definition', () => {
  const definition = {
    name: 'Spot 150',
    availableChannels: {
      Pan: { fineChannelAliases: ['Pan fine'], defaultValue: '50%', capability: { type: 'Pan' } },
      Tilt: { capability: { type: 'Tilt' } },
      Dimmer: { capability: { type: 'Intensity' } },
      Red: { capability: { type: 'ColorIntensity', color: 'Red' } },
      Wheel: { capabilities: [{ type: 'WheelSlot' }] },
      Macro: { capability: { type: 'Generic' } }
    },
    modes: [
      { name: '7ch', channels: ['Pan', 'Pan fine', 'Tilt', 'Dimmer', 'Red', 'Wheel', 'Macro'] },
      { name: 'Basic', channels: ['Dimmer', null, 'Red'] }
    ]
  }

  it('reads each mode’s channels, kinds, fine channels and resting values', () => {
    const result = importOflFixture(JSON.stringify(definition))
    if (!result.ok) throw new Error(result.error)
    const [full, basic] = result.type.modes
    expect(full.channels).toBe(7)
    expect(full.params.map(entry => [entry.key, entry.kind, entry.offset, entry.fineOffset])).toEqual([
      ['pan', 'pan', 0, 1],
      ['tilt', 'tilt', 2, null],
      ['dimmer', 'intensity', 3, null],
      ['red', 'red', 4, null],
      ['wheel', 'colour', 5, null],
      ['macro', 'other', 6, null]
    ])
    expect(full.params[0].home).toBe(0.5)
    expect(basic).toMatchObject({ channels: 3 })
    expect(basic.params.map(entry => entry.offset)).toEqual([0, 2])
    expect(result.type.source).toBe('import')
  })

  it('refuses what it cannot read, saying why', () => {
    expect(importOflFixture('not json')).toMatchObject({ ok: false, error: expect.stringMatching(/not JSON/) })
    expect(importOflFixture('{}')).toMatchObject({ ok: false, error: expect.stringMatching(/availableChannels/) })
    expect(importOflFixture(JSON.stringify({ ...definition, matrix: {} }))).toMatchObject({ ok: false })
    expect(importOflFixture(JSON.stringify({ ...definition, modes: [{ name: 'x', channels: ['Nope'] }] })))
      .toMatchObject({ ok: false, error: expect.stringMatching(/does not define \(Nope\)/) })
    expect(importOflFixture('x'.repeat(1024 * 1024 + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/larger/) })
  })
})
