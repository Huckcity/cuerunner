// The bytes of the two DMX-over-IP protocols, written from their published documents:
// ANSI E1.31-2018 (Streaming ACN, "sACN") for the data and universe synchronisation packets,
// and Art-Net 4 (Artistic Licence, document revision 1.4dl) for ArtDmx, ArtPoll,
// ArtPollReply and ArtSync. Nothing here opens a socket: these are pure functions from values
// to a Buffer and back, so the tests hold every octet against a hand-computed example.
//
// Multi-byte fields are big-endian ("network byte order") in E1.31 and in most of Art-Net —
// the exceptions are Art-Net's OpCode and the ArtPollReply port, which the Art-Net document
// specifies low byte first, and the ESTA manufacturer code in ArtPollReply. Each of those is
// written where it is, with the spec's own name beside it.

import { DMX_LIMITS } from '../../shared/dmx'

// ─── sACN (E1.31) ─────────────────────────────────────────────────────────────

/** The root layer's ACN Packet Identifier: "ASC-E1.17" and three nulls (E1.31 §5.3). */
const ACN_PACKET_IDENTIFIER = Buffer.from([
  0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00
])

const VECTOR_ROOT_E131_DATA = 0x00000004
const VECTOR_ROOT_E131_EXTENDED = 0x00000008
const VECTOR_E131_DATA_PACKET = 0x00000002
const VECTOR_E131_EXTENDED_SYNCHRONIZATION = 0x00000001
const VECTOR_DMP_SET_PROPERTY = 0x02

/** The framing layer's option bits (E1.31 §6.2.6). */
export const SACN_OPTION_PREVIEW = 0x80
export const SACN_OPTION_TERMINATED = 0x40
export const SACN_OPTION_FORCE_SYNC = 0x20

/** A data packet carrying a full universe is 638 octets: 126 of header and 512 of slots. */
export const SACN_DATA_HEADER = 126
export const SACN_SYNC_LENGTH = 49

/** Flags (0x7) in the top nibble and the PDU's length in the low twelve bits (E1.31 §5.4, §6.2). */
function flagsAndLength(length: number): number {
  return 0x7000 | (length & 0x0fff)
}

export interface SacnDataFields {
  /** The source's 16-byte component identifier, stable for this machine. */
  cid: Buffer
  /** Up to 63 octets of UTF-8; the field is 64, null-terminated. */
  sourceName: string
  /** 0–200; 100 is the default every receiver assumes. */
  priority: number
  /** The universe the frames are released by, or 0 for no synchronisation. */
  syncAddress: number
  /** 0–255, per universe, wrapping. */
  sequence: number
  options: number
  /** 1–63999. */
  universe: number
  /** The slot values; 1 to 512 of them, START code 0 is written in front. */
  slots: Uint8Array
}

/** The source name field: UTF-8, cut on a character boundary so it stays null-terminated in 64. */
function sourceNameBytes(name: string): Buffer {
  const field = Buffer.alloc(64)
  let bytes = Buffer.from(name, 'utf8')
  while (bytes.length > 63) {
    name = name.slice(0, -1)
    bytes = Buffer.from(name, 'utf8')
  }
  bytes.copy(field, 0)
  return field
}

