/**
 * Where MIDI Time Code meets the show's own MIDI inputs.
 *
 * On Windows a MIDI input port can be held by one client at a time, and the MIDI input
 * service opens every port by default — so the clock cannot always have a port of its own.
 * The service hands each port it opens to this tap; while the timecode receiver is listening
 * on one of them, the tap turns that port's MTC on (the service otherwise drops it with the
 * clock) and takes the quarter frames and full-frame locates out of the stream before the
 * show sees them. A port the service does not hold, the receiver opens itself.
 */
import { decodeFullFrame } from './mtc'

export type MtcListener = (bytes: number[], at: number) => void

interface HeldPort {
  /** Turns the port's MTC on or off: rtmidi drops it with the clock unless asked not to. */
  setTimecode(on: boolean): void
}

export class MidiTimecodeTap {
  private held = new Map<string, HeldPort>()
  private listener: { port: string; listen: MtcListener } | null = null

  /** The input service opened a port. */
  opened(port: string, handle: HeldPort): void {
    this.held.set(port, handle)
    if (this.wants(port)) handle.setTimecode(true)
  }

  /** The input service let a port go. */
  closed(port: string): void {
    this.held.delete(port)
  }

  /** Whether the input service has this port open, so the receiver should not open it again. */
  holds(port: string): boolean {
    return this.held.has(port)
  }

  /** The ports the service holds, for a receiver asked for "the first port there is". */
  heldPorts(): string[] {
    return [...this.held.keys()]
  }

  /** Whether this port's MTC is wanted, which is what the service opens it for. */
  wants(port: string): boolean {
    return this.listener !== null && this.listener.port === port
  }

  listen(port: string, listen: MtcListener): () => void {
    if (this.listener !== null) this.held.get(this.listener.port)?.setTimecode(false)
    this.listener = { port, listen }
    this.held.get(port)?.setTimecode(true)
    return () => {
      if (this.listener?.listen !== listen) return
      this.held.get(port)?.setTimecode(false)
      this.listener = null
    }
  }

  /**
   * A message from a held port. True when it was timecode and has been dealt with — the
   * service then publishes nothing for it. A quarter frame is never a show event; a
   * full-frame locate is one only on a port nobody is following the clock on.
   */
  offer(port: string, bytes: number[], at: number): boolean {
    const quarter = bytes.length === 2 && bytes[0] === 0xf1
    const locate = !quarter && bytes[0] === 0xf0 && decodeFullFrame(bytes) !== null
    if (!quarter && !locate) return false
    if (this.wants(port)) {
      this.listener!.listen(bytes, at)
      return true
    }
    return quarter
  }
}

/** The one tap the MIDI input service and the timecode receiver share. */
export const midiTimecodeTap = new MidiTimecodeTap()
