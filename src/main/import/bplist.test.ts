import { describe, expect, it } from 'vitest'
import { PlistError, PlistUid, isBinaryPlist, parseBinaryPlist } from './bplist'
import { Real, writeBinaryPlist } from './archiveFixture'

/** A plist's bytes with the trailer rewritten, for a file that lies about its own layout. */
function withTrailer(bytes: Buffer, patch: (trailer: Buffer) => void): Buffer {
  const copy = Buffer.from(bytes)
  patch(copy.subarray(copy.length - 32))
  return copy
}

describe('the binary plist reader', () => {
  it('reads every type a plist holds back as it was written', () => {
    const when = new Date('2026-10-08T12:00:00.000Z')
    const value = parseBinaryPlist(writeBinaryPlist({
      nothing: null,
      yes: true,
      no: false,
      small: 7,
      wide: 70000,
      huge: 2 ** 40,
      negative: -12,
      real: 2.5,
      whole: new Real(3),
      when,
      bytes: new Uint8Array([1, 2, 255]),
      ascii: 'Walk-in Music',
      long: 'a string longer than fifteen characters',
      unicode: 'Café — “Act Two”',
      list: [1, 'two', [3]],
      uid: new PlistUid(300)
    }))
    expect(value).toMatchObject({
      nothing: null,
      yes: true,
      no: false,
      small: 7,
      wide: 70000,
      huge: 2 ** 40,
      negative: -12,
      real: 2.5,
      whole: 3,
      ascii: 'Walk-in Music',
      long: 'a string longer than fifteen characters',
      unicode: 'Café — “Act Two”',
      list: [1, 'two', [3]]
    })
    const dict = value as Record<string, unknown>
    expect((dict['when'] as Date).toISOString()).toBe(when.toISOString())
    expect([...(dict['bytes'] as Uint8Array)]).toEqual([1, 2, 255])
    expect(dict['uid']).toBeInstanceOf(PlistUid)
    expect((dict['uid'] as PlistUid).index).toBe(300)
  })

  it('reads a container with more than fifteen entries, whose count follows the marker', () => {
    const many = Array.from({ length: 300 }, (_, i) => i)
    expect(parseBinaryPlist(writeBinaryPlist(many))).toEqual(many)
  })

  it('knows a plist by its first eight bytes', () => {
    expect(isBinaryPlist(writeBinaryPlist({}))).toBe(true)
    expect(isBinaryPlist(Buffer.from('<?xml version="1.0"?>'))).toBe(false)
    expect(isBinaryPlist(Buffer.from('bpl'))).toBe(false)
  })

  it('refuses bytes that are not a binary plist', () => {
    expect(() => parseBinaryPlist(Buffer.from('definitely not a plist at all'))).toThrow(PlistError)
  })

  it('refuses a plist too short to hold its own trailer', () => {
    expect(() => parseBinaryPlist(Buffer.from('bplist00short'))).toThrow(/too short/)
  })

  it('refuses a trailer that gives sizes no plist uses', () => {
    const bytes = withTrailer(writeBinaryPlist({ a: 1 }), trailer => { trailer[6] = 0 })
    expect(() => parseBinaryPlist(bytes)).toThrow(/sizes/)
  })

  it('refuses a trailer whose top object is not among its objects', () => {
    const bytes = withTrailer(writeBinaryPlist({ a: 1 }), trailer => { trailer.writeUInt32BE(9999, 20) })
    expect(() => parseBinaryPlist(bytes)).toThrow(/does not hold/)
  })

  it('refuses an offset table that runs past the end of the file, before reading it', () => {
    const bytes = withTrailer(writeBinaryPlist({ a: 1 }), trailer => { trailer.writeUInt32BE(0x7fffffff, 12) })
    expect(() => parseBinaryPlist(bytes)).toThrow(/offset table/)
  })

  it('refuses an object whose stated length runs past the object table', () => {
    // A string marker that claims fourteen bytes, with three behind it.
    const bytes = writeBinaryPlist('abc')
    bytes[8] = 0x5e
    expect(() => parseBinaryPlist(bytes)).toThrow(/runs past/)
  })

  it('refuses a container that refers to an object the file does not hold', () => {
    const bytes = writeBinaryPlist([1])
    // The array's one reference, rewritten to an index past the end.
    bytes[9] = 0x7f
    expect(() => parseBinaryPlist(bytes)).toThrow(/does not hold/)
  })

  it('refuses containers that refer to each other in a loop', () => {
    const bytes = writeBinaryPlist([[1]])
    // The inner array's reference, pointed back at the outer one.
    bytes[11] = 0x00
    expect(() => parseBinaryPlist(bytes)).toThrow(/loop/)
  })

  it('refuses a marker no plist writes', () => {
    const bytes = writeBinaryPlist('a')
    bytes[8] = 0x95
    expect(() => parseBinaryPlist(bytes)).toThrow(/marker/)
  })
})
