// What the window asks the lighting engine to do, and what it answers.
//
// The engine is a show service (`dmx`), so every one of these travels over `show:command` —
// the one route the host addresses a service by — rather than over a channel of its own. The
// window resolves the patch to addresses before anything is sent: main holds levels per slot
// and puts them on the wire, and never reads a fixture.
//
// Every payload is read through the validators below before main acts on it. They are bounded
// by `DMX_LIMITS` and refuse with a sentence — thrown, which the host turns into the command's
// `{ ok: false, error }` — because a payload is the one input main does not write itself.

import type { FadeCurve } from './cue'
import {
  DMX_LIMITS,
  EFFECT_RATE_RANGE,
  EFFECT_SHAPES,
  wireUniverseRange,
  type DmxAddress,
  type DmxValue,
  type EffectShape,
  type LightingPanic,
  type UniverseInput,
  type UniverseOutput
} from './dmx'

/** The lighting engine's service id. */
export const DMX_SERVICE_ID = 'dmx'

/**
 * What `importGdtf` answers: a fixture type read from a GDTF file, with what the import has to
 * say about it, or the sentence a file that cannot be read was refused with. Main reads the file
 * — the window has no zip reader and no file system — and the window adds the type to the show.
 */
export type GdtfImportResult =
  | { ok: true; type: import('./dmx').FixtureType; notes: string[] }
  | { ok: false; error: string }

/** The `importGdtf` payload: the file, by its full path. */
export interface GdtfImportRequest {
  path: string
}

/** Where the show's data goes, and what a panic does: the slice of the lighting main reads. */
export interface DmxConfig {
  outputs: UniverseOutput[]
  inputs: UniverseInput[]
  sync: boolean
  syncUniverse: number
  panic: LightingPanic
}

/** An effect resolved to the slot it moves. */
export interface DmxEffect extends DmxAddress {
  shape: EffectShape
  rate: number
  low: number
  high: number
  /** Where in its cycle this slot starts, 0–1: how a group's spread becomes a chase. */
  phase: number
}

/** A Light cue's GO: the values it fades to, the effects it starts, and how. */
export interface DmxGo {
  cueId: string
  values: DmxValue[]
  fadeMs: number
  curve: FadeCurve
  /** Intensity from this cue is highest-takes-precedence rather than latest. */
  htp: boolean
  effects: DmxEffect[]
}

/** A release: the slots a cue holds fade home. `cueId` null releases everything. */
export interface DmxRelease {
  cueId: string | null
  fadeMs: number
  curve: FadeCurve
}

/** A Fade cue aimed at a Light cue: its intensity scaled to `level` of what it set. */
export interface DmxLevel {
  cueId: string
  level: number
  fadeMs: number
  curve: FadeCurve
}

/** A live value from the lighting view's faders, tagged with the parameter it came from. */
export interface DmxProgrammerValue extends DmxValue {
  fixtureId: string
  param: string
}

/** One row of the network interface choice: a machine fact, kept with the machine. */
export interface DmxInterface {
  name: string
  address: string
  netmask: string
  /** The directed broadcast address of the interface's subnet. */
  broadcast: string
  internal: boolean
}

export interface DmxInterfaces {
  interfaces: DmxInterface[]
  /** The interface the operator chose, by name, or null for whatever the OS routes by. */
  selected: string | null
  /** True where the chosen interface is not on this machine now: traffic goes out unpinned. */
  missing: boolean
}

/** An Art-Net node that answered a poll. */
export interface ArtNetNode {
  address: string
  shortName: string
  longName: string
  /** The Port-Addresses its outputs are set to. */
  outputs: number[]
  /** The Port-Addresses its inputs are set to. */
  inputs: number[]
  mac: string
  /** Which of a multi-port device's bound nodes this is, 1-based; 0 when it does not say. */
  bindIndex: number
}

/** One universe as the monitor draws it. */
export interface DmxMonitorUniverse {
  universe: number
  /** The 512 bytes going out. */
  output: number[]
  /** The 512 bytes heard from a console listened to on this universe, or null. */
  input: number[] | null
  /** Who that was, as its packets name it. */
  inputSource: string | null
  /** Whether any output is configured for it: a universe with none is computed but not sent. */
  sent: boolean
}

export interface DmxMonitor {
  at: number
  blackout: boolean
  /** Every universe the engine knows: patched, sent, or heard. */
  universes: number[]
  /** The ones the request asked for, with their bytes. */
  frames: DmxMonitorUniverse[]
  /** Values the faders are holding. */
  programmer: DmxProgrammerValue[]
  /** The cues holding at least one slot, by id. */
  holding: string[]
  /** Packets sent since the engine started, and the last send error, if any. */
  packets: number
  error: string | null
}

