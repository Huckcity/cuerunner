// The rig as data: the built-in instruments, the patch's own checks, and a look resolved to
// the slots it lands on — everything the window works out before main is told anything.
import { describe, expect, it } from 'vitest'
import {
  builtinFixtureTypes,
  curveShape,
  defaultLightingSettings,
  DMX_LIMITS,
  identifyLook,
  lightingRefusal,
  nextFreeAddress,
  patchWarnings,
  resolveLook,
  resolveParam,
  sacnMulticastAddress,
  artnetPortAddress,
  toBytes16,
  type LightingSettings,
  type PatchedFixture
} from './dmx'
import { readDmxConfig, readDmxGo, readDmxMonitorRequest } from './dmxWire'

function rig(fixtures: PatchedFixture[], extra: Partial<LightingSettings> = {}): LightingSettings {
  return { ...defaultLightingSettings(), types: builtinFixtureTypes(), fixtures, ...extra }
}

function fixture(id: string, typeId: string, mode: string, universe: number, address: number): PatchedFixture {
  return { id, name: id, typeId: `builtin:${typeId}`, mode, universe, address }
}

describe('the built-in instruments', () => {
  it('are a dimmer, RGB, dimmer + RGB, RGBW, RGBA, RGBAW + UV and a basic moving head', () => {
    expect(builtinFixtureTypes().map(type => type.name)).toEqual([
      'Dimmer', 'RGB', 'Dimmer + RGB', 'RGBW', 'RGBA', 'RGBAW + UV', 'Moving head (basic)'
    ])
  })

  it('count a 16-bit parameter as two slots', () => {
    const head = builtinFixtureTypes().find(type => type.id === 'builtin:moving-head')!
    expect(head.modes.map(mode => [mode.name, mode.channels])).toEqual([
      ['8-bit, 4 channel', 4],
      ['16-bit, 6 channel', 6]
    ])
    const ids = builtinFixtureTypes().map(type => type.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the patch’s own checks', () => {
  it('names two fixtures sharing a slot, and only in one universe', () => {
    const warnings = patchWarnings(rig([
      fixture('a', 'rgbw', '4 channel', 1, 1),
      fixture('b', 'dimmer', '1 channel', 1, 4),
      fixture('c', 'rgbw', '4 channel', 2, 1)
    ]))
    expect(warnings).toEqual([
      { kind: 'clash', fixtureIds: ['a', 'b'], detail: 'a (1/1–4) and b (1/4–4) share a slot' }
    ])
  })

  it('lets two fixtures sit side by side', () => {
    expect(patchWarnings(rig([fixture('a', 'rgb', '3 channel', 1, 1), fixture('b', 'rgb', '3 channel', 1, 4)]))).toEqual([])
  })

  it('names a fixture that runs off the end of its universe, and one whose mode is gone', () => {
    const warnings = patchWarnings(rig([
      fixture('a', 'moving-head', '16-bit, 6 channel', 1, 510),
      { id: 'b', name: 'b', typeId: 'gone', mode: 'x', universe: 1, address: 1 }
    ]))
    expect(warnings.map(warning => warning.kind).sort()).toEqual(['off-the-end', 'unknown-type'])
  })

  it('offers the first gap a footprint fits, and nothing when the universe is full', () => {
    const lighting = rig([fixture('a', 'rgb', '3 channel', 1, 1), fixture('b', 'rgb', '3 channel', 1, 7)])
    expect(nextFreeAddress(lighting, 1, 3)).toBe(4)
    expect(nextFreeAddress(lighting, 1, 4)).toBe(10)
    expect(nextFreeAddress(lighting, 2, 4)).toBe(1)
    expect(nextFreeAddress(rig([fixture('a', 'dimmer', '1 channel', 1, 512)]), 1, 512)).toBeNull()
  })
})

describe('a look resolved to slots', () => {
  it('lands a 16-bit parameter on its coarse and fine slots, zero-based', () => {
    const lighting = rig([fixture('head', 'moving-head', '16-bit, 6 channel', 3, 101)])
    expect(resolveParam(lighting, lighting.fixtures[0], 'tilt')).toEqual({ u: 3, s: 102, f: 103, i: false, h: 0.5 })
    expect(resolveParam(lighting, lighting.fixtures[0], 'dimmer')).toEqual({ u: 3, s: 105, f: null, i: true, h: 0 })
    expect(resolveParam(lighting, lighting.fixtures[0], 'zoom')).toBeNull()
  })

  it('reaches every member of a group that has the parameter, and lets a later level win', () => {
    const lighting = rig(
      [fixture('wash', 'dimmer-rgb', '4 channel', 1, 1), fixture('par', 'rgb', '3 channel', 1, 11)],
      { groups: [{ id: 'all', name: 'All', fixtureIds: ['wash', 'par', 'gone'] }] }
    )
    const values = resolveLook(lighting, [
      { target: 'group', id: 'all', param: 'dimmer', value: 0.8 },
      { target: 'group', id: 'all', param: 'blue', value: 1 },
      { target: 'fixture', id: 'par', param: 'blue', value: 0.25 }
    ])
    // The par has no dimmer; its blue is the fixture's own level, which came later.
    expect(values.map(value => [value.s, value.v]).sort((a, b) => a[0] - b[0])).toEqual([
      [0, 0.8],
      [3, 1],
      [12, 0.25]
    ])
  })

  it('identifies a fixture: light and colour full, a head centred', () => {
    const lighting = rig([fixture('head', 'moving-head', '8-bit, 4 channel', 1, 1)])
    expect(identifyLook(lighting, lighting.fixtures[0]).map(value => value.v)).toEqual([0.5, 0.5, 0, 1])
  })
})

describe('values and the wire’s own numbers', () => {
  it('shapes a fade the way an audio fade is shaped', () => {
    expect(curveShape(0.5, 'linear')).toBe(0.5)
    expect(curveShape(0.25, 'sCurve')).toBeCloseTo(0.15625)
    expect(curveShape(1, 'logarithmic')).toBeCloseTo(1)
    expect(curveShape(0.5, 'logarithmic')).toBeGreaterThan(0.5)
  })

  it('splits a 16-bit value into coarse and fine', () => {
    expect(toBytes16(0)).toEqual([0, 0])
    expect(toBytes16(1)).toEqual([255, 255])
    expect(toBytes16(0.5)).toEqual([128, 0])
  })

  it('names the multicast group and the Port-Address a universe is on', () => {
    expect(sacnMulticastAddress(1)).toBe('239.255.0.1')
    expect(sacnMulticastAddress(63999)).toBe('239.255.249.255')
    expect(artnetPortAddress(0x1234)).toEqual({ net: 0x12, subnet: 3, universe: 4 })
  })
})

describe('what a file’s rig may be', () => {
  it('reads an empty rig and one the built-ins patch', () => {
    expect(lightingRefusal(defaultLightingSettings())).toBeNull()
    expect(lightingRefusal(rig([fixture('a', 'rgb', '3 channel', 1, 1)]))).toBeNull()
  })

  it('refuses a rig past its bounds, a word it does not write, and two fixtures with one id', () => {
    const many = Array.from({ length: DMX_LIMITS.fixtures + 1 }, (_, at) => fixture(`f${at}`, 'dimmer', '1 channel', 1, 1))
    expect(lightingRefusal(rig(many))).toMatch(/2049 fixtures, more than the 2048/)
    const universes = Array.from({ length: 65 }, (_, at) => fixture(`u${at}`, 'dimmer', '1 channel', at + 1, 1))
    expect(lightingRefusal(rig(universes))).toMatch(/65 universes/)
    expect(lightingRefusal({ ...rig([]), panic: 'scream' as never })).toMatch(/panic that does “scream”/)
    expect(lightingRefusal(rig([fixture('a', 'rgb', '3 channel', 1, 1), fixture('a', 'rgb', '3 channel', 1, 9)])))
      .toMatch(/two of its fixtures share an id/)
  })
})

describe('the commands main reads', () => {
  const go = {
    cueId: 'c1',
    values: [{ u: 1, s: 0, f: null, i: true, h: 0, v: 1 }],
    fadeMs: 1000,
    curve: 'linear',
    htp: false,
    effects: [{ u: 1, s: 1, f: null, i: false, h: 0, shape: 'sine', rate: 1, low: 0, high: 1, phase: 0 }]
  }

  it('reads a GO it can act on', () => {
    expect(readDmxGo(go)).toEqual(go)
  })

  it('refuses a GO it cannot, naming what is wrong', () => {
    expect(() => readDmxGo({ ...go, curve: 'bounce' })).toThrow(/curve must be one of/)
    expect(() => readDmxGo({ ...go, values: [{ ...go.values[0], v: 2 }] })).toThrow(/value must be a number from 0 to 1/)
    expect(() => readDmxGo({ ...go, effects: [{ ...go.effects[0], rate: 100 }] })).toThrow(/rate/)
    expect(() => readDmxGo({ ...go, values: 'all' })).toThrow(/not a list/)
    const wide = Array.from({ length: 65 }, (_, at) => ({ u: at + 1, s: 0, f: null, i: true, h: 0, v: 1 }))
    expect(() => readDmxGo({ ...go, values: wide })).toThrow(/more than 64 universes/)
  })

  it('holds an output to its protocol’s own transports and universe range', () => {
    const base = { outputs: [], inputs: [], sync: false, syncUniverse: 63999, panic: 'hold' }
    const output = {
      id: 'o', universe: 1, protocol: 'artnet', transport: 'broadcast', address: '',
      wireUniverse: 32767, priority: 100, enabled: true
    }
    expect(readDmxConfig({ ...base, outputs: [output] }).outputs).toHaveLength(1)
    expect(() => readDmxConfig({ ...base, outputs: [{ ...output, transport: 'multicast' }] })).toThrow(/transport/)
    expect(() => readDmxConfig({ ...base, outputs: [{ ...output, wireUniverse: 32768 }] })).toThrow(/0 to 32767/)
  })

  it('reads at most four universes for one monitor request', () => {
    expect(readDmxMonitorRequest({ universes: [1, 2] })).toEqual([1, 2])
    expect(() => readDmxMonitorRequest({ universes: [1, 2, 3, 4, 5] })).toThrow(/more than the 4/)
  })
})
