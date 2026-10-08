// GDTF fixture types, read from descriptions written here by hand — no downloaded file — into
// the show's own fixture-type model: modes, channels and their widths, where each rests, the
// functions across a channel's travel, and a sentence for whatever the model cannot carry.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gdtfFallbackName, gdtfToFixtureType, importGdtfFile, kindOfAttribute, dmxShare, readGdtfRequest } from './gdtf'
import { parseXml } from './xml'
import { writeZip } from '../workspace/zip'
import { functionAt, lightingRefusal, defaultLightingSettings, type FixtureType } from '../../shared/dmx'

/** One DMX channel of a description, as GDTF writes it. */
interface Channel {
  offset: string
  geometry?: string
  dmxBreak?: string
  initial?: string
  legacyDefault?: string
  /** The logical channel's attribute. */
  attribute: string
  functions: Array<{ name: string; attribute?: string; from: string; default?: string }>
}

function channelXml(channel: Channel): string {
  const attributes = [
    `DMXBreak="${channel.dmxBreak ?? '1'}"`,
    `Offset="${channel.offset}"`,
    `Geometry="${channel.geometry ?? 'Beam'}"`,
    channel.initial === undefined ? '' : `InitialFunction="${channel.initial}"`,
    channel.legacyDefault === undefined ? '' : `Default="${channel.legacyDefault}"`,
    'Highlight="None"'
  ].filter(Boolean).join(' ')
  const functions = channel.functions
    .map(entry =>
      `<ChannelFunction Name="${entry.name}" Attribute="${entry.attribute ?? channel.attribute}" OriginalAttribute="" DMXFrom="${entry.from}"` +
      `${entry.default === undefined ? '' : ` Default="${entry.default}"`} PhysicalFrom="0" PhysicalTo="1" RealFade="0">` +
      `<ChannelSet Name="" DMXFrom="${entry.from}"/></ChannelFunction>`
    )
    .join('')
  return `<DMXChannel ${attributes}><LogicalChannel Attribute="${channel.attribute}" Snap="No" Master="None">${functions}</LogicalChannel></DMXChannel>`
}

function description(modes: Array<{ name: string; channels: Channel[] }>, fixture = 'Name="Spot" ShortName="SP" LongName="Test Spot 300" Manufacturer="Test Lights"'): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<GDTF DataVersion="1.2">',
    `  <FixtureType ${fixture} Description="" FixtureTypeID="5A2C1F1E-0000-4000-8000-000000000001" Thumbnail="">`,
    '    <AttributeDefinitions>',
    '      <ActivationGroups><ActivationGroup Name="PanTilt"/></ActivationGroups>',
    '      <Attributes>',
    '        <Attribute Name="Dimmer" Pretty="Dim" Feature="Dimmer.Dimmer" PhysicalUnit="LuminousIntensity"/>',
    '        <Attribute Name="Pan" Pretty="P" ActivationGroup="PanTilt" Feature="Position.PanTilt" PhysicalUnit="Angle"/>',
    '        <Attribute Name="Tilt" Pretty="T" ActivationGroup="PanTilt" Feature="Position.PanTilt" PhysicalUnit="Angle"/>',
    '        <Attribute Name="Shutter1" Pretty="Sh1" Feature="Beam.Beam"/>',
    '        <Attribute Name="Shutter1Strobe" Pretty="Strobe1" Feature="Beam.Beam"/>',
    '        <Attribute Name="ColorAdd_R" Pretty="R" Feature="Color.RGB"/>',
    '        <Attribute Name="Color1" Pretty="C1" Feature="Color.Color"/>',
    '      </Attributes>',
    '    </AttributeDefinitions>',
    '    <Wheels/><PhysicalDescriptions/><Models/><Geometries/>',
    '    <DMXModes>',
    ...modes.map(mode =>
      `      <DMXMode Name="${mode.name}" Geometry="Base"><DMXChannels>${mode.channels.map(channelXml).join('')}</DMXChannels><Relations/><FTMacros/></DMXMode>`
    ),
    '    </DMXModes>',
    '    <Revisions/><FTPresets/><Protocols/>',
    '  </FixtureType>',
    '</GDTF>'
  ].join('\n')
}