/** How many universes one monitor request may read: a view draws one, a comparison two. */
export const MONITOR_UNIVERSES_PER_REQUEST = 4

// ─── Validation ───────────────────────────────────────────────────────────────

function fail(sentence: string): never {
  throw new Error(sentence)
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${what} is not an object`)
  return value as Record<string, unknown>
}

function list(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${what} is not a list`)
  if (value.length > max) fail(`${what} has ${value.length} entries, more than the ${max} allowed`)
  return value
}

function integer(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${what} must be a whole number from ${min} to ${max}`)
  }
  return value
}

function fraction(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${what} must be a number from 0 to 1`)
  }
  return value
}

function text(value: unknown, what: string, max: number = DMX_LIMITS.nameLength): string {
  if (typeof value !== 'string' || value.length > max) fail(`${what} must be text of at most ${max} characters`)
  return value
}

function flag(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') fail(`${what} must be true or false`)
  return value
}

function oneOf<T extends string>(value: unknown, what: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`${what} must be one of ${allowed.join(', ')}`)
  }
  return value as T
}

const CURVES: readonly FadeCurve[] = ['linear', 'sCurve', 'logarithmic']

function fadeMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > DMX_LIMITS.fadeMs) {
    fail(`a fade must be from 0 to ${DMX_LIMITS.fadeMs} ms`)
  }
  return value
}

function address(value: unknown, what: string): DmxAddress {
  const entry = record(value, what)
  const u = integer(entry.u, `${what}'s universe`, 1, DMX_LIMITS.maxUniverse)
  const s = integer(entry.s, `${what}'s slot`, 0, DMX_LIMITS.slots - 1)
  const f = entry.f === null ? null : integer(entry.f, `${what}'s fine slot`, 0, DMX_LIMITS.slots - 1)
  return { u, s, f, i: flag(entry.i, `${what}'s intensity flag`), h: fraction(entry.h, `${what}'s home`) }
}

function value(entry: unknown, what: string): DmxValue {
  return { ...address(entry, what), v: fraction(record(entry, what).v, `${what}'s value`) }
}

function values(payload: unknown, what: string): DmxValue[] {
  return list(payload, what, DMX_LIMITS.wireValues).map((entry, at) => value(entry, `${what} ${at}`))
}

/** Universes in one payload are bounded too: the engine renders every one it holds. */
function boundedUniverses(entries: readonly { u: number }[], what: string): void {
  const seen = new Set<number>()
  for (const entry of entries) {
    seen.add(entry.u)
    if (seen.size > DMX_LIMITS.universes) fail(`${what} reaches more than ${DMX_LIMITS.universes} universes`)
  }
}

export function readDmxConfig(payload: unknown): DmxConfig {
  const config = record(payload, 'the lighting configuration')
  const outputs = list(config.outputs, 'the outputs', DMX_LIMITS.outputs).map((raw, at): UniverseOutput => {
    const entry = record(raw, `output ${at}`)
    const protocol = oneOf(entry.protocol, `output ${at}'s protocol`, ['sacn', 'artnet'] as const)
    const [low, high] = wireUniverseRange(protocol)
    const transport = oneOf(
      entry.transport,
      `output ${at}'s transport`,
      protocol === 'sacn' ? (['multicast', 'unicast'] as const) : (['broadcast', 'unicast'] as const)
    )
    return {
      id: text(entry.id, `output ${at}'s id`),
      universe: integer(entry.universe, `output ${at}'s universe`, 1, DMX_LIMITS.maxUniverse),
      protocol,
      transport,
      address: text(entry.address, `output ${at}'s address`, 253),
      wireUniverse: integer(entry.wireUniverse, `output ${at}'s wire universe`, low, high),
      priority: integer(entry.priority, `output ${at}'s priority`, 0, 200),
      enabled: flag(entry.enabled, `output ${at}'s switch`)
    }
  })
  const inputs = list(config.inputs, 'the inputs', DMX_LIMITS.inputs).map((raw, at): UniverseInput => {
    const entry = record(raw, `input ${at}`)
    const protocol = oneOf(entry.protocol, `input ${at}'s protocol`, ['sacn', 'artnet'] as const)
    const [low, high] = wireUniverseRange(protocol)
    return {
      id: text(entry.id, `input ${at}'s id`),
      protocol,
      wireUniverse: integer(entry.wireUniverse, `input ${at}'s wire universe`, low, high),
      universe: integer(entry.universe, `input ${at}'s universe`, 1, DMX_LIMITS.maxUniverse),
      merge: flag(entry.merge, `input ${at}'s merge`),
      enabled: flag(entry.enabled, `input ${at}'s switch`)
    }
  })
  boundedUniverses(
    [...outputs.map(entry => ({ u: entry.universe })), ...inputs.map(entry => ({ u: entry.universe }))],
    'the configuration'
  )
  return {
    outputs,
    inputs,
    sync: flag(config.sync, 'sync'),
    syncUniverse: integer(config.syncUniverse, 'the sync universe', 1, 63999),
    panic: oneOf(config.panic, 'the panic rule', ['hold', 'release', 'blackout'] as const)
  }
}

