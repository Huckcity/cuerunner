import { describe, expect, it } from 'vitest'
import { OscStreamError, SlipDecoder, decodeOscMessage, encodeOscMessage, slipEncode } from './oscStream'

describe('SLIP framing', () => {
  it('escapes END and ESC inside a packet, and reads them back', () => {
    const packet = Uint8Array.from([1, 0xc0, 2, 0xdb, 3])
    const framed = slipEncode(packet)
    expect([...framed]).toEqual([0xc0, 1, 0xdb, 0xdc, 2, 0xdb, 0xdd, 3, 0xc0])
    expect(new SlipDecoder(64).push(framed).map(frame => [...frame])).toEqual([[...packet]])
  })

  it('reads packets split across chunks, and several in one chunk', () => {
    const decoder = new SlipDecoder(64)
    const one = slipEncode(Uint8Array.from([1, 2]))
    const two = slipEncode(Uint8Array.from([3]))
    expect(decoder.push(one.subarray(0, 2))).toEqual([])
    expect(decoder.push(Buffer.concat([one.subarray(2), two])).map(frame => [...frame])).toEqual([[1, 2], [3]])
  })

  it('refuses a frame past its limit rather than growing for ever', () => {
    const decoder = new SlipDecoder(4)
    expect(() => decoder.push(Uint8Array.from([0xc0, 1, 2, 3, 4, 5]))).toThrow(OscStreamError)
  })

  it('refuses an escape SLIP does not define', () => {
    expect(() => new SlipDecoder(8).push(Uint8Array.from([0xdb, 0x01]))).toThrow(/escaped/)
  })
})

describe('OSC messages', () => {
  it('encodes and decodes strings, integers and floats', () => {
    const decoded = decodeOscMessage(encodeOscMessage('/workspace/x/connect', ['1234', 7, 0.5]))
    expect(decoded).toEqual({ address: '/workspace/x/connect', args: ['1234', 7, 0.5] })
  })

  it('decodes an address with no arguments', () => {
    expect(decodeOscMessage(encodeOscMessage('/workspaces'))).toEqual({ address: '/workspaces', args: [] })
  })

  it('refuses a bundle, a packet that is not a message, and an argument past the end', () => {
    expect(() => decodeOscMessage(encodeOscMessage('#bundle'))).toThrow(/bundle/)
    expect(() => decodeOscMessage(Buffer.from('nope\0\0\0\0'))).toThrow(/not an OSC message/)
    const cut = encodeOscMessage('/a', [5]).subarray(0, 10)
    expect(() => decodeOscMessage(cut)).toThrow(/runs past/)
  })
})