const PAN_16: Channel = {
  offset: '1,2',
  geometry: 'Yoke',
  initial: 'Yoke_Pan.Pan.Pan 1',
  attribute: 'Pan',
  functions: [{ name: 'Pan 1', from: '0/1', default: '32768/2' }]
}
const SHUTTER: Channel = {
  offset: '3',
  initial: 'Beam_Shutter1.Shutter1.Open',
  attribute: 'Shutter1',
  functions: [
    { name: 'Closed', from: '0/1', default: '0/1' },
    { name: 'Open', from: '32/1', default: '32/1' },
    { name: 'Strobe', attribute: 'Shutter1Strobe', from: '64/1', default: '64/1' }
  ]
}
const DIMMER_24: Channel = {
  offset: '4,5,6',
  attribute: 'Dimmer',
  functions: [{ name: 'Dimmer 1', from: '0/3', default: '0/3' }]
}
const VIRTUAL: Channel = { offset: 'None', attribute: 'Dimmer', functions: [{ name: 'Virtual', from: '0/1' }] }
/** GDTF 1.0: the default on the channel itself, and no initial function named. */
const RED_LEGACY: Channel = { offset: '7', legacyDefault: '128', attribute: 'ColorAdd_R', functions: [{ name: 'R', from: '0/1' }] }

function read(xml: string): ReturnType<typeof gdtfToFixtureType> {
  return gdtfToFixtureType(parseXml(xml), 'fallback')
}

function typeOf(xml: string): { type: FixtureType; notes: string[] } {
  const result = read(xml)
  if (!result.ok) throw new Error(`refused: ${result.error}`)
  return result
}

