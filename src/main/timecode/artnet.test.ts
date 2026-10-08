import { describe, expect, it } from 'vitest'
import { decodeArtTimecode, encodeArtTimecode } from './artnet'
import { TIMECODE_RATES, framesToTimecode, parseTimecodeFrames } from '../../shared/timecode'

describe('ArtTimeCode', () => {
  it('round-trips a position at every rate', () => {
    for (const rate of TIMECODE_RATES) {
      const tc = framesToTimecode(parseTimecodeFrames('12:34:56:07', rate)!, rate)
      const packet = encodeArtTimecode(tc, rate, 3)
      expect(packet).toHaveLength(19)
      expect(packet.subarray(0, 8).toString('latin1')).toBe('Art-Net\0')
      // OpCode low byte first, then protocol version 14.
      expect([...packet.subarray(8, 12)]).toEqual([0x00, 0x97, 0x00, 14])
      const decoded = decodeArtTimecode(packet)!
      expect(decoded.tc).toEqual(tc)
      expect(decoded.rate).toBe(rate === '29.97' ? '30' : rate)
      expect(decoded.streamId).toBe(3)
    }
  })

  it('ignores every other packet', () => {
    const dmx = Buffer.from(encodeArtTimecode({ hours: 0, minutes: 0, seconds: 0, frames: 0 }, '25'))
    dmx[9] = 0x50 // ArtDmx
    expect(decodeArtTimecode(dmx)).toBeNull()
    expect(decodeArtTimecode(Buffer.from('hello'))).toBeNull()
    const nonsense = encodeArtTimecode({ hours: 0, minutes: 0, seconds: 0, frames: 0 }, '25')
    nonsense[17] = 40
    expect(decodeArtTimecode(nonsense)).toBeNull()
  })
})
