// The packet side of the presence service, held entirely in its hands: every response
// here is built out of literal bytes rather than by the encoder under test, so a
// passing parse says something about the parser and nothing about itself.
import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { buildPtrQuery, decodeName, parseDnsRecords, presenceDevices } from './mdns'

const TYPE_A = 1
const TYPE_PTR = 12
const TYPE_TXT = 16
const TYPE_SRV = 33
const CLASS_IN = 1

const SERVICE = '_netaudio-arc._udp.local'
const INSTANCE = `Amp 1.${SERVICE}`

function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16BE(value)
  return bytes
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(value)
  return bytes
}

/** A compression pointer to an earlier offset in the same packet. */
function pointer(offset: number): Buffer {
  const high = 0xc0 | (offset >> 8)
  const low = offset & 0xff
  return Buffer.from([high, low])
}

/** A name as one length-prefixed label, e.g. "0x03 foo". */
function label(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  return Buffer.concat([Buffer.from([bytes.length]), bytes])
}

/** A name as length-prefixed labels with the root label that ends it. */
function name(text: string): Buffer {
  const labels = text
    .split('.')
    .filter(part => part.length > 0)
    .map(label)
  return Buffer.concat([...labels, Buffer.from([0x00])])
}

function record(owner: Buffer, type: number, ttl: number, data: Buffer): Buffer {
  return Buffer.concat([owner, u16(type), u16(CLASS_IN), u32(ttl), u16(data.length), data])
}

function packet(questions: number, answers: number, additional: number, records: Buffer[]): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(0x8400, 2)
  header.writeUInt16BE(questions, 4)
  header.writeUInt16BE(answers, 6)
  header.writeUInt16BE(additional, 10)
  return Buffer.concat([header, ...records])
}

interface Announcement {
  service?: string
  instance?: string
  host?: string
  address?: [number, number, number, number]
  txt?: string[]
}

/**
 * A browse answer shaped the way a responder really sends one: the PTR names the
 * instance in full, and the SRV, TXT and A records that follow point back at it with
 * compression pointers.
 */
function announcement(options: Announcement = {}): Buffer {
  const service = options.service ?? SERVICE
  const host = options.host ?? 'amp1.local'
  const address = options.address ?? [10, 0, 0, 7]
  const txt = options.txt ?? ['device-name=Amp 1', 'apiver=1', 'noequals', 'empty=']

  const serviceName = name(service)
  const instanceName = label(options.instance ?? 'Amp 1')

  const ptrData = Buffer.concat([instanceName, serviceName])
  const ptr = record(serviceName, TYPE_PTR, 3600, ptrData)
  // The instance starts at the front of the PTR rdata, after the name, type, class,
  // TTL and rdlength the header carries.
  const instanceAt = 12 + serviceName.length + 10

  const srvData = Buffer.concat([u16(0), u16(0), u16(5000), name(host)])
  const srv = record(pointer(instanceAt), TYPE_SRV, 120, srvData)
  const srvAt = 12 + ptr.length
  const hostAt = srvAt + 2 + 10 + 6

  const txtData = Buffer.concat(txt.map(entry => label(entry)))
  const txtRecord = record(pointer(instanceAt), TYPE_TXT, 4500, txtData)
  const a = record(pointer(hostAt), TYPE_A, 120, Buffer.from(address))

  return packet(0, 2, 2, [ptr, srv, txtRecord, a])
}

describe('buildPtrQuery', () => {
  it('writes the browse query for one service byte for byte', () => {
    expect([...buildPtrQuery(SERVICE)]).toEqual([
      // id 0, standard query, one question, no other sections
      0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      // "_netaudio-arc._udp.local"
      0x0d, 0x5f, 0x6e, 0x65, 0x74, 0x61, 0x75, 0x64, 0x69, 0x6f, 0x2d, 0x61, 0x72, 0x63,
      0x04, 0x5f, 0x75, 0x64, 0x70,
      0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c,
      0x00,
      // QTYPE PTR, QCLASS IN
      0x00, 0x0c, 0x00, 0x01
    ])
  })
})

describe('decodeName', () => {
  it('reads labels and reports where the name ends', () => {
    // "foo" followed by the root label
    const literal = Buffer.from([0x03, 0x66, 0x6f, 0x6f, 0x00])

    expect(decodeName(literal, 0)).toEqual({ name: 'foo', next: 5 })
  })

  it('follows a compression pointer and still reports the end of the name itself', () => {
    const literal = Buffer.from([
      // "foo" at 0, then a pointer at 5 back to it, then another name after the pointer
      0x03, 0x66, 0x6f, 0x6f, 0x00, 0xc0, 0x00, 0x03, 0x62, 0x61, 0x72, 0x00
    ])

    expect(decodeName(literal, 5)).toEqual({ name: 'foo', next: 7 })
    // The bytes after the pointer are the next name, untouched by the one before it.
    expect(decodeName(literal, 7)).toEqual({ name: 'bar', next: 12 })
  })

  it('terminates on a pointer that points at itself', () => {
    const literal = Buffer.from([0xc0, 0x00])

    expect(decodeName(literal, 0).name).toBe('')
  })

  it('terminates on two pointers that point at each other', () => {
    const literal = Buffer.from([0xc0, 0x02, 0xc0, 0x00])

    expect(decodeName(literal, 0)).toEqual({ name: '', next: 2 })
  })

  it('stops at a truncated name rather than reading past the packet', () => {
    const literal = Buffer.from([0x03, 0x66, 0x6f])

    expect(decodeName(literal, 0).name).toBe('')
  })
})

