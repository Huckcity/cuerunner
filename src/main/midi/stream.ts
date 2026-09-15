/**
 * MIDI over a byte stream, which is what a desk's network port is.
 *
 * A desk's messages arrive the way TCP delivers them: one message split across two
 * reads, four messages inside one read, running status where the status byte was sent
 * once and the next message of the same kind left it out, and SysEx — an unknown length,
 * terminated by 0xF7 — with realtime bytes allowed to interrupt it. A per-message
 * decoder cannot see any of that, so the framing lives here and hands out whole
 * messages; `decodeMidiMessage` then turns each one into the show's shape.
 */
export interface MidiStream {
  push(chunk: ArrayLike<number>): number[][]
}

/** Data bytes a status expects after itself; -1 for SysEx, which runs to its 0xF7. */
function dataBytes(status: number): number {
  if (status < 0xf0) {
    // 0xCn and 0xDn carry one data byte; every other channel message carries two.
    const kind = status & 0xf0
    return kind === 0xc0 || kind === 0xd0 ? 1 : 2
  }
  if (status === 0xf0) return -1
  if (status === 0xf1 || status === 0xf3) return 1
  if (status === 0xf2) return 2
  return 0
}

/**
 * A SysEx that never terminates must not grow without bound. The desks' own SysEx —
 * a channel name, a colour, a send level — are a few dozen bytes; past this the stream
 * has lost its place rather than found a long message, and the buffer is dropped so the
 * next real status byte is read from a clean state.
 */
const SYSEX_LIMIT = 4096

export function createMidiStream(): MidiStream {
  /** The last status byte, which is what makes running status possible. */
  let running: number | null = null
  let data: number[] = []
  let needed = 0
  let sysex: number[] | null = null

  return {
    push(chunk) {
      const out: number[][] = []

      const emit = (message: number[]): void => {
        out.push(message)
        // A system message cancels running status; a channel message is what sets it.
        if (running !== null && running >= 0xf0) running = null
        data = []
      }

      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i]

        // Realtime bytes may sit between any two others, inside a SysEx included, and
        // interrupt nothing. The show keeps none of them: clock and active sensing arrive
        // continuously and say nothing a cue can use.
        if (byte >= 0xf8) continue

        if (sysex !== null) {
          sysex.push(byte)
          if (byte === 0xf7) {
            out.push(sysex)
            sysex = null
          } else if (sysex.length > SYSEX_LIMIT) {
            sysex = null
          }
          continue
        }

        if (byte >= 0x80) {
          // A status byte ends whatever was running, whether or not it had finished —
          // a sender that started a new message is not going to finish the old one.
          running = null
          data = []
          needed = 0

          if (byte === 0xf7) continue // a stray terminator, with nothing to terminate
          if (byte === 0xf0) {
            sysex = [0xf0]
            continue
          }

          running = byte
          needed = dataBytes(byte)
          if (needed === 0) emit([byte])
          continue
        }

        // A data byte with no status in front of it: the stream was joined mid-message,
        // and guessing which message it belonged to would invent a note nobody played.
        if (running === null) continue

        data.push(byte)
        if (data.length === needed) {
          const status = running
          emit([status, ...data])
          // Running status survives a channel message and only that.
          if (status < 0xf0) running = status
          else running = null
        }
      }

      return out
    }
  }
}
