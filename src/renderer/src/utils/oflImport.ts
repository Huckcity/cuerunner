import { DMX_LIMITS, type FixtureMode, type FixtureParam, type FixtureType, type ParamKind } from '../../../shared/dmx'

// A fixture definition from the Open Fixture Library (open-fixture-library.org): the JSON
// format its editor exports and its repository keeps one file per fixture in. What is read is
// what the patch needs — each mode's channel list, which channel is which kind of parameter,
// where a 16-bit parameter's fine channel sits, and the value a channel rests at — and nothing
// else: a capability's DMX ranges, the physical data and the links are not this app's to use.
//
// The read is bounded before it starts (`DMX_LIMITS.importBytes` of text) and on every list it
// walks, and it refuses with a sentence rather than half-importing: a fixture missing its
// fine channel would move in steps nobody asked for.

export type OflImport = { ok: true; type: FixtureType } | { ok: false; error: string }

interface OflChannel {
  capability?: { type?: unknown; color?: unknown }
  capabilities?: Array<{ type?: unknown; color?: unknown }>
  fineChannelAliases?: unknown
  defaultValue?: unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** The kind a channel is, from its (first) capability: what the patch draws and what identify does. */
function kindOf(channel: OflChannel): ParamKind {
  const capability = channel.capability ?? channel.capabilities?.[0]
  const type = typeof capability?.type === 'string' ? capability.type : ''
  const colour = typeof capability?.color === 'string' ? capability.color.toLowerCase() : ''
  switch (type) {
    case 'Intensity':
      return 'intensity'
    case 'Pan':
      return 'pan'
    case 'Tilt':
      return 'tilt'
    case 'ColorIntensity':
      switch (colour) {
        case 'red': return 'red'
        case 'green': return 'green'
        case 'blue': return 'blue'
        case 'white':
        case 'warm white':
        case 'cold white': return 'white'
        case 'amber': return 'amber'
        case 'uv': return 'uv'
        default: return 'other'
      }
    case 'ColorPreset':
    case 'WheelSlot':
    case 'WheelRotation':
      return 'colour'
    default:
      return 'other'
  }
}

/** Where a channel rests: a DMX value, or a percentage, as a share of its travel. */
function homeOf(channel: OflChannel, fine: boolean): number {
  const value = channel.defaultValue
  if (typeof value === 'number' && Number.isFinite(value)) {
    const top = fine ? 65535 : 255
    return Math.min(1, Math.max(0, value / top))
  }
  if (typeof value === 'string') {
    const percent = /^(\d+(?:\.\d+)?)%$/.exec(value.trim())
    if (percent !== null) return Math.min(1, Number(percent[1]) / 100)
  }
  return 0
}

function keyOf(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'channel'
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`
  taken.add(key)
  return key
}

/** Reads an OFL fixture definition's text into a type the show can patch. */
export function importOflFixture(text: string, fallbackName = 'Imported fixture'): OflImport {
  if (text.length > DMX_LIMITS.importBytes) {
    return { ok: false, error: `that file is larger than the ${DMX_LIMITS.importBytes / 1024} KB a fixture definition is read up to` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'that file is not JSON, so it is not an Open Fixture Library definition' }
  }
  const fixture = record(parsed)
  const available = record(fixture?.availableChannels)
  const modes = fixture?.modes
  if (fixture === null || available === null || !Array.isArray(modes)) {
    return { ok: false, error: 'that file has no availableChannels and modes, so it is not an Open Fixture Library definition' }
  }
  if (fixture.templateChannels !== undefined || fixture.matrix !== undefined) {
    return { ok: false, error: 'a pixel-matrix fixture is not read: patch it as its cells instead' }
  }
  if (modes.length === 0) return { ok: false, error: 'that fixture has no modes' }
  if (modes.length > DMX_LIMITS.modesPerType) {
    return { ok: false, error: `that fixture has ${modes.length} modes, more than the ${DMX_LIMITS.modesPerType} read` }
  }

  // Each fine alias names the coarse channel it belongs to.
  const fineOf = new Map<string, string>()
  for (const [name, raw] of Object.entries(available)) {
    const aliases = (record(raw) as OflChannel | null)?.fineChannelAliases
    if (!Array.isArray(aliases)) continue
    // Only the first fine channel is read: the 24-bit third byte is past what a value here holds.
    if (typeof aliases[0] === 'string') fineOf.set(aliases[0], name)
  }

  const read: FixtureMode[] = []
  for (const [at, rawMode] of modes.entries()) {
    const mode = record(rawMode)
    const channels = mode?.channels
    if (mode === null || !Array.isArray(channels)) return { ok: false, error: `mode ${at + 1} has no channel list` }
    if (channels.length === 0 || channels.length > DMX_LIMITS.slots) {
      return { ok: false, error: `mode ${at + 1} has ${channels.length} channels, where a mode has from 1 to 512` }
    }
    const name = typeof mode.name === 'string' && mode.name.trim() !== '' ? mode.name.trim() : `${channels.length} channel`
    const offsets = new Map<string, number>()
    channels.forEach((channel, offset) => {
      if (typeof channel === 'string') offsets.set(channel, offset)
    })
    if (channels.some(channel => channel !== null && typeof channel !== 'string')) {
      return { ok: false, error: `mode ${name} lays out a matrix, which is not read` }
    }
    const taken = new Set<string>()
    const params: FixtureParam[] = []
    for (const [channelName, offset] of offsets) {
      if (fineOf.has(channelName)) continue
      const channel = record(available[channelName]) as OflChannel | null
      if (channel === null) return { ok: false, error: `mode ${name} names a channel the fixture does not define (${channelName})` }
      const fineName = [...fineOf.entries()].find(([, coarse]) => coarse === channelName)?.[0]
      const fineOffset = fineName === undefined ? null : (offsets.get(fineName) ?? null)
      params.push({
        key: keyOf(channelName, taken),
        label: channelName.slice(0, DMX_LIMITS.nameLength),
        kind: kindOf(channel),
        offset,
        fineOffset,
        home: homeOf(channel, fineOffset !== null)
      })
    }
    if (params.length > DMX_LIMITS.paramsPerMode) {
      return { ok: false, error: `mode ${name} has ${params.length} parameters, more than the ${DMX_LIMITS.paramsPerMode} read` }
    }
    params.sort((a, b) => a.offset - b.offset)
    read.push({ name: name.slice(0, DMX_LIMITS.nameLength), channels: channels.length, params })
  }

  const names = new Set<string>()
  for (const mode of read) {
    if (names.has(mode.name)) return { ok: false, error: `two of its modes are called ${mode.name}` }
    names.add(mode.name)
  }
  const nameField = typeof fixture.name === 'string' && fixture.name.trim() !== '' ? fixture.name.trim() : fallbackName
  const manufacturer = typeof fixture.manufacturerKey === 'string' ? fixture.manufacturerKey : ''
  return {
    ok: true,
    type: {
      id: crypto.randomUUID(),
      name: nameField.slice(0, DMX_LIMITS.nameLength),
      manufacturer: manufacturer.slice(0, DMX_LIMITS.nameLength),
      source: 'import',
      modes: read
    }
  }
}
