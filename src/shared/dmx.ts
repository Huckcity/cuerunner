// The lighting rig, as the show knows it: the fixtures hung and where they are patched, what
// kind of instrument each one is, the groups an operator drives them in, and where each
// universe's data goes on the network.
//
// Everything here is plain data and pure functions, so the window, the main process and the
// tests all read one model. The window resolves a look — "front wash at 70 %, blue" — to the
// DMX slots it lands on; main holds the levels and puts them on the wire. Nothing in this
// module knows a socket, a clock or a store.
//
// Values are normalised, 0–1, everywhere a person or a cue sees them. A parameter's width on
// the wire — one slot or a coarse and a fine one — is a fact about the fixture, so a cue that
// moves a 16-bit pan and one that moves an 8-bit dimmer say the same kind of number.

import type { FadeCurve } from './cue'

/**
 * The bounds every lighting read path is held to. Each is a refusal: a patch, a payload or an
 * imported definition past one is refused with a sentence rather than clamped, because a show
 * that silently lost its two-thousand-and-forty-ninth fixture is a show missing a light.
 */
export const DMX_LIMITS = {
  /** Slots in one DMX512 universe. */
  slots: 512,
  /** Logical universes a show may patch or send: the engine renders all of them every frame. */
  universes: 64,
  /** The highest logical universe number. */
  maxUniverse: 63999,
  fixtures: 2048,
  types: 256,
  modesPerType: 32,
  paramsPerMode: 128,
  groups: 256,
  groupMembers: 2048,
  outputs: 128,
  inputs: 16,
  /** Parameter values one Light cue may carry. */
  lookEntries: 8192,
  effects: 256,
  /** Addressed values one command to main may carry: every slot of every universe. */
  wireValues: 64 * 512,
  /** The largest fixture definition file the import reads. */
  importBytes: 1024 * 1024,
  /** The longest fade a Light cue, a release or a level change may take: an hour. */
  fadeMs: 3_600_000,
  /** Characters in a name the patch carries. */
  nameLength: 128
} as const

/** The UDP ports the two protocols live on. */
export const SACN_PORT = 5568
export const ARTNET_PORT = 6454

/**
 * What a fixture parameter controls. It decides how a parameter is drawn, what identify drives
 * it to, whether a group's "intensity" reaches it, and whether intensity rules (HTP) apply.
 */
export type ParamKind =
  | 'intensity'
  | 'red'
  | 'green'
  | 'blue'
  | 'white'
  | 'amber'
  | 'uv'
  | 'pan'
  | 'tilt'
  | 'colour'
  | 'other'

export const PARAM_KINDS: readonly ParamKind[] = [
  'intensity', 'red', 'green', 'blue', 'white', 'amber', 'uv', 'pan', 'tilt', 'colour', 'other'
]

/** One controllable parameter of a fixture mode, at a fixed offset from the fixture's address. */
export interface FixtureParam {
  /** Stable within a mode: what a cue names the parameter by ("dimmer", "red", "pan"). */
  key: string
  /** What the operator reads ("Dimmer", "Pan"). */
  label: string
  kind: ParamKind
  /** Zero-based offset of the (coarse) slot from the fixture's start address. */
  offset: number
  /** Zero-based offset of the fine slot for a 16-bit parameter, or null for an 8-bit one. */
  fineOffset: number | null
  /** Where the parameter rests when nothing holds it — a release fades to here. 0–1. */
  home: number
}

/** One way a fixture can be addressed: a channel count and what each channel does. */
export interface FixtureMode {
  name: string
  /**
   * Slots the mode occupies. At least one past the highest offset its parameters use; more
   * where a definition declares channels this model does not drive (a macro, a reset).
   */
  channels: number
  params: FixtureParam[]
}

/** Where a fixture type came from: shipped with the app, typed by the operator, or imported. */
export type FixtureTypeSource = 'builtin' | 'user' | 'import'