export function readDmxGo(payload: unknown): DmxGo {
  const go = record(payload, 'a Light cue')
  const read = values(go.values, 'the look')
  const effects = list(go.effects, 'the effects', DMX_LIMITS.effects).map((raw, at): DmxEffect => {
    const entry = record(raw, `effect ${at}`)
    const [minRate, maxRate] = EFFECT_RATE_RANGE
    const rate = entry.rate
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < minRate || rate > maxRate) {
      fail(`effect ${at}'s rate must be from ${minRate} to ${maxRate} cycles a second`)
    }
    return {
      ...address(entry, `effect ${at}`),
      shape: oneOf(entry.shape, `effect ${at}'s shape`, EFFECT_SHAPES),
      rate,
      low: fraction(entry.low, `effect ${at}'s low`),
      high: fraction(entry.high, `effect ${at}'s high`),
      phase: fraction(entry.phase, `effect ${at}'s phase`)
    }
  })
  boundedUniverses([...read, ...effects], 'a Light cue')
  return {
    cueId: text(go.cueId, 'the cue id'),
    values: read,
    fadeMs: fadeMs(go.fadeMs),
    curve: oneOf(go.curve, 'the curve', CURVES),
    htp: flag(go.htp, 'the intensity rule'),
    effects
  }
}

export function readDmxRelease(payload: unknown): DmxRelease {
  const release = record(payload, 'a release')
  return {
    cueId: release.cueId === null ? null : text(release.cueId, 'the cue id'),
    fadeMs: fadeMs(release.fadeMs),
    curve: oneOf(release.curve, 'the curve', CURVES)
  }
}

export function readDmxLevel(payload: unknown): DmxLevel {
  const level = record(payload, 'a level change')
  return {
    cueId: text(level.cueId, 'the cue id'),
    level: fraction(level.level, 'the level'),
    fadeMs: fadeMs(level.fadeMs),
    curve: oneOf(level.curve, 'the curve', CURVES)
  }
}

export function readDmxCueId(payload: unknown): string {
  return text(record(payload, 'a stop').cueId, 'the cue id')
}

export function readDmxProgram(payload: unknown): DmxProgrammerValue[] {
  const program = record(payload, 'the faders')
  const read = list(program.values, 'the faders', DMX_LIMITS.wireValues).map((raw, at) => {
    const entry = record(raw, `fader ${at}`)
    return {
      ...value(entry, `fader ${at}`),
      fixtureId: text(entry.fixtureId, `fader ${at}'s fixture`),
      param: text(entry.param, `fader ${at}'s parameter`)
    }
  })
  boundedUniverses(read, 'the faders')
  return read
}

export function readDmxIdentify(payload: unknown): { values: DmxValue[]; ms: number } {
  const identify = record(payload, 'an identify')
  const ms = identify.ms
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > 60_000) {
    fail('an identify lasts from 0 to 60000 ms')
  }
  const read = values(identify.values, 'the identify')
  boundedUniverses(read, 'an identify')
  return { values: read, ms }
}

export function readDmxBlackout(payload: unknown): boolean {
  return flag(record(payload, 'a blackout').on, 'the blackout')
}

export function readDmxMonitorRequest(payload: unknown): number[] {
  if (payload === undefined) return []
  const request = record(payload, 'a monitor request')
  return list(request.universes, 'the universes', MONITOR_UNIVERSES_PER_REQUEST).map((entry, at) =>
    integer(entry, `universe ${at}`, 1, DMX_LIMITS.maxUniverse)
  )
}

export function readDmxInterfaceChoice(payload: unknown): string | null {
  const choice = record(payload, 'an interface choice')
  return choice.name === null ? null : text(choice.name, 'the interface name')
}
