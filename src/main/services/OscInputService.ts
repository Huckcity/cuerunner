import { createSocket, type RemoteInfo } from 'node:dgram'
import type { OscArg } from '../../shared/cue'
import { senderAllowed, senderHost } from '../../shared/oscRemote'
import type { ShowSettings } from '../../shared/show'
import type { OscFeedbackSnapshot } from '../../shared/oscFeedback'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import { decodePacket, OscDecodeError } from '../osc/codec'
import { OscFeedback, type FeedbackPorts } from '../osc/feedback'

/**
 * The slice of a dgram socket the listener uses, so a test can stand one in. The socket is
 * Cuerunner's own: it is created without `reuseAddr`, which is the point of owning it.
 */
export interface OscSocket {
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'message', listener: (message: Buffer, remote: RemoteInfo) => void): unknown
  on(event: 'listening', listener: () => void): unknown
  bind(port: number, address?: string): unknown
  address(): { address: string; port: number }
  send(packet: Buffer, port: number, address: string, callback?: (error: Error | null) => void): void
  close(callback?: () => void): void
}

/**
 * The listener binds exclusively. A UDP socket bound with SO_REUSEADDR shares its port with
 * any other socket that asks the same way — QLab on 53000, a second Cuerunner, a bridge — and
 * the datagrams are then handed to whichever socket the kernel picks, with nobody told. A show
 * that silently hears half of what the desk sends is the failure; a port that is refused is a
 * sentence the operator can act on. So no `reuseAddr` here, and a port in use is reported.
 */
const exclusiveSocket = (): OscSocket => createSocket({ type: 'udp4' }) as unknown as OscSocket

/** Where the listener binds: the interface this machine pinned it to, or every interface. */
export interface OscBinding {
  /** The address to bind, or null for every interface. */
  address: string | null
  /** The interface's name, for the status line. */
  name: string | null
  /** The interface chosen is not on this machine now, so the listener is unpinned. */
  missing: boolean
}

export interface OscInputOptions {
  open?: () => OscSocket
  binding?: () => OscBinding
  /** What `/version` answers — the app's own version in the app — read when it is asked. */
  appVersion?: () => string
  /** The feedback's clock and timers, for a test to drive. */
  clock?: Pick<FeedbackPorts, 'now' | 'setTimer' | 'clearTimer'>
}

/**
 * Reads the OSC that arrives at the show, and answers the remotes that ask about it.
 *
 * A show talks back: a lighting desk sends its cue state, a console sends a macro, a tablet
 * sends a GO. Nothing here decides what those messages mean — the service's job is to get
 * them onto the bus with enough context to be understood, so the panels and the cue stack can
 * act on them. The one exception is a question rather than an instruction — a QLab remote's
 * `/cue/selected/number`, a TouchOSC page asking to be told — which the feedback answers from
 * the last state the window published, without troubling the show with it.
 */
export class OscInputService implements ShowService {
  readonly id = 'osc-in'
  readonly label = 'OSC input'
  readonly settingsSections = ['oscIn'] as const

  private socket: OscSocket | null = null
  private feedback: OscFeedback | null = null
  /** Whether a datagram that was not OSC has been reported, so it is reported once. */
  private warnedJunk = false
  /** The senders this show hears; empty is everyone. Read when the service starts. */
  private allowFrom: readonly string[] = []
  /**
   * The senders already told they are not on the list, so a desk that is refused is said
   * once rather than once per datagram. Bounded: past the cap a refusal is still a refusal,
   * it is only no longer announced.
   */
  private refused = new Set<string>()
  /** The last snapshot the window published, kept across a rebind so a query has an answer. */
  private lastSnapshot: OscFeedbackSnapshot | null = null

  private readonly open: () => OscSocket
  private readonly binding: () => OscBinding
  private readonly appVersion: () => string
  private readonly clock: Pick<FeedbackPorts, 'now' | 'setTimer' | 'clearTimer'>

  constructor(options: OscInputOptions = {}) {
    this.open = options.open ?? exclusiveSocket
    this.binding = options.binding ?? (() => ({ address: null, name: null, missing: false }))
    this.appVersion = options.appVersion ?? (() => '0')
    this.clock = options.clock ?? {
      now: () => Date.now(),
      setTimer: (callback, ms) => {
        const timer = setTimeout(callback, ms)
        timer.unref?.()
        return timer
      },
      clearTimer: handle => clearTimeout(handle as NodeJS.Timeout)
    }
  }

