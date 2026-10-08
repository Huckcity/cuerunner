import type { Cue, LightCue } from '../../../shared/cue'
import {
  builtinFixtureTypes,
  defaultWireUniverse,
  DMX_LIMITS,
  modeOf,
  nextFreeAddress,
  targetFixtures,
  type DmxProtocol,
  type FixtureGroup,
  type FixtureParam,
  type FixtureType,
  type LightingSettings,
  type LightLevel,
  type PatchedFixture,
  type UniverseInput,
  type UniverseOutput
} from '../../../shared/dmx'
import type { DmxProgrammerValue } from '../../../shared/dmxWire'

// Edits to the rig, as pure functions from one rig to the next: the lighting view calls these
// and hands the result to the store's one writer, so every edit is one undo step and the view
// holds no rig of its own.

/** A type the show can patch: one it carries, or a built-in it would copy in. */
export function patchableTypes(lighting: LightingSettings): FixtureType[] {
  const carried = new Set(lighting.types.map(type => type.id))
  return [...lighting.types, ...builtinFixtureTypes().filter(type => !carried.has(type.id))]
}

/** The rig carrying a type: a built-in is copied in the first time it is patched. */
export function withType(lighting: LightingSettings, type: FixtureType): LightingSettings {
  if (lighting.types.some(entry => entry.id === type.id)) return lighting
  return { ...lighting, types: [...lighting.types, structuredClone(type)] }
}

export interface PatchRequest {
  typeId: string
  mode: string
  universe: number
  /** The first fixture's address, or null for the first gap that fits. */
  address: number | null
  count: number
  /** The name the fixtures are numbered after: "Par" gives "Par 1", "Par 2". */
  name: string
}

/** How many fixtures one patch may add: a bar of pars, not a stadium. */
export const PATCH_AT_ONCE = 128

/**
 * Patches `count` fixtures of a type, one after another from the address asked for — or from
 * the first gap — each in the next gap that fits. Refuses rather than overlaps: a patch that
 * cannot fit says so and adds nothing.
 */
export function addFixtures(
  lighting: LightingSettings,
  request: PatchRequest
): { lighting: LightingSettings; added: string[] } | { error: string } {
  const type = patchableTypes(lighting).find(entry => entry.id === request.typeId)
  const mode = type?.modes.find(entry => entry.name === request.mode)
  if (type === undefined || mode === undefined) return { error: 'choose a type and a mode' }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > PATCH_AT_ONCE) {
    return { error: `patch from 1 to ${PATCH_AT_ONCE} fixtures at once` }
  }
  if (lighting.fixtures.length + request.count > DMX_LIMITS.fixtures) {
    return { error: `a show carries at most ${DMX_LIMITS.fixtures} fixtures` }
  }
  let next = withType(lighting, type)
  const added: string[] = []
  const base = request.name.trim() === '' ? type.name : request.name.trim()
  const taken = new Set(lighting.fixtures.map(fixture => fixture.name))
  let number = 1
  for (let index = 0; index < request.count; index++) {
    const address =
      index === 0 && request.address !== null ? request.address : nextFreeAddress(next, request.universe, mode.channels)
    if (address === null || address < 1 || address + mode.channels - 1 > DMX_LIMITS.slots) {
      return { error: `universe ${request.universe} has no room for ${request.count === 1 ? 'it' : 'them all'}` }
    }
    while (taken.has(`${base} ${number}`)) number++
    const name = request.count === 1 && !taken.has(base) ? base : `${base} ${number}`
    taken.add(name)
    const fixture: PatchedFixture = {
      id: crypto.randomUUID(),
      name,
      typeId: type.id,
      mode: mode.name,
      universe: request.universe,
      address
    }
    next = { ...next, fixtures: [...next.fixtures, fixture] }
    added.push(fixture.id)
  }
  return { lighting: next, added }
}

export function updateFixture(lighting: LightingSettings, id: string, patch: Partial<PatchedFixture>): LightingSettings {
  return { ...lighting, fixtures: lighting.fixtures.map(fixture => (fixture.id === id ? { ...fixture, ...patch, id } : fixture)) }
}

/** Unpatches fixtures, and takes them out of every group they were in. */
export function removeFixtures(lighting: LightingSettings, ids: readonly string[]): LightingSettings {
  const gone = new Set(ids)
  return {
    ...lighting,
    fixtures: lighting.fixtures.filter(fixture => !gone.has(fixture.id)),
    groups: lighting.groups.map(group => ({ ...group, fixtureIds: group.fixtureIds.filter(id => !gone.has(id)) }))
  }
}