/** An E1.31 data packet (§4.1, Table 4-1). */
export function encodeSacnData(fields: SacnDataFields): Buffer {
  const slotCount = fields.slots.length
  if (slotCount < 1 || slotCount > DMX_LIMITS.slots) throw new RangeError('an sACN packet carries 1 to 512 slots')
  if (fields.cid.length !== 16) throw new RangeError('a CID is 16 octets')
  const length = SACN_DATA_HEADER + slotCount
  const packet = Buffer.alloc(length)
  // Root layer.
  packet.writeUInt16BE(0x0010, 0) // Preamble Size
  packet.writeUInt16BE(0x0000, 2) // Post-amble Size
  ACN_PACKET_IDENTIFIER.copy(packet, 4)
  packet.writeUInt16BE(flagsAndLength(length - 16), 16)
  packet.writeUInt32BE(VECTOR_ROOT_E131_DATA, 18)
  fields.cid.copy(packet, 22)
  // Framing layer.
  packet.writeUInt16BE(flagsAndLength(length - 38), 38)
  packet.writeUInt32BE(VECTOR_E131_DATA_PACKET, 40)
  sourceNameBytes(fields.sourceName).copy(packet, 44)
  packet.writeUInt8(fields.priority & 0xff, 108)
  packet.writeUInt16BE(fields.syncAddress & 0xffff, 109)
  packet.writeUInt8(fields.sequence & 0xff, 111)
  packet.writeUInt8(fields.options & 0xff, 112)
  packet.writeUInt16BE(fields.universe & 0xffff, 113)
  // DMP layer.
  packet.writeUInt16BE(flagsAndLength(length - 115), 115)
  packet.writeUInt8(VECTOR_DMP_SET_PROPERTY, 117)
  packet.writeUInt8(0xa1, 118) // Address Type & Data Type
  packet.writeUInt16BE(0x0000, 119) // First Property Address
  packet.writeUInt16BE(0x0001, 121) // Address Increment
  packet.writeUInt16BE(slotCount + 1, 123) // Property value count: START code + slots
  packet.writeUInt8(0x00, 125) // DMX512-A START Code
  Buffer.from(fields.slots.buffer, fields.slots.byteOffset, slotCount).copy(packet, SACN_DATA_HEADER)
  return packet
}

/** An E1.31 universe synchronisation packet (§4.2, Table 4-2). */
export function encodeSacnSync(fields: { cid: Buffer; sequence: number; syncAddress: number }): Buffer {
  if (fields.cid.length !== 16) throw new RangeError('a CID is 16 octets')
  const packet = Buffer.alloc(SACN_SYNC_LENGTH)
  packet.writeUInt16BE(0x0010, 0)
  packet.writeUInt16BE(0x0000, 2)
  ACN_PACKET_IDENTIFIER.copy(packet, 4)
  packet.writeUInt16BE(flagsAndLength(SACN_SYNC_LENGTH - 16), 16)
  packet.writeUInt32BE(VECTOR_ROOT_E131_EXTENDED, 18)
  fields.cid.copy(packet, 22)
  packet.writeUInt16BE(flagsAndLength(SACN_SYNC_LENGTH - 38), 38)
  packet.writeUInt32BE(VECTOR_E131_EXTENDED_SYNCHRONIZATION, 40)
  packet.writeUInt8(fields.sequence & 0xff, 44)
  packet.writeUInt16BE(fields.syncAddress & 0xffff, 45)
  // Octets 47–48 are reserved and transmitted as zero.
  return packet
}

/** A data packet as a receiver reads it. */
export interface SacnDataPacket {
  cid: string
  sourceName: string
  priority: number
  syncAddress: number
  sequence: number
  options: number
  universe: number
  slots: Uint8Array
}

/**
 * Reads an E1.31 data packet, or null for anything else: a sync or discovery packet, a packet
 * from another ACN protocol, a non-zero START code (§6.2.6 says those are not DMX levels and a
 * receiver ignores them for level data), or one whose lengths do not agree with its size.
 */
export function decodeSacnData(packet: Buffer): SacnDataPacket | null {
  if (packet.length < SACN_DATA_HEADER || packet.length > SACN_DATA_HEADER + DMX_LIMITS.slots) return null
  if (packet.readUInt16BE(0) !== 0x0010 || packet.readUInt16BE(2) !== 0x0000) return null
  if (!packet.subarray(4, 16).equals(ACN_PACKET_IDENTIFIER)) return null
  if (packet.readUInt32BE(18) !== VECTOR_ROOT_E131_DATA) return null
  if (packet.readUInt32BE(40) !== VECTOR_E131_DATA_PACKET) return null
  if (packet.readUInt8(117) !== VECTOR_DMP_SET_PROPERTY || packet.readUInt8(118) !== 0xa1) return null
  if ((packet.readUInt16BE(16) & 0x0fff) !== packet.length - 16) return null
  const count = packet.readUInt16BE(123)
  if (count < 1 || count - 1 !== packet.length - SACN_DATA_HEADER) return null
  if (packet.readUInt8(125) !== 0x00) return null
  const nameField = packet.subarray(44, 108)
  const end = nameField.indexOf(0)
  return {
    cid: packet.subarray(22, 38).toString('hex'),
    sourceName: nameField.subarray(0, end < 0 ? 64 : end).toString('utf8'),
    priority: packet.readUInt8(108),
    syncAddress: packet.readUInt16BE(109),
    sequence: packet.readUInt8(111),
    options: packet.readUInt8(112),
    universe: packet.readUInt16BE(113),
    slots: new Uint8Array(packet.subarray(SACN_DATA_HEADER))
  }
}

