// The desk's own answers, read on a connection of the spec's own.
//
// An SQ answers a get for any mute, level, pan/balance or assignment parameter with the
// parameter's current value, in the same NRPN form that sets it — "SQ MIDI Protocol" §3.7,
// "Getting values": select the parameter, then finish with the increment message carrying 7F.
// An Avantis has no published mute get, so what is asked of it is a name, answered in the
// header its own document gives ("Avantis MIDI TCP/IP Protocol", name and colour). Both are
// the desk speaking rather than the app's account of what it sent, which is what the hardware
// lane asserts against and what the peer lane holds here, on a lane that runs every PR.
import { createConnection, type Socket } from 'node:net'

/** DCA 1 on an SQ: parameter 0 of page 02, which is where the reference table puts it. */
export const SQ_DCA = { page: 0x02, parameter: 0x00 }

/** The Avantis's own SysEx header (V2.0+), the name get, and the reply that answers it. */
const AVANTIS_HEADER = [0xf0, 0x00, 0x00, 0x1a, 0x50, 0x10, 0x01, 0x00]
const AV_NAME_GET = 0x01
const AV_NAME_REPLY = 0x02

/** How long a get waits for the desk's answer before the caller is told nothing came. */
export const DESK_ANSWER_MS = 5000

/**
 * The get this spec sends for DCA 1's mute on an SQ, as the document writes it: the parameter
 * and its page, then the increment message carrying 7F, which asks instead of moving.
 */
export function sqDcaGet(channel: number): number[] {
  const cc = 0xb0 | ((channel - 1) & 0x0f)
  return [cc, 0x63, SQ_DCA.page, cc, 0x62, SQ_DCA.parameter, cc, 0x60, 0x7f]
}

/** Where an Avantis's DCA 1 lives: four channels above the desk's own, at note 36. */
export function avantisDcaChannel(channel: number): number {
  return channel + 4
}

/** The name get this spec sends for DCA 1 on an Avantis. */
export function avantisDcaNameGet(channel: number): number[] {
  return [...AVANTIS_HEADER, (avantisDcaChannel(channel) - 1) & 0x0f, AV_NAME_GET, 0x36, 0xf7]
}

/**
 * What an SQ's answer says DCA 1's mute is. The select and the value are each their own
 * controller message, so their data bytes are separated by status bytes —
 * `B0 63 02 B0 62 00 B0 06 00 B0 26 <value>` — which is what this walks. Null when the answer
 * is not that shape: a finding rather than a pass, and the reason the hardware lane's
 * self-test asserts that this is not null.
 */
export function sqMuteValue(bytes: number[]): boolean | null {
  const find = (from: number, controller: number, value: number): number => {
    for (let i = from; i + 1 < bytes.length; i++) {
      if (bytes[i] === controller && bytes[i + 1] === value) return i
    }
    return -1
  }

  const page = find(0, 0x63, SQ_DCA.page)
  if (page < 0) return null
  const parameter = find(page + 2, 0x62, SQ_DCA.parameter)
  if (parameter < 0) return null
  const off = find(parameter + 2, 0x26, 0x00)
  const set = off >= 0 ? off : find(parameter + 2, 0x26, 0x01)
  if (set < 0) return null
  return bytes[set + 1] === 0x01
}

/** Whether an answer is the Avantis name reply its document gives. */
export function isAvantisNameReply(bytes: number[]): boolean {
  return bytes.some((_, index) =>
    AVANTIS_HEADER.every((byte, offset) => bytes[index + offset] === byte) &&
    bytes[index + AVANTIS_HEADER.length + 1] === AV_NAME_REPLY)
}

/** A connection of the spec's own to a desk, so an assertion can be about what it said. */
export interface DeskWire {
  /**
   * Sends the question and answers with what the desk said back, or null when it said nothing
   * before the deadline — which is what lets a poll ask again rather than throwing where the
   * poll cannot see it.
   */
  ask(bytes: number[], timeoutMs?: number): Promise<number[] | null>
  close(): void
}

class SocketWire implements DeskWire {
  private bytes: number[] = []
  private closed = false

  constructor(private readonly socket: Socket) {
    // Buffering starts before the connection settles: a desk may speak the moment it accepts
    // (an SQ sends a burst of its own state), and those bytes belong to whoever asks next.
    socket.on('data', (chunk: Buffer) => this.bytes.push(...chunk))
  }

  async ask(bytes: number[], timeoutMs = DESK_ANSWER_MS): Promise<number[] | null> {
    if (this.closed) return null
    this.bytes = []
    this.socket.write(Buffer.from(bytes))
    const deadline = Date.now() + timeoutMs
    while (this.bytes.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const answer = this.bytes
    this.bytes = []
    return answer.length === 0 ? null : answer
  }

  close(): void {
    this.closed = true
    this.socket.destroy()
  }
}

/**
 * Opens one and waits for the desk to accept it. The deadline is the connect's — a desk that
 * is quiet between questions is not a fault — and a failed connect is closed rather than left
 * half-open. The failure is the caller's to phrase: a desk that does not answer is a desk
 * setting, and the caller knows which checklist says so.
 */
export async function openDeskWire(host: string, port: number, timeoutMs = DESK_ANSWER_MS): Promise<DeskWire> {
  const socket = createConnection({ host, port })
  const wire = new SocketWire(socket)
  const opened = Promise.withResolvers<void>()
  const failed = (error: Error): void => {
    socket.destroy()
    opened.reject(new Error(`no connection to ${host}:${port} (${error.message})`))
  }
  socket.once('connect', () => {
    socket.setTimeout(0)
    opened.resolve()
  })
  socket.once('error', failed)
  socket.setTimeout(timeoutMs, () => failed(new Error(`nothing accepted in ${timeoutMs} ms`)))
  await opened.promise
  return wire
}