export function addGroup(lighting: LightingSettings, name: string, fixtureIds: readonly string[]): LightingSettings {
  const group: FixtureGroup = {
    id: crypto.randomUUID(),
    name: name.trim() === '' ? `Group ${lighting.groups.length + 1}` : name.trim(),
    fixtureIds: [...fixtureIds]
  }
  return { ...lighting, groups: [...lighting.groups, group] }
}

export function updateGroup(lighting: LightingSettings, id: string, patch: Partial<FixtureGroup>): LightingSettings {
  return { ...lighting, groups: lighting.groups.map(group => (group.id === id ? { ...group, ...patch, id } : group)) }
}

export function removeGroup(lighting: LightingSettings, id: string): LightingSettings {
  return { ...lighting, groups: lighting.groups.filter(group => group.id !== id) }
}

/** A new output for a universe, on the protocol's own defaults: sACN multicast, Art-Net broadcast. */
export function addOutput(lighting: LightingSettings, universe: number, protocol: DmxProtocol): LightingSettings {
  const output: UniverseOutput = {
    id: crypto.randomUUID(),
    universe,
    protocol,
    transport: protocol === 'sacn' ? 'multicast' : 'broadcast',
    address: '',
    wireUniverse: defaultWireUniverse(protocol, universe),
    priority: 100,
    enabled: true
  }
  return { ...lighting, outputs: [...lighting.outputs, output] }
}

export function updateOutput(lighting: LightingSettings, id: string, patch: Partial<UniverseOutput>): LightingSettings {
  return {
    ...lighting,
    outputs: lighting.outputs.map(output => {
      if (output.id !== id) return output
      const next = { ...output, ...patch, id }
      // A protocol change takes that protocol's own transport and numbering.
      if (patch.protocol !== undefined && patch.protocol !== output.protocol) {
        next.transport = patch.protocol === 'sacn' ? 'multicast' : 'broadcast'
        next.wireUniverse = defaultWireUniverse(patch.protocol, next.universe)
      }
      return next
    })
  }
}

export function removeOutput(lighting: LightingSettings, id: string): LightingSettings {
  return { ...lighting, outputs: lighting.outputs.filter(output => output.id !== id) }
}

export function addInput(lighting: LightingSettings, universe: number, protocol: DmxProtocol): LightingSettings {
  const input: UniverseInput = {
    id: crypto.randomUUID(),
    protocol,
    wireUniverse: defaultWireUniverse(protocol, universe),
    universe,
    merge: false,
    enabled: true
  }
  return { ...lighting, inputs: [...lighting.inputs, input] }
}

export function updateInput(lighting: LightingSettings, id: string, patch: Partial<UniverseInput>): LightingSettings {
  return { ...lighting, inputs: lighting.inputs.map(input => (input.id === id ? { ...input, ...patch, id } : input)) }
}

export function removeInput(lighting: LightingSettings, id: string): LightingSettings {
  return { ...lighting, inputs: lighting.inputs.filter(input => input.id !== id) }
}

/** Adds a type the operator built or imported; one with the same name and maker replaces it. */
export function addType(lighting: LightingSettings, type: FixtureType): LightingSettings | { error: string } {
  if (lighting.types.length >= DMX_LIMITS.types) return { error: `a show carries at most ${DMX_LIMITS.types} types` }
  return { ...lighting, types: [...lighting.types, type] }
}

/** Removes a type nothing is patched as. */
export function removeType(lighting: LightingSettings, id: string): LightingSettings | { error: string } {
  const used = lighting.fixtures.filter(fixture => fixture.typeId === id)
  if (used.length > 0) return { error: `${used.length} fixture${used.length === 1 ? ' is' : 's are'} patched as this type` }
  return { ...lighting, types: lighting.types.filter(type => type.id !== id) }
}

/** A user-defined type with one mode, from a list of channels as the operator names them. */
export function userType(name: string, manufacturer: string, channels: ReadonlyArray<Pick<FixtureParam, 'label' | 'kind'>>): FixtureType {
  const keys = new Set<string>()
  const params: FixtureParam[] = channels.map((channel, offset) => {
    let key = channel.kind === 'other' ? channel.label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'channel' : channel.kind === 'intensity' ? 'dimmer' : channel.kind
    while (keys.has(key)) key = `${key}-${offset + 1}`
    keys.add(key)
    return { key, label: channel.label || key, kind: channel.kind, offset, fineOffset: null, home: channel.kind === 'pan' || channel.kind === 'tilt' ? 0.5 : 0 }
  })
  return {
    id: crypto.randomUUID(),
    name: name.trim() || 'Custom fixture',
    manufacturer: manufacturer.trim(),
    source: 'user',
    modes: [{ name: `${params.length} channel`, channels: Math.max(1, params.length), params }]
  }
}

// ─── Reading the rig for a cue ────────────────────────────────────────────────