/** A UUID string as the 16 octets of a CID. */
export function cidFromUuid(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new RangeError('a CID is a UUID')
  return Buffer.from(hex, 'hex')
}

// ─── Art-Net 4 ────────────────────────────────────────────────────────────────

/** Every Art-Net packet opens with "Art-Net" and a null. */
const ARTNET_ID = Buffer.from([0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00])
/** Protocol revision 14, high byte first. */
const ARTNET_PROTOCOL_VERSION = 14

export const OP_POLL = 0x2000
export const OP_POLL_REPLY = 0x2100
export const OP_DMX = 0x5000
export const OP_SYNC = 0x5200

function artnetHeader(length: number, opcode: number): Buffer {
  const packet = Buffer.alloc(length)
  ARTNET_ID.copy(packet, 0)
  packet.writeUInt16LE(opcode, 8) // OpCode, low byte first
  return packet
}

/** An ArtDmx packet. `portAddress` is the 15-bit Net:SubNet:Universe. */
export function encodeArtDmx(fields: {
  sequence: number
  physical: number
  portAddress: number
  slots: Uint8Array
}): Buffer {
  // The data length must be even and from 2 to 512; an odd frame is padded with a zero.
  const slotCount = fields.slots.length
  if (slotCount < 1 || slotCount > DMX_LIMITS.slots) throw new RangeError('an ArtDmx packet carries 1 to 512 slots')
  const length = Math.max(2, slotCount + (slotCount % 2))
  const packet = artnetHeader(18 + length, OP_DMX)
  packet.writeUInt16BE(ARTNET_PROTOCOL_VERSION, 10) // ProtVerHi, ProtVerLo
  packet.writeUInt8(fields.sequence & 0xff, 12)
  packet.writeUInt8(fields.physical & 0xff, 13)
  packet.writeUInt8(fields.portAddress & 0xff, 14) // SubUni: subnet and universe
  packet.writeUInt8((fields.portAddress >> 8) & 0x7f, 15) // Net
  packet.writeUInt16BE(length, 16) // LengthHi, Length
  Buffer.from(fields.slots.buffer, fields.slots.byteOffset, slotCount).copy(packet, 18)
  return packet
}

/** An ArtDmx packet as a receiver reads it, or null for anything else. */
export function decodeArtDmx(packet: Buffer): { sequence: number; portAddress: number; slots: Uint8Array } | null {
  if (packet.length < 20 || !packet.subarray(0, 8).equals(ARTNET_ID)) return null
  if (packet.readUInt16LE(8) !== OP_DMX) return null
  const length = packet.readUInt16BE(16)
  if (length < 2 || length > DMX_LIMITS.slots || packet.length < 18 + length) return null
  return {
    sequence: packet.readUInt8(12),
    portAddress: ((packet.readUInt8(15) & 0x7f) << 8) | packet.readUInt8(14),
    slots: new Uint8Array(packet.subarray(18, 18 + length))
  }
}

/**
 * An ArtPoll (Art-Net 4, 22 octets). Flags 0: reply to this poll only, no diagnostics, and
 * no targeted mode, so every node on the network answers.
 */
export function encodeArtPoll(): Buffer {
  const packet = artnetHeader(22, OP_POLL)
  packet.writeUInt16BE(ARTNET_PROTOCOL_VERSION, 10)
  // Flags, DiagPriority, the two target Port-Addresses, EstaMan and Oem are all zero.
  return packet
}