  start(context: ServiceContext, settings: ShowSettings): void {
    const { enabled, port } = settings.oscIn
    if (!enabled) {
      context.setState('stopped', 'disabled')
      return
    }

    const binding = this.binding()
    const bindAddress = binding.address ?? '0.0.0.0'
    const socket = this.open()
    this.socket = socket
    this.warnedJunk = false
    this.allowFrom = settings.oscIn.allowFrom ?? []
    this.refused.clear()
    const feedback = new OscFeedback({
      ...this.clock,
      appVersion: this.appVersion,
      send: (host, toPort, packet) => {
        // A reply that cannot leave — a remote that has gone, a host that does not resolve —
        // is the remote's loss, not the listener's: it is dropped where it fails.
        try {
          socket.send(packet, toPort, host, () => {})
        } catch {
          // The socket is closing; there is nothing left to send on.
        }
      }
    })
    this.feedback = feedback
    feedback.configure(settings.oscIn.feedback ?? null)
    if (this.lastSnapshot !== null) feedback.publish(this.lastSnapshot)
    context.setState('starting', `binding ${bindAddress}:${port}`)
    if (binding.missing) {
      context.bus.alert('warning', this.id,
        `OSC input: ${binding.name ?? 'the chosen interface'} is not on this machine — listening on every interface`)
    }

    // Without a listener, an 'error' event on the socket is an unhandled throw that takes
    // the main process down — and a port already in use is the likeliest error there is,
    // since the operator's QLab or TouchOSC may hold it.
    //
    // A port that is refused is a status, not an alarm: the row under OSC control says why, and
    // the window writes it to the log once (`useOscPortReport`). Several shows started on one
    // machine at once — the rehearsal room's second laptop, a CI host's parallel jobs — each find
    // 53000 taken but one, and an alarm per refusal would be an alarm about nothing on the stage.
    // A socket that bound and then fails is an outage, and that is an alarm.
    let bound = false
    socket.on('error', (error: Error) => {
      const sentence = bound ? `stopped listening: ${describe(error)}` : refusalSentence(error, bindAddress, port)
      context.setState('degraded', sentence)
      if (bound) context.bus.alert('warning', this.id, `OSC input: ${sentence}`)
      if (!bound) {
        // A socket that never bound holds nothing; closing it lets the next start begin clean.
        this.closeSocket(socket)
        if (this.socket === socket) this.socket = null
      }
    })

    socket.on('listening', () => {
      bound = true
      // The port, not the bind address: an operator reads this to check the desk is pointed
      // at the right number. An interface the machine pinned is named, because that is the
      // one thing a desk on another network would need to know.
      const actual = safeAddress(socket)?.port ?? port
      const on = binding.address !== null ? ` on ${binding.name ?? binding.address} (${binding.address})` : ''
      context.setState('running', `listening on port ${actual}${on}`)
    })

    socket.on('message', (packet: Buffer, remote: RemoteInfo) => {
      this.receive(context, packet, remote)
    })

    try {
      socket.bind(port, bindAddress)
    } catch (error) {
      // A bind that throws at once — a port out of range — is the same refusal.
      context.setState('degraded', refusalSentence(error, bindAddress, port))
    }
  }

  stop(): void {
    this.feedback?.close()
    this.feedback = null
    const socket = this.socket
    if (!socket) return
    this.socket = null
    this.closeSocket(socket)
  }

  /** The window's half of the feedback: `feedback` publishes the show's state to answer from. */
  command(action: string, payload?: unknown): unknown {
    if (action !== 'feedback') throw new Error(`OSC input has no action called ${action}`)
    const snapshot = payload as OscFeedbackSnapshot
    if (typeof snapshot !== 'object' || snapshot === null || !Array.isArray(snapshot.running) || !Array.isArray(snapshot.cues)) {
      throw new Error('a feedback snapshot is the show as the window reads it')
    }
    this.lastSnapshot = snapshot
    this.feedback?.publish(snapshot)
    return true
  }

  private closeSocket(socket: OscSocket): void {
    try {
      socket.close()
    } catch {
      // A socket that is already closed throws from close(); nothing left to do.
    }
  }

