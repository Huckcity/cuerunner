import { createConnection, type Socket } from 'node:net'
import { decodeMidiMessage } from './decode'
import { encodeMidiMessage, type MidiMessage } from './encode'
import { createMidiStream } from './stream'
import type { MidiMessageKind } from '../../shared/cue'
import { deskLinkName } from '../../shared/deskLink'

export interface MidiTcpResult {
  ok: boolean
  /** Why nothing was sent, when nothing was. */
  error?: string
}

/**
 * How long a recall waits for a socket to open before the operator is told it did not
 * arrive. A desk on the same network answers in a millisecond or refuses immediately;
 * five hundred is what is left of a cue's patience when something is wrong — an address
 * nobody is on hangs for the kernel's minute and a half otherwise, which would stall the
 * show for a message that was never going to arrive.
 */
export const CONNECT_DEADLINE_MS = 500

/**
 * How long a link that has dropped waits before dialling again, while the show still
 * names that desk. A desk on Wi-Fi after a roam comes back on its own; nobody should have
 * to fire a cue to make that happen, because the desk's own scene recalls arrive over the
 * same socket.
 */
export const RETRY_MS = 2000

type SocketFactory = (host: string, port: number) => Socket

function defaultConnect(host: string, port: number): Socket {
  return createConnection({ host, port })
}

/**
 * Why a link is not up, as the panel and its alarm read it: a dial nothing answered, or a
 * connection that came up and was then ended by the desk. The second is what a desk whose
 * MIDI port another client holds does to every client that follows — it accepts the
 * connection and resets it — and an operator sent to check an address that is correct is
 * being sent to look at the wrong thing. The engine is the only place that knows which of
 * the two happened, so it is passed on rather than left to be re-read from a sentence.
 */
export type DeskLinkCause = 'unreachable' | 'reset'

/**
 * One recall's bytes while they wait for a socket, and whether they have gone out. The
 * flag is what lets a recall answer for *its own* bytes: a failure on the link takes the
 * queue with it, and a recall whose bytes are in that queue has to be told it was not
 * delivered rather than reading an empty queue as a successful send.
 */
interface QueuedRecall {
  bytes: number[]
  written: boolean
}

interface Link {
  host: string
  port: number
  socket: Socket | null
  connected: boolean
  /** The connection being attempted, so concurrent recalls share one dial. */
  dialling: Promise<void> | null
  /** Recalls waiting for the socket to open, in the order their cues produced them. */
  pending: QueuedRecall[]
  retry: NodeJS.Timeout | null
  /** Set while the show still names this desk: what the retry timer checks. */
  wanted: boolean
  /**
   * What the panel was last told, or null before it was told anything. A desk that is
   * absent fails its dial every couple of seconds, and an alarm per attempt is an alarm
   * nobody reads — so only the change from one state to the other is reported.
   */
  online: boolean | null
  /**
   * Whether the connection this link last held came up and was then ended by the desk —
   * the fact the close handler already sees. The sentence a following `send()` returns is
   * written after that socket is gone, so the fact has to outlive it; anything that proves
   * the peer is answering now — a connection that comes up, a dial that reaches nothing at
   * all — clears it, and with it the claim that the address is not the thing to check.
   */
  reset: boolean
}

/**
 * MIDI to a desk over TCP — the way an SQ and an Avantis are driven, and the reason this
 * exists at all: their MIDI service is a socket on the desk, not a port on this machine.
 *
 * One socket per desk, kept open, because the protocol is a conversation: the desk sends
 * its own scene recalls and its answers to a get back down the same connection, and the
 * show has to hear them. A link that drops is dialled again while the show still points
 * at it, so a desk that reboots mid-show is there for the next cue without anyone
 * touching anything.
 */
export class MidiTcpEngine {
  private links = new Map<string, Link>()

  /** Called for every message the desk sends. The service publishes these to the show. */
  onMessage: ((device: string, message: MidiMessageKind) => void) | null = null

  /** Called when a link comes up or goes down, so the panel can say which it is. */
  onStatus: ((device: string, online: boolean, detail?: string, cause?: DeskLinkCause) => void) | null = null