/** An ArtSync: the frames already sent are output now (Art-Net 4, 14 octets). */
export function encodeArtSync(): Buffer {
  const packet = artnetHeader(14, OP_SYNC)
  packet.writeUInt16BE(ARTNET_PROTOCOL_VERSION, 10)
  // Aux1 and Aux2 are transmitted as zero.
  return packet
}

/** The shortest ArtPollReply an Art-Net 3 or 4 node sends: everything up to Style and the MAC. */
const POLL_REPLY_MIN = 207

/** Reads an ArtPollReply, or null for anything else. */
export function decodeArtPollReply(packet: Buffer): {
  address: string
  shortName: string
  longName: string
  net: number
  subnet: number
  ports: number
  swIn: number[]
  swOut: number[]
  portTypes: number[]
  mac: string
  bindIndex: number
} | null {
  if (packet.length < POLL_REPLY_MIN || !packet.subarray(0, 8).equals(ARTNET_ID)) return null
  if (packet.readUInt16LE(8) !== OP_POLL_REPLY) return null
  const cString = (start: number, size: number): string => {
    const field = packet.subarray(start, start + size)
    const end = field.indexOf(0)
    return field.subarray(0, end < 0 ? size : end).toString('latin1')
  }
  const ports = Math.min(4, packet.readUInt16BE(172))
  const bytes = (start: number): number[] => [...packet.subarray(start, start + 4)]
  return {
    address: [...packet.subarray(10, 14)].join('.'),
    shortName: cString(26, 18),
    longName: cString(44, 64),
    net: packet.readUInt8(18) & 0x7f,
    subnet: packet.readUInt8(19) & 0x0f,
    ports,
    portTypes: bytes(174),
    swIn: bytes(186),
    swOut: bytes(190),
    mac: [...packet.subarray(201, 207)].map(byte => byte.toString(16).padStart(2, '0')).join(':'),
    bindIndex: packet.length > 211 ? packet.readUInt8(211) : 0
  }
}

/**
 * The Port-Addresses an ArtPollReply's ports carry: Net, SubNet and the low nibble of each
 * port's switch. Port types say which direction each port is: bit 7 output, bit 6 input.
 */
export function pollReplyPortAddresses(reply: NonNullable<ReturnType<typeof decodeArtPollReply>>): {
  outputs: number[]
  inputs: number[]
} {
  const outputs: number[] = []
  const inputs: number[] = []
  for (let port = 0; port < reply.ports; port++) {
    const base = (reply.net << 8) | (reply.subnet << 4)
    const type = reply.portTypes[port] ?? 0
    if ((type & 0x80) !== 0) outputs.push(base | (reply.swOut[port] & 0x0f))
    if ((type & 0x40) !== 0) inputs.push(base | (reply.swIn[port] & 0x0f))
  }
  return { outputs, inputs }
}

/**
 * An ArtPollReply, built the way a node builds one: for the tests' fake node, and nothing else
 * in the app sends one.
 */
export function encodeArtPollReply(fields: {
  address: string
  shortName: string
  longName: string
  net: number
  subnet: number
  swOut: number[]
  mac: string
  bindIndex?: number
}): Buffer {
  const packet = artnetHeader(239, OP_POLL_REPLY)
  fields.address.split('.').forEach((part, at) => packet.writeUInt8(Number(part) & 0xff, 10 + at))
  packet.writeUInt16LE(0x1936, 14) // Port, low byte first
  packet.writeUInt8(fields.net & 0x7f, 18)
  packet.writeUInt8(fields.subnet & 0x0f, 19)
  packet.write(fields.shortName.slice(0, 17), 26, 'latin1')
  packet.write(fields.longName.slice(0, 63), 44, 'latin1')
  packet.writeUInt16BE(fields.swOut.length, 172)
  fields.swOut.forEach((sw, at) => {
    packet.writeUInt8(0x80, 174 + at) // an output port of DMX512
    packet.writeUInt8(sw & 0x0f, 190 + at)
  })
  fields.mac.split(':').forEach((part, at) => packet.writeUInt8(parseInt(part, 16) & 0xff, 201 + at))
  packet.writeUInt8(fields.bindIndex ?? 0, 211)
  return packet
}
