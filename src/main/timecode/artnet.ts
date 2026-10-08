/**
 * ArtTimeCode: timecode over Art-Net, which is how a lighting network carries the clock
 * between consoles and media servers without a MIDI cable or an audio line to every rack.
 *
 * One UDP datagram a frame, on the Art-Net port: the eight-byte `Art-Net\0` id, OpCode
 * 0x9700 (sent low byte first), protocol version 14, a filler, the stream id, then frames,
 * seconds, minutes, hours and the rate type — 0 film (24), 1 EBU (25), 2 drop-frame
 * (29.97) and 3 SMPTE (30). Nineteen bytes, nothing to negotiate.
 */
import { rateCode, rateFromCode, type Timecode, type TimecodeRate } from '../../shared/timecode'

const ART_NET_ID = [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00]
export const OP_TIMECODE = 0x9700
export const ART_TIMECODE_LENGTH = 19

export function encodeArtTimecode(tc: Timecode, rate: TimecodeRate, streamId = 0): Buffer {
  const packet = Buffer.alloc(ART_TIMECODE_LENGTH)
  ART_NET_ID.forEach((byte, i) => (packet[i] = byte))
  packet[8] = OP_TIMECODE & 0xff
  packet[9] = OP_TIMECODE >> 8
  packet[10] = 0
  packet[11] = 14
  packet[12] = 0
  packet[13] = streamId & 0xff
  packet[14] = tc.frames
  packet[15] = tc.seconds
  packet[16] = tc.minutes
  packet[17] = tc.hours
  packet[18] = rateCode(rate)
  return packet
}

/** The position a datagram carries, or null for any other Art-Net packet or none at all. */
export function decodeArtTimecode(packet: Uint8Array): { tc: Timecode; rate: TimecodeRate; streamId: number } | null {
  if (packet.length < ART_TIMECODE_LENGTH) return null
  for (let i = 0; i < ART_NET_ID.length; i++) if (packet[i] !== ART_NET_ID[i]) return null
  const opcode = packet[8] | (packet[9] << 8)
  if (opcode !== OP_TIMECODE) return null
  const tc = { frames: packet[14], seconds: packet[15], minutes: packet[16], hours: packet[17] }
  const rate = rateFromCode(packet[18])
  if (tc.hours > 23 || tc.minutes > 59 || tc.seconds > 59 || tc.frames > 29) return null
  return { tc, rate, streamId: packet[13] }
}