  /**
   * The dial and the retry interval are the two things a test has to be able to stand in
   * for: no test can wait two seconds per retry to watch a link come back, and the
   * interval is the only part of this that is a policy rather than a protocol.
   */
  constructor(
    private readonly connect: SocketFactory = defaultConnect,
    private readonly retryMs: number = RETRY_MS
  ) {}

  /**
   * Starts talking to a desk, and keeps talking. Idempotent: the renderer re-sends its
   * settings whenever anything else in the show changes, and re-dialling on each of those
   * would drop whatever the desk was in the middle of saying.
   */
  open(host: string, port: number): void {
    const link = this.link(host, port)
    link.wanted = true
    if (!link.connected && !link.dialling) this.dial(link)
  }

  /** Lets a desk go: the link is closed and not dialled again. */
  close(host: string, port: number): void {
    const link = this.links.get(deskLinkName(host, port))
    if (!link) return
    link.wanted = false
    this.drop(link)
    this.links.delete(deskLinkName(host, port))
  }

  closeAll(): void {
    for (const link of this.links.values()) {
      link.wanted = false
      this.drop(link)
    }
    this.links.clear()
  }

  /**
   * Sends one recall's messages to a desk.
   *
   * The socket is opened by `open`, so this waits on the dial that is already running
   * rather than starting a second one — and when there is no dial to wait on, the
   * deadline is the operator's answer rather than a silent success.
   */
  async send(host: string, port: number, messages: MidiMessage[]): Promise<MidiTcpResult> {
    const link = this.link(host, port)
    link.wanted = true

    const bytes = messages.flatMap(message => encodeMidiMessage(message))
    if (bytes.length === 0) return { ok: true }
    const queued: QueuedRecall = { bytes, written: false }
    link.pending.push(queued)

    if (!link.connected) {
      const dialled = link.dialling ?? this.dial(link)
      const deadline = new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(link.connected), CONNECT_DEADLINE_MS)
        // A deadline that is still counting must not be what keeps the app alive on quit.
        timer.unref?.()
      })
      // Dialling never rejects: it reports through the link, which is what the deadline and
      // the check below read.
      const arrived = await Promise.race([dialled.then(() => true), deadline])
      if (!arrived || !link.connected) {
        // Only this recall's bytes leave the queue: another recall may have queued behind
        // them while the dial was running, and its own deadline decides its fate. Taking
        // the whole queue here used to take that recall's bytes with it — which then
        // reached the flush below with an empty queue and was reported as sent.
        //
        // Nothing is delivered later, either: a message reported as failed and delivered
        // anyway is a desk that moves twice for one scene.
        link.pending = link.pending.filter(entry => entry !== queued)
        return {
          ok: false,
          // A connection that came up and was then reset is not a desk that did not
          // answer: the desk answered, so the address and its setting are the two things
          // that are right, and something else holding the desk is what to look at.
          error: link.reset
            ? `The desk at ${deskLinkName(host, port)} accepted the connection and then reset it — something else may be holding its MIDI port`
            : `The desk at ${deskLinkName(host, port)} did not answer — check its address, and that MIDI over TCP is on at the desk`
        }
      }
    }

    const sent = this.flush(link)
    // The answer is about this recall's own bytes, not about the queue: a link that failed
    // for another recall takes the queue with it, and these bytes are then not on the wire
    // however empty the queue looks.
    if (queued.written) return { ok: true }
    if (!sent.ok) return sent
    return {
      ok: false,
      error: `Could not send to the desk at ${deskLinkName(host, port)}: the connection dropped before the recall went out`
    }
  }

  /** The messages waiting for a socket, written in the order the cues produced them. */
  private flush(link: Link): MidiTcpResult {
    if (!link.socket || link.pending.length === 0) return { ok: true }
    try {
      for (const queued of link.pending) {
        link.socket.write(Buffer.from(queued.bytes))
        queued.written = true
      }
      link.pending = []
      return { ok: true }
    } catch (error) {
      // A desk unplugged between the dial completing and this write: the link is dead
      // and the next recall dials again.
      const reason = error instanceof Error ? error.message : String(error)
      this.drop(link)
      return { ok: false, error: `Could not send to the desk at ${deskLinkName(link.host, link.port)}: ${reason}` }
    }
  }

  private link(host: string, port: number): Link {
    const name = deskLinkName(host, port)
    const existing = this.links.get(name)
    if (existing) return existing
    const link: Link = {
      host,
      port,
      socket: null,
      connected: false,
      dialling: null,
      pending: [],
      retry: null,
      wanted: false,
      online: null,
      reset: false
    }
    this.links.set(name, link)
    return link
  }

  private dial(link: Link): Promise<void> {
    const name = deskLinkName(link.host, link.port)
    if (link.dialling) return link.dialling

    // Whatever the connection before this one did is settled by this attempt: the fact the
    // sentence a failure is written from belongs to the dial that produced it, and an
    // attempt that reaches nothing must not be answered with the last one's fate.
    link.reset = false

    // A socket that failed but has not closed yet is no longer the link's socket. Letting
    // go of it here releases the descriptor now, and the handlers below refuse to write
    // to a link whose socket has been replaced in the meantime — otherwise a failure
    // arriving late would take the *next* connection down with it.
    link.socket?.destroy()

    const socket = this.connect(link.host, link.port)
    link.socket = socket
    const stream = createMidiStream()

    const dialling = new Promise<void>(resolve => {
      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        resolve()
      }

      socket.once('connect', () => {
        if (link.socket === socket) {
          link.connected = true
          link.dialling = null
          if (link.online !== true) {
            link.online = true
            this.onStatus?.(name, true)
          }
          this.flush(link)
        }
        // Whoever was waiting on this dial is answered either way: a socket replaced
        // underneath it is still a dial that finished.
        settle()
      })

      socket.once('error', (error: Error) => {
        // The dial failed — or the peer reset a connection away, which is what a desk whose
        // MIDI port somebody else holds does: it takes the connection and ends it. That
        // reaches here either way, and a reset can even arrive before this client has read
        // its own connection event, so the code answers as well as the state: a connection
        // that had come up, or an RST answered the handshake. `error` also ends the socket,
        // so the close handler does not have to do the bookkeeping twice.
        if (link.socket === socket) {
          const wasConnected = link.connected
          const taken = wasConnected || (error as NodeJS.ErrnoException).code === 'ECONNRESET'
          link.connected = false
          link.dialling = null
          // Whether the peer was holding the port: what a following `send()` returns is
          // written from this. A dial that reached nothing is the one thing that rules it
          // out, and its own message is what the panel is told.
          link.reset = taken
          if (link.online !== false) {
            link.online = false
            if (taken) this.onStatus?.(name, false, 'the connection was taken or reset', 'reset')
            else this.onStatus?.(name, false, error.message, 'unreachable')
          }
        }
        settle()
      })

      socket.on('data', (chunk: Buffer) => {
        if (link.socket !== socket) return
        for (const bytes of stream.push(chunk)) {
          const decoded = decodeMidiMessage(bytes)
          if (decoded) this.onMessage?.(name, decoded)
        }
      })

      socket.once('close', () => {
        if (link.socket === socket) {
          const wasConnected = link.connected
          link.connected = false
          link.dialling = null
          link.socket = null
          if (wasConnected) {
            // A connection that came up and was then ended by the desk without a reset —
            // a graceful close, which the error handler above does not see. The fact is
            // kept the same way: a send after this one has no socket to write to, and the
            // sentence it returns is written from what is kept here.
            link.reset = true
          }
          if (wasConnected && link.online !== false) {
            link.online = false
            this.onStatus?.(name, false, 'the connection was taken or reset', 'reset')
          }
          this.scheduleRetry(link)
        }
        settle()
      })
    })

    link.dialling = dialling
    return dialling
  }

  private scheduleRetry(link: Link): void {
    if (!link.wanted || link.retry !== null) return
    link.retry = setTimeout(() => {
      link.retry = null
      if (link.wanted && !link.connected) this.dial(link)
    }, this.retryMs)
    // A retry for a desk that is not there must not be what keeps the app alive on quit.
    link.retry.unref?.()
  }

  private drop(link: Link): void {
    if (link.retry !== null) {
      clearTimeout(link.retry)
      link.retry = null
    }
    const socket = link.socket
    link.socket = null
    link.connected = false
    link.dialling = null
    link.pending = []
    try {
      socket?.destroy()
    } catch {
      // Already gone at the OS level.
    }
  }
}

/** One link for the whole app: the desk is a device, not a cue. */
export const midiTcp = new MidiTcpEngine()