/** A kind of lighting instrument, with the modes it can run in. */
export interface FixtureType {
  /** `builtin:<name>` for a shipped type; a UUID for anything else. */
  id: string
  name: string
  manufacturer: string
  source: FixtureTypeSource
  modes: FixtureMode[]
}

/** A fixture hung in the rig: one instrument, patched at an address in a universe. */
export interface PatchedFixture {
  id: string
  name: string
  /** The type it is, from the show's own types — the show carries every type it patches. */
  typeId: string
  /** The mode it runs in, by name. */
  mode: string
  /** Logical universe, 1-based. */
  universe: number
  /** DMX start address, 1–512. */
  address: number
}

/** Fixtures driven together: one value in a cue reaches every member that has the parameter. */
export interface FixtureGroup {
  id: string
  name: string
  fixtureIds: string[]
}

export type DmxProtocol = 'sacn' | 'artnet'

/**
 * How a universe's packets travel. sACN is multicast to the universe's own group, or unicast
 * to one receiver; Art-Net is broadcast on the subnet, or unicast to one node.
 */
export type DmxTransport = 'multicast' | 'unicast' | 'broadcast'

/** Where one universe's data goes. A universe may have several: an sACN feed and an Art-Net node. */
export interface UniverseOutput {
  id: string
  /** The show's universe number, as the patch names it. */
  universe: number
  protocol: DmxProtocol
  transport: DmxTransport
  /**
   * The destination for unicast, or the broadcast address for Art-Net broadcast (empty means
   * the chosen interface's own). Ignored for sACN multicast. A `:port` after it reaches software
   * that listens somewhere other than the protocol's own port.
   */
  address: string
  /** The universe on the wire: sACN 1–63999, or an Art-Net Port-Address 0–32767. */
  wireUniverse: number
  /** sACN priority, 0–200; receivers take the highest. Art-Net carries none. */
  priority: number
  enabled: boolean
}

/**
 * A universe this machine listens to — another console's — to watch it, or to merge it into
 * this show's own output highest-takes-precedence.
 */
export interface UniverseInput {
  id: string
  protocol: DmxProtocol
  /** The universe on the wire to listen for. */
  wireUniverse: number
  /** The show universe it is shown as and, when merging, merged into. */
  universe: number
  merge: boolean
  enabled: boolean
}

/**
 * What a panic does to the lights. Holding is the default because a panic is a sound
 * emergency first: an actor on a dark stage is a second one.
 */
export type LightingPanic = 'hold' | 'release' | 'blackout'

/** The show's lighting: its rig, its types, and where its data goes. Saved in the workspace. */
export interface LightingSettings {
  fixtures: PatchedFixture[]
  groups: FixtureGroup[]
  types: FixtureType[]
  outputs: UniverseOutput[]
  inputs: UniverseInput[]
  /**
   * Whether frames are released together: sACN universe synchronisation and Art-Net's ArtSync,
   * so a look spread over several universes lands on one frame rather than a frame apart.
   */
  sync: boolean
  /** The sACN universe the synchronisation packets go to, 1–63999. */
  syncUniverse: number
  panic: LightingPanic
}

export function defaultLightingSettings(): LightingSettings {
  return {
    fixtures: [],
    groups: [],
    types: [],
    outputs: [],
    inputs: [],
    sync: false,
    syncUniverse: 63999,
    panic: 'hold'
  }
}

/**
 * Whether a rig says nothing a default one does not: no fixture, type, group, output or input,
 * and every setting as a new show has it. Such a rig is not written to the file.
 */
export function isEmptyLighting(lighting: LightingSettings): boolean {
  const empty = defaultLightingSettings()
  return (
    lighting.fixtures.length === 0 &&
    lighting.groups.length === 0 &&
    lighting.types.length === 0 &&
    lighting.outputs.length === 0 &&
    lighting.inputs.length === 0 &&
    lighting.sync === empty.sync &&
    lighting.syncUniverse === empty.syncUniverse &&
    lighting.panic === empty.panic
  )
}

