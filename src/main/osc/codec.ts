// OSC 1.0 on the wire, read and written here rather than by a library's server.
//
// The listener owns its own UDP socket (see `OscInputService`), so the bytes are this module's
// to read. Everything a reader allocates is bounded before it is allocated: a datagram is at
// most 64 KiB, a bundle may hold bundles only so deep, a packet only so many messages and a
// message only so many arguments, and a string or a blob may not claim more bytes than the
// datagram has. A packet past any bound is refused whole, the way a packet that is not OSC at
// all is — the listener reports either once and keeps listening.
//
// The type tags are kept: an int32 arrives as `i` and a float32 as `f`, rather than being
// guessed back from the JavaScript number the way a decoder that drops the tags has to.
//
// Written from the OSC 1.0 specification (opensoundcontrol.org): an OSC-string is ASCII
// padded with NULs to a multiple of four bytes, numbers are big-endian, a bundle is
// `#bundle\0`, an eight-byte time tag, and size-prefixed elements.

import type { OscArg } from '../../shared/cue'

/** How deep bundles may nest inside one another before the packet is refused. */
export const MAX_BUNDLE_DEPTH = 8
/** How many messages one packet may carry, bundles and all. */
export const MAX_MESSAGES_PER_PACKET = 256
/** How many arguments one message may carry. */
export const MAX_ARGS_PER_MESSAGE = 128

/** One message as the show reads it: where it is addressed, and what it carries. */
export interface DecodedMessage {
  address: string
  args: OscArg[]
}

/** A packet that is not OSC, or is OSC past one of the bounds above. */
export class OscDecodeError extends Error {}

const BUNDLE_TAG = '#bundle'

/** Reads one OSC-string at `offset`: its text, and where the next field begins. */
function readString(buffer: Buffer, offset: number): { value: string; next: number } {
  if (offset >= buffer.length) throw new OscDecodeError('a string runs past the end of the packet')
  const end = buffer.indexOf(0, offset)
  if (end === -1) throw new OscDecodeError('a string is not terminated')
  const value = buffer.toString('utf8', offset, end)
  // The terminator and the padding to the next four-byte boundary. A sender that leaves the
  // padding off the last string of a packet is still understood: nothing follows it.
  const next = Math.min((end + 4) & ~3, buffer.length)
  return { value, next }
}

function need(buffer: Buffer, offset: number, bytes: number): void {
  if (offset + bytes > buffer.length) throw new OscDecodeError('an argument runs past the end of the packet')
}

/** One message's arguments, read off its type tags. Arrays are read flat, in order. */
function readArgs(buffer: Buffer, tags: string, start: number): OscArg[] {
  const args: OscArg[] = []
  let offset = start
  for (const tag of tags) {
    if (args.length >= MAX_ARGS_PER_MESSAGE) throw new OscDecodeError(`more than ${MAX_ARGS_PER_MESSAGE} arguments`)
    switch (tag) {
      case 'i':
        need(buffer, offset, 4)
        args.push({ type: 'i', value: buffer.readInt32BE(offset) })
        offset += 4
        break
      case 'f':
        need(buffer, offset, 4)
        args.push({ type: 'f', value: buffer.readFloatBE(offset) })
        offset += 4
        break
      case 'd':
        // A double is a float to the show: the cue model has one floating type.
        need(buffer, offset, 8)
        args.push({ type: 'f', value: buffer.readDoubleBE(offset) })
        offset += 8
        break
      case 'h': {
        need(buffer, offset, 8)
        args.push({ type: 'i', value: Number(buffer.readBigInt64BE(offset)) })
        offset += 8
        break
      }
      case 't':
        // A time tag as an argument: seconds since 1900, as a number the panel can show.
        need(buffer, offset, 8)
        args.push({ type: 'f', value: buffer.readUInt32BE(offset) + buffer.readUInt32BE(offset + 4) / 2 ** 32 })
        offset += 8
        break
      case 's':
      case 'S': {
        const text = readString(buffer, offset)
        args.push({ type: 's', value: text.value })
        offset = text.next
        break
      }
      case 'c':
        need(buffer, offset, 4)
        args.push({ type: 's', value: String.fromCharCode(buffer.readUInt32BE(offset) & 0x7f) })
        offset += 4
        break
      case 'r':
      case 'm':
        // A colour and a MIDI message are four bytes the show reads as the number they make.
        need(buffer, offset, 4)
        args.push({ type: 'i', value: buffer.readUInt32BE(offset) })
        offset += 4
        break
      case 'b': {
        need(buffer, offset, 4)
        const size = buffer.readInt32BE(offset)
        if (size < 0) throw new OscDecodeError('a blob with a negative size')
        offset += 4
        need(buffer, offset, size)
        // Blobs have no tag in the cue model; their bytes are more useful than a summary.
        args.push({ type: 's', value: buffer.toString('hex', offset, offset + size) })
        offset += (size + 3) & ~3
        break
      }
      case 'T':
        args.push({ type: 'T', value: true })
        break
      case 'F':
        args.push({ type: 'F', value: false })
        break
      // Nil, impulse and the array brackets carry no bytes and no value.
      case 'N':
      case 'I':
      case '[':
      case ']':
        break
      default:
        throw new OscDecodeError(`an argument of a type OSC does not have (${tag})`)
    }
  }
  return args
}

