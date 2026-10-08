// The packet encoders against examples worked by hand from the documents: every octet of the
// header is written out below with the field it is, so a test that fails names the field
// that moved, and the expected bytes are not the encoder's own output read back.
import { describe, expect, it } from 'vitest'
import {
  cidFromUuid,
  decodeArtDmx,
  decodeArtPollReply,
  decodeSacnData,
  encodeArtDmx,
  encodeArtPoll,
  encodeArtPollReply,
  encodeArtSync,
  encodeSacnData,
  encodeSacnSync,
  pollReplyPortAddresses,
  SACN_OPTION_TERMINATED
} from './packets'

const CID = Buffer.from([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10
])

function hex(bytes: Uint8Array): string[] {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0'))
}

describe('the sACN data packet (E1.31 §4.1)', () => {
  const slots = new Uint8Array(512)
  slots[0] = 255
  slots[1] = 128
  slots[511] = 1
  const packet = encodeSacnData({
    cid: CID,
    sourceName: 'Cuerunner',
    priority: 100,
    syncAddress: 0,
    sequence: 7,
    options: 0,
    universe: 1,
    slots
  })

  it('is 638 octets for a full universe', () => {
    expect(packet.length).toBe(638)
  })

  it('carries the root layer: preamble, the ACN identifier, its length, the vector and the CID', () => {
    expect(hex(packet.subarray(0, 38))).toEqual([
      // Preamble Size, Post-amble Size
      '00', '10', '00', '00',
      // ACN Packet Identifier: "ASC-E1.17" + three nulls
      '41', '53', '43', '2d', '45', '31', '2e', '31', '37', '00', '00', '00',
      // Flags 0x7 and length 622 (638 − 16)
      '72', '6e',
      // VECTOR_ROOT_E131_DATA
      '00', '00', '00', '04',
      // CID
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '0a', '0b', '0c', '0d', '0e', '0f', '10'
    ])
  })

  it('carries the framing layer: length, vector, source name, priority, sync, sequence, options, universe', () => {
    expect(hex(packet.subarray(38, 44))).toEqual([
      // Flags and length 600 (638 − 38)
      '72', '58',
      // VECTOR_E131_DATA_PACKET
      '00', '00', '00', '02'
    ])
    // Source Name: "Cuerunner", null-padded to 64.
    const name = packet.subarray(44, 108)
    expect(name.subarray(0, 9).toString('utf8')).toBe('Cuerunner')
    expect([...name.subarray(9)].every(byte => byte === 0)).toBe(true)
    expect(hex(packet.subarray(108, 115))).toEqual([
      // Priority 100
      '64',
      // Synchronization Address 0 — not synchronised
      '00', '00',
      // Sequence Number
      '07',
      // Options
      '00',
      // Universe 1
      '00', '01'
    ])
  })

  it('carries the DMP layer: length, set-property vector, address and data type, the counts, START code', () => {
    expect(hex(packet.subarray(115, 126))).toEqual([
      // Flags and length 523 (638 − 115)
      '72', '0b',
      // VECTOR_DMP_SET_PROPERTY
      '02',
      // Address Type & Data Type
      'a1',
      // First Property Address
      '00', '00',
      // Address Increment
      '00', '01',
      // Property value count: 513 (START code + 512 slots)
      '02', '01',
      // START Code
      '00'
    ])
  })

  it('carries the slots after the START code', () => {
    expect(packet[126]).toBe(255)
    expect(packet[127]).toBe(128)
    expect(packet[637]).toBe(1)
  })

  it('shrinks with a short universe, and every length follows', () => {
    const short = encodeSacnData({
      cid: CID, sourceName: 'x', priority: 200, syncAddress: 63999, sequence: 255,
      options: SACN_OPTION_TERMINATED, universe: 63999, slots: new Uint8Array([9, 8, 7])
    })
    expect(short.length).toBe(129)
    // Root 113 (0x71), framing 91 (0x5b), DMP 14 (0x0e), property count 4.
    expect(hex(short.subarray(16, 18))).toEqual(['70', '71'])
    expect(hex(short.subarray(38, 40))).toEqual(['70', '5b'])
    expect(hex(short.subarray(115, 117))).toEqual(['70', '0e'])
    expect(hex(short.subarray(123, 125))).toEqual(['00', '04'])
    // Priority 200, sync 63999 (0xf9ff), sequence 255, Stream_Terminated, universe 63999.
    expect(hex(short.subarray(108, 115))).toEqual(['c8', 'f9', 'ff', 'ff', '40', 'f9', 'ff'])
    expect([...short.subarray(126)]).toEqual([9, 8, 7])
  })

  it('cuts a long source name on a character so the field stays null-terminated', () => {
    const long = encodeSacnData({
      cid: CID, sourceName: 'é'.repeat(40), priority: 100, syncAddress: 0, sequence: 0,
      options: 0, universe: 1, slots: new Uint8Array(1)
    })
    const name = long.subarray(44, 108)
    expect(name[63]).toBe(0)
    expect(name.subarray(0, name.indexOf(0)).toString('utf8')).toBe('é'.repeat(31))
  })

  it('reads back what it wrote, and refuses what is not a data packet', () => {
    const read = decodeSacnData(packet)
    expect(read).toMatchObject({ sourceName: 'Cuerunner', priority: 100, sequence: 7, universe: 1 })
    expect(read?.cid).toBe('0102030405060708090a0b0c0d0e0f10')
    expect(read?.slots.length).toBe(512)
    expect(read?.slots[1]).toBe(128)
    // A non-zero START code is not levels.
    const startCode = Buffer.from(packet)
    startCode[125] = 0xdd
    expect(decodeSacnData(startCode)).toBeNull()
    // A length that disagrees with the size.
    expect(decodeSacnData(packet.subarray(0, 600))).toBeNull()
    // A sync packet is not a data packet.
    expect(decodeSacnData(encodeSacnSync({ cid: CID, sequence: 1, syncAddress: 7 }))).toBeNull()
  })

  it('takes a CID from a UUID', () => {
    expect(cidFromUuid('01020304-0506-0708-090a-0b0c0d0e0f10').equals(CID)).toBe(true)
    expect(() => cidFromUuid('not-a-uuid')).toThrow()
  })
})