/** A show's lighting as the window holds it: absent means the show has no rig yet. */
export function heldLighting(lighting: LightingSettings | undefined): LightingSettings {
  return lighting ?? defaultLightingSettings()
}

// ─── The look a Light cue carries ─────────────────────────────────────────────

/** One parameter value in a look: a fixture's, or every member of a group that has it. */
export interface LightLevel {
  target: 'fixture' | 'group'
  /** The fixture's or the group's id. */
  id: string
  /** The parameter's key. */
  param: string
  /** 0–1. */
  value: number
}

export type EffectShape = 'sine' | 'triangle' | 'square' | 'saw'

export const EFFECT_SHAPES: readonly EffectShape[] = ['sine', 'triangle', 'square', 'saw']

/**
 * A parameter that keeps moving: between `low` and `high`, `rate` times a second. On a group,
 * `spread` offsets each member's phase — 0 moves them together, 1 spreads one cycle across
 * them, which is a chase.
 */
export interface LightEffect {
  target: 'fixture' | 'group'
  id: string
  param: string
  shape: EffectShape
  /** Cycles per second, 0.01–25. */
  rate: number
  low: number
  high: number
  /** 0–1: the share of a cycle spread across a group's members. */
  spread: number
}

export const EFFECT_RATE_RANGE = [0.01, 25] as const

/** How intensity from this cue combines with intensity from another one. */
export type IntensityRule = 'ltp' | 'htp'

// ─── Built-in fixture types ───────────────────────────────────────────────────

function param(
  key: string,
  label: string,
  kind: ParamKind,
  offset: number,
  home = 0,
  fineOffset: number | null = null
): FixtureParam {
  return { key, label, kind, offset, fineOffset, home }
}

function singleMode(name: string, params: FixtureParam[]): FixtureMode {
  return { name, channels: footprintOf(params), params }
}

function footprintOf(params: readonly FixtureParam[]): number {
  let highest = 0
  for (const entry of params) {
    highest = Math.max(highest, entry.offset + 1, entry.fineOffset === null ? 0 : entry.fineOffset + 1)
  }
  return highest
}

/**
 * The instruments a show can patch without a definition of its own. Pure data: patching one
 * copies it into the show's own types, so a show opened by a later build still reads the rig
 * it was written with.
 */