function readMessage(buffer: Buffer): DecodedMessage {
  const address = readString(buffer, 0)
  if (!address.value.startsWith('/')) throw new OscDecodeError('an address that does not start with /')
  // A message with no type tag string at all is an older sender's message with no arguments.
  if (address.next >= buffer.length) return { address: address.value, args: [] }
  const tags = readString(buffer, address.next)
  if (!tags.value.startsWith(',')) throw new OscDecodeError('a type tag string that does not start with ,')
  return { address: address.value, args: readArgs(buffer, tags.value.slice(1), tags.next) }
}

function readPacket(buffer: Buffer, depth: number, out: DecodedMessage[]): void {
  if (buffer.length === 0) throw new OscDecodeError('an empty packet')
  if (buffer[0] !== 0x23 /* # */) {
    if (out.length >= MAX_MESSAGES_PER_PACKET) throw new OscDecodeError(`more than ${MAX_MESSAGES_PER_PACKET} messages`)
    out.push(readMessage(buffer))
    return
  }
  const tag = readString(buffer, 0)
  if (tag.value !== BUNDLE_TAG) throw new OscDecodeError('an address that does not start with /')
  if (depth >= MAX_BUNDLE_DEPTH) throw new OscDecodeError(`bundles nested more than ${MAX_BUNDLE_DEPTH} deep`)
  // The time tag: the show acts on a bundle when it arrives.
  let offset = tag.next + 8
  if (offset > buffer.length) throw new OscDecodeError('a bundle with no time tag')
  while (offset < buffer.length) {
    need(buffer, offset, 4)
    const size = buffer.readInt32BE(offset)
    offset += 4
    if (size <= 0 || offset + size > buffer.length) throw new OscDecodeError('a bundle element whose size is not its own')
    readPacket(buffer.subarray(offset, offset + size), depth + 1, out)
    offset += size
  }
}

/** Every message a packet carries, in order, however its bundles nest — or a refusal. */
export function decodePacket(buffer: Buffer): DecodedMessage[] {
  const out: DecodedMessage[] = []
  try {
    readPacket(buffer, 0, out)
  } catch (error) {
    if (error instanceof OscDecodeError) throw error
    // A read past the buffer that the checks above missed is still junk, not a fault.
    throw new OscDecodeError(error instanceof Error ? error.message : String(error))
  }
  return out
}

function stringBytes(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  const padded = Buffer.alloc((bytes.length + 4) & ~3)
  bytes.copy(padded)
  return padded
}

/** One message's bytes, for the cue model's argument types. */
export function encodeMessage(address: string, args: readonly OscArg[]): Buffer {
  let tags = ','
  const data: Buffer[] = []
  for (const arg of args) {
    switch (arg.type) {
      case 'i': {
        const word = Buffer.alloc(4)
        word.writeInt32BE(Math.trunc(Number(arg.value)) | 0)
        tags += 'i'
        data.push(word)
        break
      }
      case 'f': {
        const word = Buffer.alloc(4)
        word.writeFloatBE(Number(arg.value))
        tags += 'f'
        data.push(word)
        break
      }
      case 's':
        tags += 's'
        data.push(stringBytes(String(arg.value)))
        break
      case 'T':
        tags += 'T'
        break
      case 'F':
        tags += 'F'
        break
    }
  }
  return Buffer.concat([stringBytes(address), stringBytes(tags), ...data])
}
