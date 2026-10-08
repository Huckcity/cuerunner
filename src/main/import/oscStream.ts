// OSC over a TCP stream, the way QLab speaks it: SLIP-framed packets (OSC 1.1), each one
// an OSC message.
//
// UDP carries one OSC packet per datagram; a stream has to say where one packet ends. OSC
// 1.1 says it with SLIP (RFC 1055): a packet is sent between END bytes, with any END or ESC
// byte inside it escaped. QLab sends an END before a packet as well as after it, so empty
// frames are expected and skipped.
//
// The encoder writes the types the import sends — strings, integers and floats — and the
// decoder reads every type a QLab reply uses. Both are small enough to own rather than
// borrow, and the decoder is bounded: a frame past the limit is refused before it is
// buffered further, and a message is read only as far as its own bytes go.

const END = 0xc0
const ESC = 0xdb
const ESC_END = 0xdc
const ESC_ESC = 0xdd

export type OscValue = string | number | boolean | null | Uint8Array

export interface OscMessage {
  address: string
  args: OscValue[]
}

/** A stream that broke the framing or the message format. */
export class OscStreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OscStreamError'
  }
}

/** One packet, SLIP-framed for the wire, with the leading END QLab's own sender writes. */
export function slipEncode(packet: Uint8Array): Buffer {
  const out: number[] = [END]
  for (const byte of packet) {
    if (byte === END) out.push(ESC, ESC_END)
    else if (byte === ESC) out.push(ESC, ESC_ESC)
    else out.push(byte)
  }
  out.push(END)
  return Buffer.from(out)
}

/**
 * Collects SLIP frames out of a byte stream. `push` hands back every packet the bytes
 * completed; a frame longer than `maxFrame` throws rather than growing without end.
 */
export class SlipDecoder {
  private frame = Buffer.alloc(1024)
  private length = 0
  private escaped = false

  constructor(private readonly maxFrame: number) {}

  push(chunk: Uint8Array): Uint8Array[] {
    const packets: Uint8Array[] = []
    for (const byte of chunk) {
      if (byte === END) {
        if (this.length > 0) packets.push(Uint8Array.from(this.frame.subarray(0, this.length)))
        this.length = 0
        this.escaped = false
        continue
      }
      let value = byte
      if (this.escaped) {
        this.escaped = false
        if (byte === ESC_END) value = END
        else if (byte === ESC_ESC) value = ESC
        else throw new OscStreamError('the stream escaped a byte SLIP does not escape')
      } else if (byte === ESC) {
        this.escaped = true
        continue
      }
      if (this.length >= this.maxFrame) throw new OscStreamError('a packet is larger than a QLab reply is')
      if (this.length === this.frame.length) {
        // Grown by doubling, to the limit and no further.
        const grown = Buffer.alloc(Math.min(this.frame.length * 2, this.maxFrame))
        this.frame.copy(grown, 0, 0, this.length)
        this.frame = grown
      }
      this.frame[this.length++] = value
    }
    return packets
  }
}

function padded(length: number): number {
  return (length + 4) & ~3
}

function oscString(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  const out = Buffer.alloc(padded(bytes.length))
  bytes.copy(out)
  return out
}

/** An OSC message's bytes. Integers are int32, other numbers float32, strings strings. */
export function encodeOscMessage(address: string, args: Array<string | number> = []): Buffer {
  const tags = ',' + args.map(arg => typeof arg === 'string' ? 's' : Number.isInteger(arg) ? 'i' : 'f').join('')
  const parts: Buffer[] = [oscString(address), oscString(tags)]
  for (const arg of args) {
    if (typeof arg === 'string') {
      parts.push(oscString(arg))
    } else {
      const word = Buffer.alloc(4)
      if (Number.isInteger(arg)) word.writeInt32BE(arg)
      else word.writeFloatBE(arg)
      parts.push(word)
    }
  }
  return Buffer.concat(parts)
}

/** Reads one OSC message. A bundle, or bytes that are not a message, throw. */
export function decodeOscMessage(packet: Uint8Array): OscMessage {
  const bytes = Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength)
  let at = 0
  const readString = (): string => {
    const end = bytes.indexOf(0, at)
    if (end < 0) throw new OscStreamError('a message string has no end')
    const value = bytes.toString('utf8', at, end)
    at = padded(end - at) + at
    if (at > bytes.length) throw new OscStreamError('a message string runs past the packet')
    return value
  }
  const need = (length: number): void => {
    if (at + length > bytes.length) throw new OscStreamError('a message argument runs past the packet')
  }
  const address = readString()
  if (address === '#bundle') throw new OscStreamError('the stream sent a bundle where a reply was expected')
  if (!address.startsWith('/')) throw new OscStreamError('a packet is not an OSC message')
  if (at >= bytes.length) return { address, args: [] }
  const tags = readString()
  if (!tags.startsWith(',')) throw new OscStreamError('a message has no type tags')
  const args: OscValue[] = []
  for (const tag of tags.slice(1)) {
    switch (tag) {
      case 's':
      case 'S':
        args.push(readString())
        break
      case 'i':
        need(4); args.push(bytes.readInt32BE(at)); at += 4
        break
      case 'f':
        need(4); args.push(bytes.readFloatBE(at)); at += 4
        break
      case 'd':
        need(8); args.push(bytes.readDoubleBE(at)); at += 8
        break
      case 'h': {
        need(8)
        const value = bytes.readBigInt64BE(at)
        at += 8
        args.push(Number(value))
        break
      }
      case 'b': {
        need(4)
        const length = bytes.readInt32BE(at)
        at += 4
        if (length < 0) throw new OscStreamError('a blob has a negative length')
        need(length)
        args.push(Uint8Array.from(bytes.subarray(at, at + length)))
        at += (length + 3) & ~3
        break
      }
      case 'T': args.push(true); break
      case 'F': args.push(false); break
      case 'N':
      case 'I': args.push(null); break
      default:
        throw new OscStreamError(`a message carries an argument type (${tag}) a QLab reply does not use`)
    }
  }
  return { address, args }
}