  private receive(context: ServiceContext, packet: Buffer, remote: RemoteInfo): void {
    // A sender off the list is dropped here, before anything reads it: what it sent never
    // reaches a trigger, the remote, the feedback or the Monitor, which is what a closed door
    // means.
    if (!senderAllowed(remote.address, this.allowFrom)) {
      const host = senderHost(remote.address)
      if (!this.refused.has(host) && this.refused.size < MAX_REFUSED_REPORTED) {
        this.refused.add(host)
        context.bus.alert('info', this.id, `OSC input: ignored ${host}, which is not on the allow list`)
      }
      return
    }
    let messages
    try {
      messages = decodePacket(packet)
    } catch (error) {
      // A datagram that is not OSC at all is not the service being unwell — anyone on the
      // network may send junk — so it is reported once and the row stays running, where
      // latching it to "degraded" with an alarm per packet would leave a real outage
      // indistinguishable from noise while valid traffic keeps firing cues.
      if (!(error instanceof OscDecodeError)) throw error
      if (!this.warnedJunk) {
        this.warnedJunk = true
        context.bus.alert('info', this.id, `OSC input: ignored a datagram from ${remote.address} that is not an OSC message`)
      }
      return
    }
    // A desk that sends its state as one bundle arrives as its parts, in order, however deep
    // the bundles go.
    for (const message of messages) {
      // A question for the feedback is answered and goes no further: a remote polling the
      // playhead ten times a second is not ten events a second in the show's log.
      if (this.feedback?.handle(message.address, message.args, { host: remote.address, port: remote.port }) === true) continue
      context.bus.publish({
        kind: 'osc',
        at: Date.now(),
        from: `${remote.address}:${remote.port}`,
        address: message.address,
        args: message.args
      })
    }
  }
}

/**
 * Why a bind was refused, as the sentence the operator reads in Settings and the log: the port
 * and what holds it, with the system's own code kept at the end for whoever is asked to look.
 */
export function refusalSentence(
  error: unknown,
  address: string,
  port: number,
  platform: NodeJS.Platform = process.platform
): string {
  const code = (error as { code?: unknown } | null)?.code
  switch (code) {
    case 'EADDRINUSE':
      return `port ${port} is in use by another program (QLab, another Cuerunner, a bridge) — ` +
        `this show cannot hear OSC there until it is let go or the port is changed (EADDRINUSE)`
    case 'EACCES':
      // Windows reports a port another socket holds exclusively as WSAEACCES — libuv binds a
      // UDP socket there with SO_EXCLUSIVEADDRUSE, so a later bind with SO_REUSEADDR is refused
      // with it — and a port below 1024 needs no privileges there. Elsewhere it is exactly that:
      // a port below 1024 that needs privileges.
      return platform === 'win32'
        ? `port ${port} is in use by another program (QLab, another Cuerunner, a bridge) — ` +
          `this show cannot hear OSC there until it is let go or the port is changed (EACCES)`
        : `port ${port} needs privileges this program does not have — choose a port above 1023 (EACCES)`
    case 'EADDRNOTAVAIL':
      return `${address} is not an address of this machine any more — choose its interface again (EADDRNOTAVAIL)`
    default:
      return describe(error)
  }
}

/**
 * The arguments as the cue model writes them, from plain values: the type inferred back from
 * the value. The listener's own decoder keeps the wire's tags; this is for a caller that has
 * only values — a test, a bridge.
 */
export function toOscArgs(values: unknown[]): OscArg[] {
  return values.map(value => {
    if (typeof value === 'number') {
      return { type: Number.isInteger(value) ? 'i' : 'f', value }
    }
    if (typeof value === 'boolean') {
      return { type: value ? 'T' : 'F', value }
    }
    if (typeof value === 'string') {
      return { type: 's', value }
    }
    if (Buffer.isBuffer(value)) {
      // Blobs have no tag in the cue model; their bytes are more useful than a summary.
      return { type: 's', value: value.toString('hex') }
    }
    return { type: 's', value: String(value) }
  })
}

function safeAddress(socket: OscSocket): { address: string; port: number } | null {
  try {
    return socket.address()
  } catch {
    return null
  }
}

/** How many refused senders are each named once before the rest go unannounced. */
const MAX_REFUSED_REPORTED = 32

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
