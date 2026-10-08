// A GDTF fixture type (DIN SPEC 15800, the General Device Type Format), read into a type the
// show can patch.
//
// A `.gdtf` file is a zip with a `description.xml` in it, beside the 3D models and wheel images
// a visualiser wants and this app does not. The archive is read with the show bundle's own
// reader (`../workspace/zip.ts`) — its directory only, and then that one entry, inflated up to
// a bound — and the XML with a reader that refuses what XML can do to a machine that trusts it
// (`./xml.ts`).
//
// What is read is what the patch needs. Each DMX mode becomes a mode; each DMX channel with an
// offset becomes a parameter: its kind from the attribute of the function it starts on, its
// coarse and fine slots from its offsets, where it rests from that function's default, and —
// where a channel does several things across its travel, a shutter that closes, opens and
// strobes — the name and start of each channel function, so the faders can say which one a
// value is in. A 24- or 32-bit channel is driven on its two most significant bytes, which is all
// a value here resolves, and the bytes below them are held at zero; the import says so.
//
// Anything the model cannot carry faithfully is refused with a sentence rather than half
// imported: a mode spread over several DMX breaks (separately addressed parts of one fixture),
// a channel that overwrites another break, a mode with no DMX channels at all.

import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import {
  DMX_LIMITS,
  type FixtureFunction,
  type FixtureMode,
  type FixtureParam,
  type FixtureType,
  type ParamKind
} from '../../shared/dmx'
import type { GdtfImportRequest, GdtfImportResult } from '../../shared/dmxWire'
import { asRefusal, Refusal } from '../ipc/refusal'
import { readZip, readZipEntry } from '../workspace/zip'
import { childNamed, childrenNamed, parseXml, type XmlElement } from './xml'

/** What an import came to: the type, with what it has to say about it, or the sentence that refused it. */
export type GdtfImport = GdtfImportResult

/** The largest `.gdtf` this app opens: models and images make them megabytes, not gigabytes. */
export const GDTF_MAX_FILE_BYTES = 256 * 1024 * 1024

/**
 * The kind of parameter a GDTF attribute is. The names are GDTF's own (DIN SPEC 15800 annex A):
 * `ColorAdd_R` and its siblings for emitters, `ColorRGB_*` for the older RGB set, the colour
 * wheels and macros as `Color1`, `ColorMacro1` and the like.
 */
export function kindOfAttribute(attribute: string): ParamKind {
  switch (attribute) {
    case 'Dimmer':
      return 'intensity'
    case 'Pan':
      return 'pan'
    case 'Tilt':
      return 'tilt'
    case 'ColorAdd_R':
    case 'ColorRGB_Red':
      return 'red'
    case 'ColorAdd_G':
    case 'ColorRGB_Green':
      return 'green'
    case 'ColorAdd_B':
    case 'ColorRGB_Blue':
      return 'blue'
    case 'ColorAdd_W':
    case 'ColorAdd_WW':
    case 'ColorAdd_CW':
    case 'ColorRGB_White':
      return 'white'
    case 'ColorAdd_A':
    case 'ColorRGB_Amber':
      return 'amber'
    case 'ColorAdd_UV':
      return 'uv'
    default:
      return /^(Color\d|ColorMacro|ColorSub_|CTO|CTC|CTB|HSB_|CIE_|ColorMixMode|ColorModel)/.test(attribute) ? 'colour' : 'other'
  }
}

/**
 * A DMX value as a share of a channel's travel. GDTF writes `value/n` — the value in an n-byte
 * resolution — so `32768/2` and `128/1` are both half; a bare number is in the channel's own
 * resolution. Null for `None`, or anything that is not a value.
 */
export function dmxShare(text: string | undefined, channelBytes: number): number | null {
  if (text === undefined) return null
  const trimmed = text.trim()
  const match = /^(\d+)(?:\/([1-4]))?$/.exec(trimmed)
  if (match === null) return null
  const bytes = match[2] === undefined ? channelBytes : Number(match[2])
  const top = 2 ** (8 * bytes) - 1
  return Math.min(1, Math.max(0, Number(match[1]) / top))
}