describe('parseDnsRecords', () => {
  it('reads the answer and additional sections, following compressed names', () => {
    const records = parseDnsRecords(announcement())

    expect(records.map(entry => entry.type)).toEqual([TYPE_PTR, TYPE_SRV, TYPE_TXT, TYPE_A])
    expect(records[0]).toMatchObject({ name: SERVICE, ttl: 3600 })
    // The SRV and TXT names are pointers back at the instance spelled out by the PTR.
    expect(records[1].name).toBe(INSTANCE)
    expect(records[2].name).toBe(INSTANCE)
    // The A record points at the SRV target.
    expect(records[3].name).toBe('amp1.local')
    expect(records[3].ttl).toBe(120)
    expect(records[0].data).toEqual(Buffer.concat([label('Amp 1'), name(SERVICE)]))
    expect([...records[1].data]).toEqual([
      0x00, 0x00, 0x00, 0x00, 0x13, 0x88,
      0x04, 0x61, 0x6d, 0x70, 0x31,
      0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c,
      0x00
    ])
    expect(records[3].data).toEqual(Buffer.from([10, 0, 0, 7]))
  })

  it('skips the question section and reads what answers it', () => {
    const question = Buffer.concat([name('_http._tcp.local'), u16(TYPE_PTR), u16(CLASS_IN)])
    const answer = record(pointer(12), TYPE_A, 60, Buffer.from([192, 168, 1, 5]))
    const response = packet(1, 1, 0, [question, answer])

    expect(parseDnsRecords(response)).toEqual([
      { name: '_http._tcp.local', type: TYPE_A, ttl: 60, data: Buffer.from([192, 168, 1, 5]) }
    ])
  })

  it('returns the whole records before a packet that stops mid-record', () => {
    const full = announcement()

    // Cut inside the A record's rdata: only the three complete records are readable.
    expect(parseDnsRecords(full.subarray(0, full.length - 2))).toHaveLength(3)
    // Cut inside the SRV rdata: only the PTR survives.
    expect(parseDnsRecords(full.subarray(0, 100))).toHaveLength(1)
    // Nothing that even carries a header.
    expect(parseDnsRecords(full.subarray(0, 8))).toEqual([])
    expect(parseDnsRecords(Buffer.alloc(0))).toEqual([])
  })

  it('does not throw on a packet made of noise', () => {
    expect(() => parseDnsRecords(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).not.toThrow()
  })
})

describe('presenceDevices', () => {
  it('resolves pointers, service and text into one device', () => {
    expect(presenceDevices(parseDnsRecords(announcement()))).toEqual([
      {
        id: INSTANCE,
        name: 'Amp 1',
        host: 'amp1.local',
        address: '10.0.0.7',
        port: 5000,
        txt: { 'device-name': 'Amp 1', apiver: '1', noequals: '', empty: '' }
      }
    ])
  })

  it('keeps the id of an instance that announces itself again', () => {
    const first = presenceDevices(parseDnsRecords(announcement()))[0]
    const again = presenceDevices(
      parseDnsRecords(announcement({ address: [10, 0, 0, 8], txt: ['device-name=Amp 1'] }))
    )[0]

    expect(first.id).toBe(INSTANCE)
    expect(again.id).toBe(first.id)
    expect(again.address).toBe('10.0.0.8')
    expect(again.txt).toEqual({ 'device-name': 'Amp 1' })
  })

  it('leaves a device its address records have not arrived for unresolved', () => {
    const ptrData = Buffer.concat([label('Amp 1'), name(SERVICE)])
    const only = packet(0, 1, 0, [record(name(SERVICE), TYPE_PTR, 3600, ptrData)])

    expect(presenceDevices(parseDnsRecords(only))).toEqual([
      { id: INSTANCE, name: 'Amp 1', host: '', address: '', port: 0, txt: {} }
    ])
  })

  it('makes no device from records that name no instance', () => {
    const srvData = Buffer.concat([u16(0), u16(0), u16(5000), name('amp1.local')])
    const orphan = packet(0, 1, 1, [
      record(name(INSTANCE), TYPE_SRV, 120, srvData),
      record(name('amp1.local'), TYPE_A, 120, Buffer.from([10, 0, 0, 7]))
    ])

    expect(presenceDevices(parseDnsRecords(orphan))).toEqual([])
  })

  it('resolves an SRV target that is itself a compression pointer', () => {
    const serviceName = name(SERVICE)
    const instanceAt = 12 + serviceName.length + 10
    const ptr = record(serviceName, TYPE_PTR, 3600, Buffer.concat([label('Amp 1'), serviceName]))
    // The A record comes first, and the SRV target points back at its name.
    const aAt = 12 + ptr.length
    const a = record(name('amp1.local'), TYPE_A, 120, Buffer.from([10, 0, 0, 9]))
    const srvData = Buffer.concat([u16(0), u16(0), u16(5000), pointer(aAt)])
    const srv = record(pointer(instanceAt), TYPE_SRV, 120, srvData)
    const response = packet(0, 2, 1, [ptr, a, srv])

    const parsed = parseDnsRecords(response)

    expect(parsed[2].data).toEqual(Buffer.concat([u16(0), u16(0), u16(5000), pointer(aAt)]))
    expect(presenceDevices(parsed)).toEqual([
      { id: INSTANCE, name: 'Amp 1', host: 'amp1.local', address: '10.0.0.9', port: 5000, txt: {} }
    ])
  })
})
