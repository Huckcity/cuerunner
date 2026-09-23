// The SQ's native frames, held to the capture rather than to prose.
//
// `integration/fixtures/vendor/sq6-native-apply-2026-09-22.json` is the one measurement of
// this protocol in the repository (an SQ-6 on firmware 1.6.1, 2026-09-22), and it is the
// contract for every byte the codec writes. The cases below read their expectations out of
// it — and, for the frames the story is about, beside it too: a regenerated fixture that
// moved with the code would otherwise leave both saying the same wrong thing.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NATIVE_TCP_PORT,
  assignPair,
  clearPair,
  createFrameReader,
  dcaFlag,
  keepAliveFrame,
  sessionFrames
} from './frames'

interface Exchange {
  at: number
  direction: 'to-desk' | 'from-desk'
  bytes: string
}

interface Capture {
  provenance: { kind: string; target: string; device: string; firmware: string }
  exchanges: Exchange[]
}

const here = dirname(fileURLToPath(import.meta.url))
const capture = JSON.parse(
  readFileSync(join(here, '..', '..', '..', 'integration', 'fixtures', 'vendor', 'sq6-native-apply-2026-09-22.json'), 'utf-8')
) as Capture

/** The capture's own spelling of a frame, which is what every expectation is written in. */
const hex = (bytes: readonly number[] | Uint8Array): string => Buffer.from(bytes).toString('hex')

const writtenByTheClient = capture.exchanges
  .filter(exchange => exchange.direction === 'to-desk')
  .map(exchange => exchange.bytes)

/** The channel and DCA a `1d` frame's own bytes name, in the 1-based numbers a show uses. */
function pairOf(bytes: string): { channel: number; dca: number } {
  return {
    channel: Number.parseInt(bytes.slice(8, 10), 16) + 1,
    dca: Number.parseInt(bytes.slice(10, 12), 16) + 1
  }
}

/**
 * The session as the wire shows it: every frame the client wrote up to and including the
 * `7f 03` that ends the session, read back through the codec's own splitter — because the
 * capture's chunks are what TCP delivered rather than one frame each, and the push's chunk
 * carries more than the frame it opens with.
 */
function sessionFromTheWire(): string[] {
  const reader = createFrameReader()
  const frames: string[] = []
  for (const bytes of writtenByTheClient) {
    for (const frame of reader.push(Buffer.from(bytes, 'hex'))) {
      frames.push(hex(frame))
      if (frame[0] === 0x7f && frame[1] === 0x03) return frames
    }
  }
  throw new Error('the capture holds no `7f 03` frame: the session it opened never closed, and this case reads the session out of it')
}

describe('the capture this codec is written from', () => {
  it('is the desk’s own service on the native port, on an SQ', () => {
    // A capture from the MIDI service, or from another range, would leave every case below
    // comparing the codec against bytes that are not this protocol's.
    expect(capture.provenance.kind).toBe('sq-native')
    expect(capture.provenance.device).toBe('SQ-6')
    expect(capture.provenance.target.endsWith(`:${NATIVE_TCP_PORT}`)).toBe(true)
  })
})

describe('a DCA membership', () => {
  it('places a pair in the frame the capture places it with', () => {
    const placed = writtenByTheClient.filter(bytes => bytes.startsWith('f707071d') && bytes.endsWith('0100'))

    // The show the capture was taken against: inputs 1 and 3 on DCA 1, inputs 8 and 9 on
    // DCA 4. The literals are here as well as in the fixture, so a regenerated capture
    // cannot move the code and its expectation together.
    expect(placed).toEqual([
      'f707071d00000100',
      'f707071d02000100',
      'f707071d07030100',
      'f707071d08030100'
    ])
    for (const bytes of placed) {
      const { channel, dca } = pairOf(bytes)
      expect(hex(assignPair(channel, dca)), `channel ${channel} on DCA ${dca}`).toBe(bytes)
    }
  })

  it('clears a pair with the same frame written `00 00`', () => {
    const cleared = writtenByTheClient.filter(bytes => bytes.startsWith('f707071d') && bytes.endsWith('0000'))

    // The other 124 pairs of the 16-input × 8-DCA matrix, all written as cleared.
    expect(cleared).toHaveLength(124)
    expect(cleared).toContain('f707071d01000000')
    for (const bytes of cleared) {
      const { channel, dca } = pairOf(bytes)
      expect(hex(clearPair(channel, dca)), `channel ${channel} on DCA ${dca}`).toBe(bytes)
    }
    expect(hex(clearPair(2, 1))).toBe('f707071d01000000')
  })

  it('follows the pair with the flag the capture’s own pairing gives', () => {
    const flags = writtenByTheClient.filter(bytes => bytes.startsWith('f707070c'))
    expect(flags).toHaveLength(16)

    // The polarity is the capture's, and it is the reverse of what §6 printed before this
    // story: the four channels the `1d … 01 00` frames place are the four written `00 00`,
    // and the twelve they leave alone are written `01`.
    const riding = flags.filter(bytes => bytes.slice(10) === '000000')
    expect(riding.map(bytes => bytes.slice(8, 10))).toEqual(['00', '02', '07', '08'])
    expect(hex(dcaFlag(1, true))).toBe('f707070c00000000')
    expect(hex(dcaFlag(2, false))).toBe('f707070c01000100')

    for (const bytes of flags) {
      const channel = Number.parseInt(bytes.slice(8, 10), 16) + 1
      expect(hex(dcaFlag(channel, bytes.slice(10) === '000000')), `channel ${channel}`).toBe(bytes)
    }
  })
})