describe('the sACN universe synchronisation packet (E1.31 §4.2)', () => {
  it('is the 49 octets the table lays out', () => {
    const packet = encodeSacnSync({ cid: CID, sequence: 3, syncAddress: 7962 })
    expect(packet.length).toBe(49)
    expect(hex(packet)).toEqual([
      '00', '10', '00', '00',
      '41', '53', '43', '2d', '45', '31', '2e', '31', '37', '00', '00', '00',
      // Flags and length 33 (49 − 16)
      '70', '21',
      // VECTOR_ROOT_E131_EXTENDED
      '00', '00', '00', '08',
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '0a', '0b', '0c', '0d', '0e', '0f', '10',
      // Flags and length 11 (49 − 38)
      '70', '0b',
      // VECTOR_E131_EXTENDED_SYNCHRONIZATION
      '00', '00', '00', '01',
      // Sequence Number
      '03',
      // Synchronization Address 7962 = 0x1f1a
      '1f', '1a',
      // Reserved
      '00', '00'
    ])
  })
})

describe('ArtDmx (Art-Net 4)', () => {
  it('carries the ID, the OpCode low byte first, the revision, sequence, physical, SubUni, Net and length', () => {
    const slots = new Uint8Array(512)
    slots[0] = 10
    slots[511] = 20
    // Port-Address 0x1234 & 0x7fff: Net 0x12, SubNet 3, Universe 4.
    const packet = encodeArtDmx({ sequence: 42, physical: 0, portAddress: 0x1234, slots })
    expect(packet.length).toBe(530)
    expect(hex(packet.subarray(0, 18))).toEqual([
      // "Art-Net" + null
      '41', '72', '74', '2d', '4e', '65', '74', '00',
      // OpDmx 0x5000, low byte first
      '00', '50',
      // ProtVerHi, ProtVerLo: 14
      '00', '0e',
      // Sequence
      '2a',
      // Physical
      '00',
      // SubUni: SubNet 3, Universe 4
      '34',
      // Net
      '12',
      // LengthHi, Length: 512
      '02', '00'
    ])
    expect(packet[18]).toBe(10)
    expect(packet[529]).toBe(20)
  })

  it('pads an odd frame to an even length, and never sends fewer than two slots', () => {
    expect(encodeArtDmx({ sequence: 1, physical: 0, portAddress: 0, slots: new Uint8Array([5, 6, 7]) }).length).toBe(22)
    const one = encodeArtDmx({ sequence: 1, physical: 0, portAddress: 0, slots: new Uint8Array([5]) })
    expect(hex(one.subarray(16))).toEqual(['00', '02', '05', '00'])
  })

  it('reads back the Port-Address and the slots', () => {
    const packet = encodeArtDmx({ sequence: 9, physical: 1, portAddress: 0x7fff, slots: new Uint8Array([1, 2]) })
    expect(decodeArtDmx(packet)).toEqual({ sequence: 9, portAddress: 0x7fff, slots: new Uint8Array([1, 2]) })
    expect(decodeArtDmx(encodeArtPoll())).toBeNull()
  })
})

describe('ArtPoll, ArtSync and ArtPollReply (Art-Net 4)', () => {
  it('polls with the 22 octets Art-Net 4 lays out and every flag clear', () => {
    expect(hex(encodeArtPoll())).toEqual([
      '41', '72', '74', '2d', '4e', '65', '74', '00',
      // OpPoll 0x2000, low byte first
      '00', '20',
      '00', '0e',
      // Flags, DiagPriority
      '00', '00',
      // TargetPortAddressTop, TargetPortAddressBottom
      '00', '00', '00', '00',
      // EstaMan, Oem
      '00', '00', '00', '00'
    ])
  })

  it('syncs with the 14 octets of an ArtSync', () => {
    expect(hex(encodeArtSync())).toEqual([
      '41', '72', '74', '2d', '4e', '65', '74', '00',
      // OpSync 0x5200, low byte first
      '00', '52',
      '00', '0e',
      // Aux1, Aux2
      '00', '00'
    ])
  })

  it('reads a node’s reply: where it is, what it is called, and the universes its outputs are on', () => {
    const reply = encodeArtPollReply({
      address: '2.0.0.17',
      shortName: 'Stage node',
      longName: 'Four port node, stage left',
      net: 1,
      subnet: 2,
      swOut: [0, 1, 2, 3],
      mac: '00:1b:66:aa:bb:cc',
      bindIndex: 1
    })
    expect(reply.length).toBe(239)
    // The port field is 6454 = 0x1936, low byte first.
    expect(hex(reply.subarray(14, 16))).toEqual(['36', '19'])
    const read = decodeArtPollReply(reply)
    expect(read).toMatchObject({
      address: '2.0.0.17',
      shortName: 'Stage node',
      longName: 'Four port node, stage left',
      net: 1,
      subnet: 2,
      ports: 4,
      mac: '00:1b:66:aa:bb:cc',
      bindIndex: 1
    })
    expect(pollReplyPortAddresses(read!)).toEqual({ outputs: [0x120, 0x121, 0x122, 0x123], inputs: [] })
    expect(decodeArtPollReply(reply.subarray(0, 100))).toBeNull()
    expect(decodeArtPollReply(encodeArtSync())).toBeNull()
  })
})