export function builtinFixtureTypes(): FixtureType[] {
  const builtin = (slug: string, name: string, modes: FixtureMode[]): FixtureType => ({
    id: `builtin:${slug}`,
    name,
    manufacturer: 'Generic',
    source: 'builtin',
    modes
  })
  return [
    builtin('dimmer', 'Dimmer', [singleMode('1 channel', [param('dimmer', 'Dimmer', 'intensity', 0)])]),
    builtin('rgb', 'RGB', [
      singleMode('3 channel', [
        param('red', 'Red', 'red', 0),
        param('green', 'Green', 'green', 1),
        param('blue', 'Blue', 'blue', 2)
      ])
    ]),
    builtin('dimmer-rgb', 'Dimmer + RGB', [
      singleMode('4 channel', [
        param('dimmer', 'Dimmer', 'intensity', 0),
        param('red', 'Red', 'red', 1),
        param('green', 'Green', 'green', 2),
        param('blue', 'Blue', 'blue', 3)
      ])
    ]),
    builtin('rgbw', 'RGBW', [
      singleMode('4 channel', [
        param('red', 'Red', 'red', 0),
        param('green', 'Green', 'green', 1),
        param('blue', 'Blue', 'blue', 2),
        param('white', 'White', 'white', 3)
      ])
    ]),
    builtin('rgba', 'RGBA', [
      singleMode('4 channel', [
        param('red', 'Red', 'red', 0),
        param('green', 'Green', 'green', 1),
        param('blue', 'Blue', 'blue', 2),
        param('amber', 'Amber', 'amber', 3)
      ])
    ]),
    builtin('rgbawuv', 'RGBAW + UV', [
      singleMode('6 channel', [
        param('red', 'Red', 'red', 0),
        param('green', 'Green', 'green', 1),
        param('blue', 'Blue', 'blue', 2),
        param('amber', 'Amber', 'amber', 3),
        param('white', 'White', 'white', 4),
        param('uv', 'UV', 'uv', 5)
      ]),
      singleMode('7 channel', [
        param('dimmer', 'Dimmer', 'intensity', 0),
        param('red', 'Red', 'red', 1),
        param('green', 'Green', 'green', 2),
        param('blue', 'Blue', 'blue', 3),
        param('amber', 'Amber', 'amber', 4),
        param('white', 'White', 'white', 5),
        param('uv', 'UV', 'uv', 6)
      ])
    ]),
    // Pan and tilt rest in the middle, where a head that has just been released points at the
    // stage rather than at the grid.
    builtin('moving-head', 'Moving head (basic)', [
      singleMode('8-bit, 4 channel', [
        param('pan', 'Pan', 'pan', 0, 0.5),
        param('tilt', 'Tilt', 'tilt', 1, 0.5),
        param('colour', 'Colour wheel', 'colour', 2),
        param('dimmer', 'Dimmer', 'intensity', 3)
      ]),
      singleMode('16-bit, 6 channel', [
        param('pan', 'Pan', 'pan', 0, 0.5, 1),
        param('tilt', 'Tilt', 'tilt', 2, 0.5, 3),
        param('colour', 'Colour wheel', 'colour', 4),
        param('dimmer', 'Dimmer', 'intensity', 5)
      ])
    ])
  ]
}

// ─── Reading the patch ────────────────────────────────────────────────────────

/** A fixture's type and mode, or null where the show no longer carries them. */
export function modeOf(lighting: LightingSettings, fixture: PatchedFixture): FixtureMode | null {
  const type = lighting.types.find(entry => entry.id === fixture.typeId)
  return type?.modes.find(mode => mode.name === fixture.mode) ?? null
}

/** The inclusive 1-based address range a fixture occupies, or null where its mode is gone. */
export function addressSpan(
  lighting: LightingSettings,
  fixture: PatchedFixture
): { first: number; last: number } | null {
  const mode = modeOf(lighting, fixture)
  if (mode === null || mode.channels <= 0) return null
  return { first: fixture.address, last: fixture.address + mode.channels - 1 }
}

/** Something wrong with the patch that the operator has to see before the show. */
export interface PatchWarning {
  kind: 'clash' | 'off-the-end' | 'unknown-type'
  /** The fixtures it is about: two for a clash, one otherwise. */
  fixtureIds: string[]
  /** One line, ready to show. */
  detail: string
}

/**
 * Every fixture pair sharing a slot in one universe, every fixture whose footprint runs past
 * slot 512, and every fixture whose type or mode the show does not carry. Sorted by start
 * address within a universe, so the sweep is n log n rather than every pair.
 */
