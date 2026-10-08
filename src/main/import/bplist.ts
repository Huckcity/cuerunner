// Apple's binary property list, read from bytes.
//
// A QLab workspace is one of these: the `bplist00` container Apple's own frameworks write,
// with an object table at the front, an offset table after it, and a 32-byte trailer at the
// end that says where everything is. The layout is Apple's published one (the comments in
// CoreFoundation's CFBinaryPList.c are the specification), and nothing in this file knows
// QLab exists — the archive on top of it is `keyedArchive.ts`, and what QLab put inside
// that is `qlabFile.ts`.
//
// Every read is bounded before it is made. The trailer's sizes are checked against the
// file's own length before the offset table is read, every object's length is checked
// against the end of the object table before its bytes are touched, a container's count is
// checked against the bytes that could hold its references, and an object is decoded once
// however many times it is referred to. A file that lies about any of it is refused with a
// sentence (`PlistError`) rather than read past its end or allocated for.

const MAGIC = 'bplist00'
const TRAILER_BYTES = 32

/** How deep containers may nest. A cue tree is a few levels of cue inside array inside cue. */
const MAX_DEPTH = 256

/** A reference into an NSKeyedArchiver's object table: the plist's own UID type. */
export class PlistUid {
  constructor(readonly index: number) {}
}

/** A dictionary, as read: keys in file order, values decoded. */
export type PlistDict = { [key: string]: PlistValue }

export type PlistValue =
  | null
  | boolean
  | number
  | string
  | Date
  | Uint8Array
  | PlistUid
  | PlistValue[]
  | PlistDict

/** A file that is not a binary plist, or one whose bytes contradict themselves. */
export class PlistError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlistError'
  }
}

/** Seconds between the Unix epoch and Apple's reference date, 2001-01-01T00:00:00Z. */
const APPLE_EPOCH_SECONDS = 978307200

/** Whether the bytes begin the way a binary plist does. Cheap enough to ask before reading. */
export function isBinaryPlist(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) return false
  }
  return true
}