function clip(text: string): string {
  return text.slice(0, DMX_LIMITS.nameLength)
}

function keyOf(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'channel'
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`
  taken.add(key)
  return key
}

/** The pretty names the description gives its attributes: `Dimmer` → `Dim`, kept as the label's source. */
function prettyNames(fixture: XmlElement): Map<string, string> {
  const pretty = new Map<string, string>()
  const definitions = childNamed(fixture, 'AttributeDefinitions')
  const attributes = definitions === null ? null : childNamed(definitions, 'Attributes')
  for (const attribute of attributes === null ? [] : childrenNamed(attributes, 'Attribute')) {
    const name = attribute.attributes.Name
    if (name === undefined) continue
    pretty.set(name, attribute.attributes.Pretty?.trim() || name)
  }
  return pretty
}

interface ReadChannel {
  offsets: number[]
  attribute: string
  geometry: string
  initial: XmlElement | null
  functions: XmlElement[]
  legacyDefault: string | undefined
}

/** One DMX channel's facts: its offsets, the attribute and function it starts on, all its functions. */
function readChannel(channel: XmlElement, modeName: string, index: number): ReadChannel | null {
  const offsetText = (channel.attributes.Offset ?? '').trim()
  if (offsetText === '' || offsetText === 'None') return null // A virtual channel: it has no slot.
  const offsets = offsetText.split(',').map(part => Number(part.trim()))
  if (offsets.some(offset => !Number.isInteger(offset) || offset < 1 || offset > DMX_LIMITS.slots)) {
    throw new Refusal(`mode ${modeName} has a channel at offset “${offsetText}”, which is not a slot from 1 to 512`)
  }
  if (offsets.length > 4) {
    throw new Refusal(`mode ${modeName} has a channel ${offsets.length} bytes wide; GDTF goes to 4`)
  }
  const logical = childrenNamed(channel, 'LogicalChannel')
  if (logical.length === 0) {
    throw new Refusal(`mode ${modeName}'s channel ${index + 1} has no logical channel, so it does nothing this app can name`)
  }
  const functions = logical.flatMap(entry => childrenNamed(entry, 'ChannelFunction'))
  // The function a channel starts on: named by its InitialFunction (GDTF 1.1 and later) as
  // `Channel.LogicalChannel.Function`, or the first one there is.
  const initialName = channel.attributes.InitialFunction?.split('.').pop()
  const initial =
    (initialName === undefined ? undefined : functions.find(entry => entry.attributes.Name === initialName)) ??
    functions[0] ??
    null
  return {
    offsets,
    attribute: initial?.attributes.Attribute ?? logical[0].attributes.Attribute ?? '',
    geometry: channel.attributes.Geometry ?? '',
    initial,
    functions,
    legacyDefault: channel.attributes.Default
  }
}

/** A channel's functions as the ranges of its travel, in order, when there is more than one. */
function rangesOf(channel: ReadChannel, pretty: Map<string, string>): FixtureFunction[] | undefined {
  if (channel.functions.length < 2) return undefined
  const ranges: FixtureFunction[] = []
  for (const entry of channel.functions) {
    const from = dmxShare(entry.attributes.DMXFrom ?? '0/1', channel.offsets.length)
    if (from === null) continue
    const attribute = entry.attributes.Attribute ?? ''
    const name = entry.attributes.Name?.trim() || pretty.get(attribute) || attribute || 'Function'
    ranges.push({ name: clip(name), from })
  }
  ranges.sort((a, b) => a.from - b.from)
  return ranges.length < 2 ? undefined : ranges.slice(0, DMX_LIMITS.functionsPerParam)
}

/**
 * A GDTF description, already parsed, as a fixture type. Pure: the tests hand it documents built
 * in the test, and the file reader below hands it the one it read.
 */