/** A fixture's parameters, in its mode's order. */
export function paramsOf(lighting: LightingSettings, fixture: PatchedFixture): FixtureParam[] {
  return modeOf(lighting, fixture)?.params ?? []
}

/** The parameters a target offers: a fixture's own, or every one some member of a group has. */
export function targetParams(lighting: LightingSettings, target: 'fixture' | 'group', id: string): FixtureParam[] {
  const seen = new Map<string, FixtureParam>()
  for (const fixture of targetFixtures(lighting, target, id)) {
    for (const entry of paramsOf(lighting, fixture)) if (!seen.has(entry.key)) seen.set(entry.key, entry)
  }
  return [...seen.values()]
}

/** What a target is called in a look, or that it has gone from the rig. */
export function targetName(lighting: LightingSettings, target: 'fixture' | 'group', id: string): string | null {
  if (target === 'fixture') return lighting.fixtures.find(fixture => fixture.id === id)?.name ?? null
  return lighting.groups.find(group => group.id === id)?.name ?? null
}

/**
 * The faders' values recorded into a look. Each value becomes a level of its own fixture; a
 * level the look already had for that fixture's parameter is replaced where it stands, and a
 * new one goes on the end — after any group level, so the fixture's own value is the one the
 * look lands (a later level wins). Replacing rather than merging starts the look from the
 * faders alone.
 */
export function recordLook(
  look: readonly LightLevel[],
  programmer: readonly DmxProgrammerValue[],
  mode: 'merge' | 'replace'
): LightLevel[] {
  const next: LightLevel[] = mode === 'replace' ? [] : look.map(level => ({ ...level }))
  for (const value of programmer) {
    const at = next.findIndex(level => level.target === 'fixture' && level.id === value.fixtureId && level.param === value.param)
    const level: LightLevel = { target: 'fixture', id: value.fixtureId, param: value.param, value: Math.round(value.v * 1000) / 1000 }
    if (at >= 0) next[at] = level
    else next.push(level)
  }
  return next.slice(0, DMX_LIMITS.lookEntries)
}

// ─── Tracking ─────────────────────────────────────────────────────────────────

/** One parameter of one fixture, as the cue list leaves it at a cue. */
export interface TrackedValue {
  fixtureId: string
  param: string
  value: number
  /** The Light cue that set it. */
  cueId: string
}

function fixtureLevels(lighting: LightingSettings, cue: LightCue): Map<string, TrackedValue> {
  const levels = new Map<string, TrackedValue>()
  for (const level of cue.look) {
    for (const fixture of targetFixtures(lighting, level.target, level.id)) {
      if (!paramsOf(lighting, fixture).some(entry => entry.key === level.param)) continue
      levels.set(`${fixture.id}\u0000${level.param}`, { fixtureId: fixture.id, param: level.param, value: level.value, cueId: cue.id })
    }
  }
  return levels
}

/**
 * The rig as the cue list leaves it just before a cue: every Light cue above it, in running
 * order, each one's levels over the last — tracking, read the way a console's tracking sheet
 * reads it. What a Stop or a Fade does to a light at show time is not part of the sheet.
 */
export function trackedBefore(cues: readonly Cue[], lighting: LightingSettings, cueId: string): Map<string, TrackedValue> {
  const state = new Map<string, TrackedValue>()
  for (const cue of cues) {
    if (cue.id === cueId) break
    if (cue.type !== 'light') continue
    for (const [key, value] of fixtureLevels(lighting, cue as LightCue)) state.set(key, value)
  }
  return state
}

/** What a cue does to one parameter: moves it, sets what it already was, or leaves it tracking. */
export type TrackingRole = 'changed' | 'repeated' | 'tracked'

export interface TrackingRow extends TrackedValue {
  role: TrackingRole
}

/**
 * The cue's tracking sheet: every parameter that has a value at this cue, and whether this cue
 * moved it, set it to what it already was — a level that could come out of the cue without
 * changing the show — or left it where an earlier cue put it.
 */
export function trackingSheet(cues: readonly Cue[], lighting: LightingSettings, cue: LightCue): TrackingRow[] {
  const before = trackedBefore(cues, lighting, cue.id)
  const own = fixtureLevels(lighting, cue)
  const rows: TrackingRow[] = []
  for (const [key, value] of own) {
    const was = before.get(key)
    rows.push({ ...value, role: was !== undefined && Math.abs(was.value - value.value) < 0.0005 ? 'repeated' : 'changed' })
  }
  for (const [key, value] of before) if (!own.has(key)) rows.push({ ...value, role: 'tracked' })
  const order = new Map(lighting.fixtures.map((fixture, index) => [fixture.id, index]))
  return rows.sort((a, b) => (order.get(a.fixtureId) ?? 0) - (order.get(b.fixtureId) ?? 0) || a.param.localeCompare(b.param))
}