/** Decodes a whole binary plist and returns its top object. */
export function parseBinaryPlist(input: Uint8Array): PlistValue {
  const bytes = input
  if (!isBinaryPlist(bytes)) throw new PlistError('it does not start the way a binary property list does')
  if (bytes.length < MAGIC.length + TRAILER_BYTES + 1) throw new PlistError('it is too short to hold a property list')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const trailer = bytes.length - TRAILER_BYTES
  const offsetSize = bytes[trailer + 6]
  const refSize = bytes[trailer + 7]
  const objectCount = readUnsigned(view, trailer + 8, 8)
  const topObject = readUnsigned(view, trailer + 16, 8)
  const offsetTable = readUnsigned(view, trailer + 24, 8)

  if (offsetSize < 1 || offsetSize > 8 || refSize < 1 || refSize > 8) {
    throw new PlistError('its trailer gives sizes no property list uses')
  }
  if (objectCount < 1 || topObject >= objectCount) throw new PlistError('its trailer names an object it does not hold')
  // The offset table sits between the objects and the trailer, and has to fit there.
  if (offsetTable < MAGIC.length || offsetTable + objectCount * offsetSize > trailer) {
    throw new PlistError('its offset table runs past the end of the file')
  }

  const offsets: number[] = new Array(objectCount)
  for (let i = 0; i < objectCount; i++) {
    const offset = readUnsigned(view, offsetTable + i * offsetSize, offsetSize)
    if (offset < MAGIC.length || offset >= offsetTable) throw new PlistError('an object sits outside the object table')
    offsets[i] = offset
  }

  const decoded = new Map<number, PlistValue>()
  const decoding = new Set<number>()
  // Everything an object may occupy ends where the offset table begins.
  const end = offsetTable

  const need = (at: number, length: number): void => {
    if (length < 0 || at + length > end) throw new PlistError('an object runs past the end of the object table')
  }

  /** The length after a marker: the low nibble, or the integer object that follows a 0xF. */
  const lengthAt = (at: number, info: number): { length: number; next: number } => {
    if (info !== 0x0f) return { length: info, next: at + 1 }
    need(at + 1, 1)
    const marker = bytes[at + 1]
    if (marker >> 4 !== 0x1) throw new PlistError('a length is not written as an integer')
    const size = 1 << (marker & 0x0f)
    if (size > 8) throw new PlistError('a length is wider than a property list writes')
    need(at + 2, size)
    return { length: readUnsigned(view, at + 2, size), next: at + 2 + size }
  }

  const refsAt = (at: number, count: number): number[] => {
    need(at, count * refSize)
    const refs: number[] = new Array(count)
    for (let i = 0; i < count; i++) {
      const ref = readUnsigned(view, at + i * refSize, refSize)
      if (ref >= objectCount) throw new PlistError('a container refers to an object the file does not hold')
      refs[i] = ref
    }
    return refs
  }

  const object = (index: number, depth: number): PlistValue => {
    const done = decoded.get(index)
    if (done !== undefined) return done
    // A reference back to an object still being decoded is a loop no writer produces.
    if (decoding.has(index)) throw new PlistError('its objects refer to each other in a loop')
    if (depth > MAX_DEPTH) throw new PlistError('its containers nest deeper than a workspace does')
    decoding.add(index)
    const value = decode(offsets[index], depth)
    decoding.delete(index)
    decoded.set(index, value)
    return value
  }

  const decode = (at: number, depth: number): PlistValue => {
    need(at, 1)
    const marker = bytes[at]
    const type = marker >> 4
    const info = marker & 0x0f
    switch (type) {
      case 0x0:
        if (info === 0x8) return false
        if (info === 0x9) return true
        // 0x0 is null and 0xF is the fill byte; neither carries a value.
        if (info === 0x0 || info === 0xf) return null
        throw new PlistError('it holds a marker no property list writes')
      case 0x1: {
        const size = 1 << info
        if (size > 16) throw new PlistError('an integer is wider than a property list writes')
        need(at + 1, size)
        // Sixteen-byte integers carry an unsigned 64-bit value in their low half.
        if (size === 16) return readSigned(view, at + 9, 8)
        return size === 8 ? readSigned(view, at + 1, 8) : readUnsigned(view, at + 1, size)
      }
      case 0x2: {
        const size = 1 << info
        need(at + 1, size)
        if (size === 4) return view.getFloat32(at + 1)
        if (size === 8) return view.getFloat64(at + 1)
        throw new PlistError('a real number is a size no property list writes')
      }
      case 0x3:
        if (info !== 0x3) throw new PlistError('a date is a size no property list writes')
        need(at + 1, 8)
        return new Date((view.getFloat64(at + 1) + APPLE_EPOCH_SECONDS) * 1000)
      case 0x4: {
        const { length, next } = lengthAt(at, info)
        need(next, length)
        return bytes.slice(next, next + length)
      }
      case 0x5: {
        const { length, next } = lengthAt(at, info)
        need(next, length)
        return Buffer.from(bytes.buffer, bytes.byteOffset + next, length).toString('latin1')
      }
      case 0x6: {
        const { length, next } = lengthAt(at, info)
        need(next, length * 2)
        // UTF-16 big-endian, swapped into the little-endian order Node decodes.
        const swapped = Buffer.alloc(length * 2)
        for (let i = 0; i < length; i++) {
          swapped[i * 2] = bytes[next + i * 2 + 1]
          swapped[i * 2 + 1] = bytes[next + i * 2]
        }
        return swapped.toString('utf16le')
      }
      case 0x7: {
        const { length, next } = lengthAt(at, info)
        need(next, length)
        return Buffer.from(bytes.buffer, bytes.byteOffset + next, length).toString('utf8')
      }
      case 0x8: {
        const size = info + 1
        need(at + 1, size)
        return new PlistUid(readUnsigned(view, at + 1, size))
      }
      case 0xa:
      case 0xb:
      case 0xc: {
        // An array, an ordered set and a set all read as a list.
        const { length, next } = lengthAt(at, info)
        return refsAt(next, length).map(ref => object(ref, depth + 1))
      }
      case 0xd: {
        const { length, next } = lengthAt(at, info)
        const keys = refsAt(next, length)
        const values = refsAt(next + length * refSize, length)
        const dict: PlistDict = Object.create(null) as PlistDict
        for (let i = 0; i < length; i++) {
          const key = object(keys[i], depth + 1)
          dict[typeof key === 'string' ? key : String(key)] = object(values[i], depth + 1)
        }
        return dict
      }
      default:
        throw new PlistError('it holds a marker no property list writes')
    }
  }

  return object(topObject, 0)
}

function readUnsigned(view: DataView, at: number, size: number): number {
  if (at + size > view.byteLength) throw new PlistError('a number runs past the end of the file')
  let value = 0
  for (let i = 0; i < size; i++) value = value * 256 + view.getUint8(at + i)
  if (!Number.isSafeInteger(value)) throw new PlistError('a number is larger than this reader can hold')
  return value
}

function readSigned(view: DataView, at: number, size: 8): number {
  if (at + size > view.byteLength) throw new PlistError('a number runs past the end of the file')
  const value = view.getBigInt64(at)
  // Outside the safe range the value is a label rather than a quantity; it is clamped so
  // that it stays a number and nothing downstream reads a wrong value as exact.
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER
  if (value < BigInt(Number.MIN_SAFE_INTEGER)) return Number.MIN_SAFE_INTEGER
  return Number(value)
}

/**
 * Whether a value is bytes. Asked of the view rather than the class, because a Buffer
 * made by Node's own internals and a `Uint8Array` made here can come from different
 * realms (a test environment, a worker) and `instanceof` then says no to real bytes.
 */
export function isBytes(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && !(value instanceof DataView)
}