export function gdtfToFixtureType(root: XmlElement, fallbackName = 'Imported fixture'): GdtfImport {
  try {
    return { ok: true, ...readType(root, fallbackName) }
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message }
    throw error
  }
}

function readType(root: XmlElement, fallbackName: string): { type: FixtureType; notes: string[] } {
  if (root.name !== 'GDTF') throw new Refusal('its description is not a GDTF document')
  const fixture = childNamed(root, 'FixtureType')
  if (fixture === null) throw new Refusal('its description has no FixtureType')
  const modes = childrenNamed(childNamed(fixture, 'DMXModes') ?? fixture, 'DMXMode')
  if (modes.length === 0) throw new Refusal('that fixture has no DMX modes')
  if (modes.length > DMX_LIMITS.modesPerType) {
    throw new Refusal(`that fixture has ${modes.length} DMX modes, more than the ${DMX_LIMITS.modesPerType} read`)
  }
  const pretty = prettyNames(fixture)
  const notes: string[] = []
  const read: FixtureMode[] = []
  const names = new Set<string>()

  for (const [at, mode] of modes.entries()) {
    const modeName = clip(mode.attributes.Name?.trim() || `Mode ${at + 1}`)
    if (names.has(modeName)) throw new Refusal(`two of its modes are called ${modeName}`)
    names.add(modeName)
    const channelElements = childrenNamed(childNamed(mode, 'DMXChannels') ?? mode, 'DMXChannel')
    if (channelElements.length > DMX_LIMITS.slots * 4) {
      throw new Refusal(`mode ${modeName} has ${channelElements.length} channels, more than this app reads`)
    }

    // Every channel has to land in one footprint: a second DMX break is a separately addressed
    // part of the fixture, which one patched fixture here cannot be.
    const breaks = new Set<string>()
    for (const channel of channelElements) {
      const offset = (channel.attributes.Offset ?? '').trim()
      if (offset === '' || offset === 'None') continue
      const dmxBreak = (channel.attributes.DMXBreak ?? '1').trim()
      if (dmxBreak === 'Overwrite') {
        throw new Refusal(`mode ${modeName} has a channel that overwrites another DMX break, which is not read`)
      }
      breaks.add(dmxBreak)
    }
    if (breaks.size > 1) {
      throw new Refusal(
        `mode ${modeName} is spread over ${breaks.size} DMX breaks — parts of the fixture addressed separately — and a fixture here is patched at one address: patch each part as a fixture of its own`
      )
    }

    const channels: ReadChannel[] = []
    channelElements.forEach((channel, index) => {
      const readOne = readChannel(channel, modeName, index)
      if (readOne !== null) channels.push(readOne)
    })
    if (channels.length === 0) throw new Refusal(`mode ${modeName} has no DMX channels`)
    if (channels.length > DMX_LIMITS.paramsPerMode) {
      throw new Refusal(`mode ${modeName} has ${channels.length} channels, more than the ${DMX_LIMITS.paramsPerMode} parameters read`)
    }

    // Two channels claiming one slot is a description that contradicts itself.
    const used = new Map<number, string>()
    let footprint = 0
    for (const channel of channels) {
      for (const offset of channel.offsets) {
        const other = used.get(offset)
        if (other !== undefined) {
          throw new Refusal(`mode ${modeName} puts ${other} and ${channel.attribute || 'another channel'} on slot ${offset}`)
        }
        used.set(offset, channel.attribute || 'a channel')
        footprint = Math.max(footprint, offset)
      }
    }

    // A label per channel: the attribute's pretty name, and the geometry it drives where two
    // channels share an attribute (each cell of a multi-cell fixture).
    const sharing = new Map<string, number>()
    for (const channel of channels) sharing.set(channel.attribute, (sharing.get(channel.attribute) ?? 0) + 1)
    const taken = new Set<string>()
    const params: FixtureParam[] = channels.map(channel => {
      const named = pretty.get(channel.attribute) ?? (channel.attribute || 'Channel')
      const label = clip((sharing.get(channel.attribute) ?? 0) > 1 && channel.geometry !== '' ? `${named} (${channel.geometry})` : named)
      const bytes = channel.offsets.length
      const home =
        dmxShare(channel.initial?.attributes.Default, bytes) ??
        dmxShare(channel.legacyDefault, bytes) ??
        0
      if (bytes > 2) {
        notes.push(`${label} in ${modeName} is ${bytes * 8}-bit: its two most significant bytes are driven and the rest held at zero.`)
      }
      const param: FixtureParam = {
        key: keyOf(label, taken),
        label,
        kind: kindOfAttribute(channel.attribute),
        offset: channel.offsets[0] - 1,
        fineOffset: bytes >= 2 ? channel.offsets[1] - 1 : null,
        home
      }
      const ranges = rangesOf(channel, pretty)
      if (ranges !== undefined) param.functions = ranges
      return param
    })
    params.sort((a, b) => a.offset - b.offset)
    read.push({ name: modeName, channels: footprint, params })
  }

  const name = clip(
    fixture.attributes.LongName?.trim() || fixture.attributes.Name?.trim() || fixture.attributes.ShortName?.trim() || fallbackName
  )
  const manufacturer = clip(fixture.attributes.Manufacturer?.trim() ?? '')
  return {
    type: { id: randomUUID(), name, manufacturer, source: 'import', modes: read },
    notes
  }
}