describe('a GDTF description, read into a fixture type', () => {
  it('reads each mode, its footprint, and each channel with its width, slots and kind', () => {
    const { type } = typeOf(description([
      { name: 'Standard', channels: [PAN_16, SHUTTER, DIMMER_24, VIRTUAL, RED_LEGACY] },
      { name: 'Basic', channels: [{ ...PAN_16, offset: '1' }, { ...SHUTTER, offset: '2' }] }
    ]))
    expect(type).toMatchObject({ name: 'Test Spot 300', manufacturer: 'Test Lights', source: 'import' })
    expect(type.modes.map(mode => [mode.name, mode.channels, mode.params.length])).toEqual([
      ['Standard', 7, 4],
      ['Basic', 2, 2]
    ])
    const [pan, shutter, dimmer, red] = type.modes[0].params
    expect(pan).toMatchObject({ key: 'p', label: 'P', kind: 'pan', offset: 0, fineOffset: 1 })
    expect(shutter).toMatchObject({ label: 'Sh1', kind: 'other', offset: 2, fineOffset: null })
    expect(dimmer).toMatchObject({ label: 'Dim', kind: 'intensity', offset: 3, fineOffset: 4 })
    expect(red).toMatchObject({ label: 'R', kind: 'red', offset: 6, fineOffset: null })
    expect(type.modes[1].params[0]).toMatchObject({ kind: 'pan', offset: 0, fineOffset: null })
  })

  it('rests each channel where its initial function says — or, from GDTF 1.0, where the channel does', () => {
    const { type } = typeOf(description([{ name: 'Standard', channels: [PAN_16, SHUTTER, DIMMER_24, RED_LEGACY] }]))
    const [pan, shutter, dimmer, red] = type.modes[0].params
    expect(pan.home).toBeCloseTo(32768 / 65535, 6)
    // The shutter starts on Open, not on the first function.
    expect(shutter.home).toBeCloseTo(32 / 255, 6)
    expect(dimmer.home).toBe(0)
    expect(red.home).toBeCloseTo(128 / 255, 6)
  })

  it('carries a channel’s functions as the ranges of its travel, and names the one a value is in', () => {
    const { type } = typeOf(description([{ name: 'Standard', channels: [PAN_16, SHUTTER] }]))
    const [pan, shutter] = type.modes[0].params
    expect(pan.functions, 'a channel that does one thing carries no ranges').toBeUndefined()
    expect(shutter.functions).toEqual([
      { name: 'Closed', from: 0 },
      { name: 'Open', from: 32 / 255 },
      { name: 'Strobe', from: 64 / 255 }
    ])
    expect(functionAt(shutter, 0)).toBe('Closed')
    expect(functionAt(shutter, 40 / 255)).toBe('Open')
    expect(functionAt(shutter, 1)).toBe('Strobe')
  })

  it('drives a 24-bit channel on its top two bytes, and says so', () => {
    const { notes } = typeOf(description([{ name: 'Standard', channels: [DIMMER_24] }]))
    expect(notes).toEqual(['Dim in Standard is 24-bit: its two most significant bytes are driven and the rest held at zero.'])
  })

  it('tells the cells of a multi-cell fixture apart by their geometry', () => {
    const { type } = typeOf(description([{
      name: '2 cell',
      channels: [
        { offset: '1', geometry: 'Cell1', attribute: 'Dimmer', functions: [{ name: 'Dimmer 1', from: '0/1' }] },
        { offset: '2', geometry: 'Cell2', attribute: 'Dimmer', functions: [{ name: 'Dimmer 1', from: '0/1' }] }
      ]
    }]))
    expect(type.modes[0].params.map(param => [param.key, param.label])).toEqual([
      ['dim-cell1', 'Dim (Cell1)'],
      ['dim-cell2', 'Dim (Cell2)']
    ])
  })

  it('names a colour wheel as colour, and an attribute it does not know as other', () => {
    expect(kindOfAttribute('Color1')).toBe('colour')
    expect(kindOfAttribute('ColorMacro1')).toBe('colour')
    expect(kindOfAttribute('CTO')).toBe('colour')
    expect(kindOfAttribute('ColorAdd_UV')).toBe('uv')
    expect(kindOfAttribute('Gobo1')).toBe('other')
  })

  it('reads a DMX value in any resolution as a share of the channel’s travel', () => {
    expect(dmxShare('128/1', 1)).toBeCloseTo(128 / 255)
    expect(dmxShare('32768/2', 1)).toBeCloseTo(32768 / 65535)
    expect(dmxShare('255', 1)).toBe(1)
    expect(dmxShare('65535', 2)).toBe(1)
    expect(dmxShare('None', 1)).toBeNull()
    expect(dmxShare('9/9', 1)).toBeNull()
  })

  it('falls back to the short name, then the file’s, when the description has no long one', () => {
    expect(typeOf(description([{ name: 'M', channels: [RED_LEGACY] }], 'Name="Wash" Manufacturer="X"')).type.name).toBe('Wash')
    expect(typeOf(description([{ name: 'M', channels: [RED_LEGACY] }], 'Manufacturer="X"')).type.name).toBe('fallback')
    expect(gdtfFallbackName('/rig/Robe@Spiider@2020.gdtf')).toBe('Robe@Spiider@2020')
  })

  it('makes a type the show can carry: within every bound a saved rig is held to', () => {
    const { type } = typeOf(description([{ name: 'Standard', channels: [PAN_16, SHUTTER, DIMMER_24, RED_LEGACY] }]))
    expect(lightingRefusal({ ...defaultLightingSettings(), types: [type] })).toBeNull()
  })
})