describe('the session', () => {
  it('is exactly what the wire shows, in the wire’s own order', () => {
    // §6's prose lists the settle before the push; the wire puts `7f 0b 02` first and adds a
    // `7f 0d` after the push that the prose never named. The capture is the contract.
    expect(sessionFromTheWire()).toEqual(sessionFrames().map(hex))
  })

  it('pushes the capture’s own layout, whole', () => {
    const push = sessionFrames().find(frame => frame[0] === 0x7f && frame[1] === 0x0a)
    if (push === undefined) throw new Error('the session writes no `7f 0a` layout push')

    // The frame is the header plus the 8192 bytes the measured client pushed: the stand-in
    // the gate decided on, until the show model has a layout of its own (Story 11.3).
    expect(push).toHaveLength(8198)
    const chunk = capture.exchanges.find(exchange => exchange.bytes.startsWith('7f0a00200000'))
    if (chunk === undefined) throw new Error('the capture holds no `7f 0a` layout push to compare against')
    expect(hex(push)).toBe(chunk.bytes.slice(0, 8198 * 2))
  })

  it('keeps the session alive in the eight-byte family’s own width', () => {
    // §6's cadence, and the width the family measures: eight bytes, `f7 05` and a zero
    // payload. What the desk makes of the body is not measured, so nothing is invented in it.
    expect(keepAliveFrame()).toEqual([0xf7, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
  })
})

describe('the reader', () => {
  it('holds a frame that arrives in two reads, both families', () => {
    const reader = createFrameReader()
    const push = capture.exchanges.find(exchange => exchange.direction === 'from-desk' && exchange.bytes.startsWith('7f08'))
    if (push === undefined) throw new Error('the capture holds no `7f 08` push to split')
    const bytes = Buffer.from(push.bytes, 'hex')

    expect(reader.push(bytes.subarray(0, 9))).toEqual([])
    expect(reader.push(bytes.subarray(9)).map(hex)).toEqual([push.bytes])

    // The eight-byte family has no length to read, so what it is split across is all the
    // more its own: five bytes and then three.
    const eight = capture.exchanges.find(exchange => exchange.direction === 'from-desk' && exchange.bytes.startsWith('f7'))
    if (eight === undefined) throw new Error('the capture holds no `f7` frame from the desk')
    const split = Buffer.from(eight.bytes, 'hex')
    const held = createFrameReader()
    expect(held.push(split.subarray(0, 5))).toEqual([])
    expect(held.push(split.subarray(5)).map(hex)).toEqual([eight.bytes])
  })

  it('hands out every frame a read carried, and crosses what a length did not account for', () => {
    const reader = createFrameReader()
    // A chunk the capture holds with several `7f 08` pushes in it: one read is not one frame.
    const shared = capture.exchanges.find(exchange => exchange.bytes.startsWith('7f080e') && exchange.bytes.length > 60)
    if (shared === undefined) throw new Error('the capture holds no chunk carrying more than one frame')
    const carried = reader.push(Buffer.from(shared.bytes, 'hex')).map(hex)
    expect(carried.length).toBeGreaterThan(1)
    expect(carried.join('')).toBe(shared.bytes)
    for (const frame of carried) expect(frame.startsWith('7f080e')).toBe(true)

    // And the chunk the push arrived in: the frame declares 8192 bytes, the read carries
    // more, and the frame after the run is still a frame.
    const withPush = capture.exchanges.find(exchange => exchange.bytes.startsWith('7f0a00200000'))
    if (withPush === undefined) throw new Error('the capture holds no layout-push chunk')
    const frames = createFrameReader().push(Buffer.from(withPush.bytes, 'hex'))
    expect(frames.map(hex)).toEqual([withPush.bytes.slice(0, 8198 * 2), '7f0d00000000'])
  })

  it('reads the desk’s own eight-byte pushes as frames', () => {
    const reader = createFrameReader()
    const push = capture.exchanges.find(exchange => exchange.direction === 'from-desk' && exchange.bytes.startsWith('f7'))
    if (push === undefined) throw new Error('the capture holds no `f7` frame from the desk')
    expect(push.bytes).toHaveLength(16)
    expect(reader.push(Buffer.from(push.bytes, 'hex')).map(hex)).toEqual([push.bytes])
  })

  it('steps over bytes that cannot open a frame, and gives up on a claim past the ceiling', () => {
    const reader = createFrameReader()
    expect(reader.push(Buffer.from('00000000f707071d00000100', 'hex')).map(hex)).toEqual(['f707071d00000100'])

    // A `7f` whose declared payload is far past any frame this protocol carries: the stream
    // has lost its place rather than found a long message, and the next real frame is still
    // found.
    const lost = Buffer.concat([
      Buffer.from([0x7f, 0x0e, 0xff, 0xff, 0xff, 0x7f]),
      Buffer.from('f707070c00000000', 'hex')
    ])
    expect(createFrameReader().push(lost).map(hex)).toEqual(['f707070c00000000'])
  })
})