export function patchWarnings(lighting: LightingSettings): PatchWarning[] {
  const warnings: PatchWarning[] = []
  const spans: { fixture: PatchedFixture; first: number; last: number }[] = []
  for (const fixture of lighting.fixtures) {
    const span = addressSpan(lighting, fixture)
    if (span === null) {
      warnings.push({
        kind: 'unknown-type',
        fixtureIds: [fixture.id],
        detail: `${fixture.name} has no ${fixture.mode} mode in the show’s types`
      })
      continue
    }
    if (span.last > DMX_LIMITS.slots) {
      warnings.push({
        kind: 'off-the-end',
        fixtureIds: [fixture.id],
        detail: `${fixture.name} runs to ${span.last}, past the end of universe ${fixture.universe}`
      })
    }
    spans.push({ fixture, ...span })
  }
  spans.sort((a, b) => a.fixture.universe - b.fixture.universe || a.first - b.first)
  for (let i = 0; i < spans.length; i++) {
    const a = spans[i]
    for (let j = i + 1; j < spans.length; j++) {
      const b = spans[j]
      if (b.fixture.universe !== a.fixture.universe || b.first > a.last) break
      warnings.push({
        kind: 'clash',
        fixtureIds: [a.fixture.id, b.fixture.id],
        detail:
          `${a.fixture.name} (${a.fixture.universe}/${a.first}–${a.last}) and ` +
          `${b.fixture.name} (${b.fixture.universe}/${b.first}–${b.last}) share a slot`
      })
    }
  }
  return warnings
}

/**
 * The first address in a universe where a footprint fits without clashing, or null when the
 * universe has no such gap. What a new fixture is offered, so patching one does not land on
 * the last.
 */
export function nextFreeAddress(lighting: LightingSettings, universe: number, channels: number): number | null {
  const taken = lighting.fixtures
    .filter(fixture => fixture.universe === universe)
    .map(fixture => addressSpan(lighting, fixture))
    .filter((span): span is { first: number; last: number } => span !== null)
    .sort((a, b) => a.first - b.first)
  let candidate = 1
  for (const span of taken) {
    if (candidate + channels - 1 < span.first) break
    candidate = Math.max(candidate, span.last + 1)
  }
  return candidate + channels - 1 <= DMX_LIMITS.slots ? candidate : null
}

/** The fixtures a level or an effect reaches: the fixture itself, or a group's members. */
export function targetFixtures(
  lighting: LightingSettings,
  target: 'fixture' | 'group',
  id: string
): PatchedFixture[] {
  if (target === 'fixture') {
    const fixture = lighting.fixtures.find(entry => entry.id === id)
    return fixture === undefined ? [] : [fixture]
  }
  const group = lighting.groups.find(entry => entry.id === id)
  if (group === undefined) return []
  const byId = new Map(lighting.fixtures.map(fixture => [fixture.id, fixture]))
  return group.fixtureIds.map(fixtureId => byId.get(fixtureId)).filter((f): f is PatchedFixture => f !== undefined)
}

// ─── Addresses on the wire ────────────────────────────────────────────────────

/**
 * One parameter of one fixture, resolved to the slots it is written to: the universe, the
 * coarse slot and the fine one (zero-based), whether intensity rules apply to it, and where it
 * rests. This is what the window hands main — main never reads the patch.
 */
export interface DmxAddress {
  /** Logical universe. */
  u: number
  /** Zero-based coarse slot. */
  s: number
  /** Zero-based fine slot, or null for 8-bit. */
  f: number | null
  /** Whether this is an intensity parameter. */
  i: boolean
  /** Home value, 0–1. */
  h: number
}

/** A resolved address with the value to drive it to. */
export interface DmxValue extends DmxAddress {
  v: number
}

/** Where a fixture's parameter lands, or null where the fixture has no such parameter. */
export function resolveParam(
  lighting: LightingSettings,
  fixture: PatchedFixture,
  key: string
): DmxAddress | null {
  const mode = modeOf(lighting, fixture)
  const found = mode?.params.find(entry => entry.key === key)
  if (found === undefined) return null
  const s = fixture.address - 1 + found.offset
  const f = found.fineOffset === null ? null : fixture.address - 1 + found.fineOffset
  if (s < 0 || s >= DMX_LIMITS.slots) return null
  if (f !== null && (f < 0 || f >= DMX_LIMITS.slots)) return null
  return { u: fixture.universe, s, f, i: found.kind === 'intensity', h: found.home }
}

/** The key a slot is held under in one show: a universe and a coarse slot. */
export function slotKey(u: number, s: number): number {
  return u * DMX_LIMITS.slots + s
}