describe('what a fixture here cannot be, refused with a sentence', () => {
  const refused = (xml: string): string => {
    const result = read(xml)
    if (result.ok) throw new Error('it was imported')
    return result.error
  }

  it('refuses a mode spread over several DMX breaks', () => {
    expect(refused(description([{ name: 'Split', channels: [RED_LEGACY, { ...SHUTTER, offset: '1', dmxBreak: '2' }] }]))).toBe(
      'mode Split is spread over 2 DMX breaks — parts of the fixture addressed separately — and a fixture here is patched at one address: patch each part as a fixture of its own'
    )
  })

  it('refuses a channel that overwrites another break', () => {
    expect(refused(description([{ name: 'Over', channels: [{ ...RED_LEGACY, dmxBreak: 'Overwrite' }] }]))).toBe(
      'mode Over has a channel that overwrites another DMX break, which is not read'
    )
  })

  it('refuses a slot past the universe, two channels on one slot, and a mode with nothing on DMX', () => {
    expect(refused(description([{ name: 'Far', channels: [{ ...RED_LEGACY, offset: '600' }] }]))).toBe(
      'mode Far has a channel at offset “600”, which is not a slot from 1 to 512'
    )
    expect(refused(description([{ name: 'Clash', channels: [RED_LEGACY, { ...SHUTTER, offset: '7' }] }]))).toBe(
      'mode Clash puts ColorAdd_R and Shutter1 on slot 7'
    )
    expect(refused(description([{ name: 'Empty', channels: [VIRTUAL] }]))).toBe('mode Empty has no DMX channels')
  })

  it('refuses a description with no modes, two modes of one name, or that is not GDTF at all', () => {
    expect(refused(description([]))).toBe('that fixture has no DMX modes')
    expect(refused(description([{ name: 'A', channels: [RED_LEGACY] }, { name: 'A', channels: [RED_LEGACY] }]))).toBe(
      'two of its modes are called A'
    )
    expect(refused('<FixtureDefinition/>')).toBe('its description is not a GDTF document')
    expect(refused('<GDTF DataVersion="1.2"/>')).toBe('its description has no FixtureType')
  })
})

describe('a .gdtf file on disk', () => {
  let directory: string
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'feat-ship-gdtf-'))
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  it('is read from its description.xml, past the models and wheels beside it', async () => {
    const file = join(directory, 'Test@Spot.gdtf')
    await writeZip(file, [
      { name: 'models/3ds/Base.3ds', data: Buffer.alloc(2048, 7) },
      { name: 'wheels/gobo1.png', data: Buffer.alloc(512, 1) },
      { name: 'description.xml', data: Buffer.from(description([{ name: 'Standard', channels: [PAN_16, SHUTTER] }])) }
    ])
    const result = await importGdtfFile(file, gdtfFallbackName(file))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.type.modes[0].params.map(param => param.label)).toEqual(['P', 'Sh1'])
  })

  it('refuses an archive with no description, a file that is not a zip, and one that is gone', async () => {
    const noDescription = join(directory, 'empty.gdtf')
    await writeZip(noDescription, [{ name: 'thumbnail.png', data: Buffer.alloc(8) }])
    expect(await importGdtfFile(noDescription)).toEqual({
      ok: false,
      error: 'that archive has no description.xml, so it is not a GDTF file'
    })
    const notZip = join(directory, 'fixture.gdtf')
    writeFileSync(notZip, description([{ name: 'M', channels: [RED_LEGACY] }]))
    expect(await importGdtfFile(notZip)).toEqual({ ok: false, error: 'that file is not a zip archive, so it is not a GDTF file' })
    expect(await importGdtfFile(join(directory, 'gone.gdtf'))).toEqual({
      ok: false,
      error: 'that file could not be opened: it has moved, or this machine will not let it be read'
    })
  })

  it('refuses a description that declares entities, before reading any of them', async () => {
    const file = join(directory, 'hostile.gdtf')
    await writeZip(file, [{ name: 'description.xml', data: Buffer.from('<?xml version="1.0"?><!DOCTYPE GDTF [<!ENTITY x SYSTEM "file:///etc/passwd">]><GDTF>&x;</GDTF>') }])
    expect(await importGdtfFile(file)).toEqual({ ok: false, error: 'its XML carries a document type declaration, which is not read' })
  })

  it('takes a request that names the file by its full path, and nothing else', () => {
    expect(readGdtfRequest({ path: join(directory, 'x.gdtf') })).toEqual({ path: join(directory, 'x.gdtf') })
    for (const payload of [null, {}, { path: 'relative.gdtf' }, { path: 7 }, { path: '' }]) {
      expect(() => readGdtfRequest(payload)).toThrow('a GDTF import names the file by its full path')
    }
  })
})