/**
 * A `.gdtf` file on disk, read into a type: the archive's directory, its `description.xml`
 * inflated up to the bound, and the description mapped. Every ordinary "no" is the refusal arm,
 * with the sentence the operator reads.
 */
export async function importGdtfFile(filePath: string, fallbackName = 'Imported fixture'): Promise<GdtfImport> {
  try {
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      throw new Refusal('that file could not be opened: it has moved, or this machine will not let it be read')
    }
    if (size > GDTF_MAX_FILE_BYTES) {
      throw new Refusal(`that file is larger than the ${GDTF_MAX_FILE_BYTES / (1024 * 1024)} MB a GDTF file is read up to`)
    }
    const entries = await readZip(filePath).catch((error: unknown) => {
      const refusal = asRefusal(error)
      throw new Refusal(`${refusal.message}, so it is not a GDTF file`)
    })
    const description = entries.find(entry => entry.name === 'description.xml') ??
      entries.find(entry => entry.name.toLowerCase() === 'description.xml')
    if (description === undefined) throw new Refusal('that archive has no description.xml, so it is not a GDTF file')
    if (description.size > DMX_LIMITS.gdtfDescriptionBytes) {
      throw new Refusal(`its description.xml is larger than the ${DMX_LIMITS.gdtfDescriptionBytes / (1024 * 1024)} MB this app reads`)
    }
    // A deflate stream that does not inflate is a damaged file, not a fault of this machine's.
    const bytes = await readZipEntry(filePath, description, DMX_LIMITS.gdtfDescriptionBytes).catch((error: unknown) => {
      throw new Refusal(`its description.xml could not be read: ${asRefusal(error).message}`)
    })
    const root = parseXml(bytes.toString('utf8'))
    return gdtfToFixtureType(root, fallbackName)
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message }
    throw error
  }
}

/** The one thing the window sends to import a file: where it is. Refused with a sentence otherwise. */
export function readGdtfRequest(payload: unknown): GdtfImportRequest {
  const path = typeof payload === 'object' && payload !== null ? (payload as { path?: unknown }).path : undefined
  if (typeof path !== 'string' || path === '' || path.length > 4096 || !isAbsolute(path) || path.includes('\0')) {
    throw new Error('a GDTF import names the file by its full path')
  }
  return { path }
}

/** The name a type falls back to when its description gives none: the file's own. */
export function gdtfFallbackName(path: string): string {
  return basename(path).replace(/\.gdtf$/i, '') || 'Imported fixture'
}