/**
 * A look resolved to the slots it writes: each level reaches its fixture, or every member of
 * its group that has the parameter, and a later level for the same slot replaces an earlier
 * one — the look's own order is its precedence, the way a list read top to bottom is.
 */
export function resolveLook(lighting: LightingSettings, look: readonly LightLevel[]): DmxValue[] {
  const bySlot = new Map<number, DmxValue>()
  for (const level of look) {
    for (const fixture of targetFixtures(lighting, level.target, level.id)) {
      const address = resolveParam(lighting, fixture, level.param)
      if (address === null) continue
      bySlot.set(slotKey(address.u, address.s), { ...address, v: clamp01(level.value) })
    }
  }
  return [...bySlot.values()]
}

/** What identify drives a parameter to: light and colour full, a head centred, the rest home. */
export function identifyValue(kind: ParamKind, home: number): number {
  switch (kind) {
    case 'intensity':
    case 'red':
    case 'green':
    case 'blue':
    case 'white':
      return 1
    case 'pan':
    case 'tilt':
      return 0.5
    default:
      return home
  }
}

/** Every parameter of a fixture at its identify value. */
export function identifyLook(lighting: LightingSettings, fixture: PatchedFixture): DmxValue[] {
  const mode = modeOf(lighting, fixture)
  if (mode === null) return []
  const values: DmxValue[] = []
  for (const entry of mode.params) {
    const address = resolveParam(lighting, fixture, entry.key)
    if (address === null) continue
    values.push({ ...address, v: identifyValue(entry.kind, entry.home) })
  }
  return values
}

// ─── Values and curves ────────────────────────────────────────────────────────

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * The share of a fade done at `t` (0–1) on a curve: the same three shapes an audio fade takes,
 * so a Fade cue's curve means one thing whichever kind of cue it moves.
 */
export function curveShape(t: number, curve: FadeCurve): number {
  const x = clamp01(t)
  switch (curve) {
    case 'sCurve':
      return x * x * (3 - 2 * x)
    case 'logarithmic': {
      const denominator = 1 - Math.exp(-4)
      return (1 - Math.exp(-4 * x)) / denominator
    }
    default:
      return x
  }
}

/** A normalised value as the coarse and fine bytes a 16-bit parameter writes. */
export function toBytes16(value: number): [coarse: number, fine: number] {
  const whole = Math.round(clamp01(value) * 65535)
  return [whole >> 8, whole & 0xff]
}

/** A normalised value as the one byte an 8-bit parameter writes. */
export function toByte(value: number): number {
  return Math.round(clamp01(value) * 255)
}

/** The point an effect's wave is at, 0–1, for a phase in cycles. */
export function effectWave(shape: EffectShape, phase: number): number {
  const p = phase - Math.floor(phase)
  switch (shape) {
    case 'sine':
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * p)
    case 'triangle':
      return p < 0.5 ? p * 2 : 2 - p * 2
    case 'square':
      return p < 0.5 ? 1 : 0
    case 'saw':
      return p
  }
}

// ─── Wire universes ───────────────────────────────────────────────────────────

