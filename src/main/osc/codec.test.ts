// The listener reads OSC with a decoder of its own: the wire's type tags kept, and every bound
// held before anything is allocated — a packet past one is refused whole, like junk.
import { describe, it, expect } from 'vitest'
import { decodePacket, encodeMessage, MAX_ARGS_PER_MESSAGE, MAX_BUNDLE_DEPTH, MAX_MESSAGES_PER_PACKET, OscDecodeError } from './codec'

function bundle(...elements: Buffer[]): Buffer {
  const head = Buffer.alloc(16)
  head.write('#bundle', 0, 'ascii')
  return Buffer.concat([head, ...elements.flatMap(element => {
    const size = Buffer.alloc(4)
    size.writeInt32BE(element.length)
    return [size, element]
  })])
}

/** One OSC-string, padded the way the spec writes it. */
function str(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  const out = Buffer.alloc((bytes.length + 4) & ~3)
  bytes.copy(out)
  return out
}

describe('the OSC codec', () => {
  it('round-trips every type the cue model writes, tags and all', () => {
    const args = [
      { type: 'i' as const, value: -7 },
      { type: 'f' as const, value: 0.5 },
      { type: 'f' as const, value: 2 },
      { type: 's' as const, value: 'warm wash' },
      { type: 'T' as const, value: true },
      { type: 'F' as const, value: false }
    ]
    expect(decodePacket(encodeMessage('/lx/go', args))).toEqual([{ address: '/lx/go', args }])
  })

  it('pads every string to four bytes, as the spec writes it', () => {
    const packet = encodeMessage('/abc', [{ type: 's', value: 'abcd' }])
    expect(packet.length % 4).toBe(0)
    // "/abc" + NUL + 3 pad, ",s" + NUL + pad, "abcd" + NUL + 3 pad
    expect(packet.length).toBe(8 + 4 + 8)
  })

  it('reads the types other senders use: doubles, int64, symbols, blobs, chars, nil and arrays', () => {
    const double = Buffer.alloc(8); double.writeDoubleBE(1.25)
    const big = Buffer.alloc(8); big.writeBigInt64BE(42n)
    const blobSize = Buffer.alloc(4); blobSize.writeInt32BE(3)
    const blob = Buffer.from([0xde, 0xad, 0xbe, 0x00])
    const char = Buffer.alloc(4); char.writeUInt32BE(0x41)
    const packet = Buffer.concat([str('/x'), str(',dhSbcN[i]'), double, big, str('sym'), blobSize, blob, char, Buffer.from([0, 0, 0, 9])])
    expect(decodePacket(packet)[0].args).toEqual([
      { type: 'f', value: 1.25 },
      { type: 'i', value: 42 },
      { type: 's', value: 'sym' },
      { type: 's', value: 'deadbe' },
      { type: 's', value: 'A' },
      { type: 'i', value: 9 }
    ])
  })

  it('reads an older sender’s message that carries no type tag string', () => {
    expect(decodePacket(str('/go'))).toEqual([{ address: '/go', args: [] }])
  })

  it('reads a bundle’s messages in order, bundles inside bundles included', () => {
    const packet = bundle(encodeMessage('/a', []), bundle(bundle(encodeMessage('/deep', [])), encodeMessage('/b', [])))
    expect(decodePacket(packet).map(message => message.address)).toEqual(['/a', '/deep', '/b'])
  })

  it('refuses what is not OSC', () => {
    for (const junk of [
      Buffer.from('hello'),
      Buffer.alloc(0),
      str('no-slash'),
      Buffer.concat([str('/a'), str('i')]),
      Buffer.concat([str('/a'), str(',i')]),
      Buffer.concat([str('/a'), str(',q')]),
      Buffer.concat([str('/a'), str(',b'), Buffer.from([0, 0, 1, 0])])
    ]) {
      expect(() => decodePacket(junk), junk.toString('hex')).toThrow(OscDecodeError)
    }
  })

  it('refuses a bundle whose element claims more bytes than it has', () => {
    const head = bundle(encodeMessage('/a', []))
    head.writeInt32BE(4096, 16)
    expect(() => decodePacket(head)).toThrow(OscDecodeError)
  })

  it('refuses bundles nested past its bound rather than recursing without one', () => {
    let packet = encodeMessage('/deep', [])
    for (let level = 0; level <= MAX_BUNDLE_DEPTH; level++) packet = bundle(packet)
    expect(() => decodePacket(packet)).toThrow(/nested/)
    let within = encodeMessage('/deep', [])
    for (let level = 0; level < MAX_BUNDLE_DEPTH; level++) within = bundle(within)
    expect(decodePacket(within)).toHaveLength(1)
  })

  it('refuses a packet with more messages, or a message with more arguments, than it reads', () => {
    const many = bundle(...Array.from({ length: MAX_MESSAGES_PER_PACKET + 1 }, () => encodeMessage('/m', [])))
    expect(() => decodePacket(many)).toThrow(/messages/)
    const args = Array.from({ length: MAX_ARGS_PER_MESSAGE + 1 }, () => ({ type: 'T' as const, value: true }))
    expect(() => decodePacket(encodeMessage('/m', args))).toThrow(/arguments/)
  })
})