/** The sACN multicast group a universe is sent to: 239.255.<hi>.<lo>. */
export function sacnMulticastAddress(universe: number): string {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`
}

/** An Art-Net Port-Address as the three numbers a node's front panel shows: net, subnet, universe. */
export function artnetPortAddress(portAddress: number): { net: number; subnet: number; universe: number } {
  return { net: (portAddress >> 8) & 0x7f, subnet: (portAddress >> 4) & 0x0f, universe: portAddress & 0x0f }
}

/** The wire universe a new output for a show universe starts on: sACN's own, Art-Net's 0-based. */
export function defaultWireUniverse(protocol: DmxProtocol, universe: number): number {
  return protocol === 'sacn' ? universe : Math.max(0, universe - 1)
}

/** The range a wire universe may be in. */
export function wireUniverseRange(protocol: DmxProtocol): readonly [number, number] {
  return protocol === 'sacn' ? [1, 63999] : [0, 32767]
}

// ─── What a file's rig may be ─────────────────────────────────────────────────

/**
 * Why a rig read from a file cannot be this build's, or null when it can: a count past the
 * bounds every reader of it is held to, a word this build does not write where it reads one,
 * and two things sharing an id a cue tells them apart by. The shape walk has already held every
 * field to its kind and range; this is what a kind cannot say.
 */
export function lightingRefusal(lighting: LightingSettings): string | null {
  const over = (count: number, limit: number, what: string): string | null =>
    count > limit ? `${count} ${what}, more than the ${limit} a show may carry` : null
  const counted =
    over(lighting.fixtures.length, DMX_LIMITS.fixtures, 'fixtures') ??
    over(lighting.types.length, DMX_LIMITS.types, 'fixture types') ??
    over(lighting.groups.length, DMX_LIMITS.groups, 'groups') ??
    over(lighting.outputs.length, DMX_LIMITS.outputs, 'outputs') ??
    over(lighting.inputs.length, DMX_LIMITS.inputs, 'inputs')
  if (counted !== null) return counted
  for (const group of lighting.groups) {
    const members = over(group.fixtureIds.length, DMX_LIMITS.groupMembers, `members in group ${group.name}`)
    if (members !== null) return members
  }
  const sources: readonly string[] = ['builtin', 'user', 'import']
  for (const type of lighting.types) {
    if (!sources.includes(type.source)) return `a fixture type, ${type.name}, that comes from “${type.source}”`
    const modes = over(type.modes.length, DMX_LIMITS.modesPerType, `modes in ${type.name}`)
    if (modes !== null) return modes
    for (const mode of type.modes) {
      const params = over(mode.params.length, DMX_LIMITS.paramsPerMode, `parameters in ${type.name} ${mode.name}`)
      if (params !== null) return params
      for (const entry of mode.params) {
        if (!PARAM_KINDS.includes(entry.kind)) return `a parameter in ${type.name} of the kind “${entry.kind}”`
      }
    }
  }
  for (const output of lighting.outputs) {
    if (output.protocol !== 'sacn' && output.protocol !== 'artnet') return `an output that speaks “${output.protocol}”`
    const transports: readonly DmxTransport[] =
      output.protocol === 'sacn' ? ['multicast', 'unicast'] : ['broadcast', 'unicast']
    if (!transports.includes(output.transport)) return `an ${output.protocol} output sent by “${output.transport}”`
    const [low, high] = wireUniverseRange(output.protocol)
    if (output.wireUniverse < low || output.wireUniverse > high) {
      return `an ${output.protocol} output on universe ${output.wireUniverse}`
    }
  }
  for (const input of lighting.inputs) {
    if (input.protocol !== 'sacn' && input.protocol !== 'artnet') return `an input that listens for “${input.protocol}”`
  }
  const panics: readonly string[] = ['hold', 'release', 'blackout']
  if (!panics.includes(lighting.panic)) return `a panic that does “${lighting.panic}”`
  const universes = new Set<number>([
    ...lighting.fixtures.map(fixture => fixture.universe),
    ...lighting.outputs.map(output => output.universe),
    ...lighting.inputs.map(input => input.universe)
  ])
  const reach = over(universes.size, DMX_LIMITS.universes, 'universes')
  if (reach !== null) return reach
  const idSets: Array<[string, string[]]> = [
    ['fixtures', lighting.fixtures.map(entry => entry.id)],
    ['groups', lighting.groups.map(entry => entry.id)],
    ['fixture types', lighting.types.map(entry => entry.id)]
  ]
  for (const [what, ids] of idSets) {
    if (new Set(ids).size !== ids.length) return `two of its ${what} share an id`
  }
  return null
}
