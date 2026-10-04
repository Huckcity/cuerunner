import { createConnection, type Socket } from 'node:net'
import { createSocket, type Socket as DatagramSocket } from 'node:dgram'
import { reportMainError } from '../errors'
import type { SqMembershipIntent } from '../../shared/show'
import {
  GOODBYE,
  NATIVE_KEEPALIVE_PORT,
  NATIVE_LEAVE_PORT,
  NATIVE_TCP_PORT,
  assignPair,
  clearPair,
  createFrameReader,
  dcaFlag,
  helloFrame,
  keepAliveFrame,
  sessionFrames
} from './frames'

/**
 * How long a dial nothing answered waits before it is tried again, while the show still
 * names that desk. A desk that is switched on a minute after the show opened is a desk the
 * operator does not have to reopen the show for.
 *
 * This retry belongs to a dial that reached nothing and never follows a loss: §6 measures
 * what a lost session leaves behind — a desk that takes a client again only after it is
 * reset — and dialling a mute desk in a loop is a lie about the state the alarm is naming.
 * The way back after the desk has been reset is a configure: `ServiceHost.bringUp` stops
 * and starts a service whose `desk` section moved, which is a new `open` and a new session
 * rather than this engine's own guess about when to try again.
 */
export const RETRY_MS = 2000

/**
 * The keepalive datagram's cadence: §6's prose ("an `f7 05 …` datagram to **UDP 51324**
 * every second"), not the capture's — the capture spans 8388 ms and holds a single
 * `7f 00 02` write and a single echo, so neither cadence is measured there. Unproven, like
 * the datagram's own body, until a desk is watched over minutes (Story 11.5's lane).
 */
export const KEEPALIVE_MS = 1000

/**
 * How long one attempt at the desk's control port is given before it is a desk that did not
 * answer. The same figure the MIDI half of the desk link uses: a connect nobody answers
 * hangs for the kernel's own minute and a half, and until it times out there is no session
 * to lose and no retry armed — the operator would be looking at the last status for as long
 * as that takes.
 */
export const CONNECT_DEADLINE_MS = 500

/**
 * The socket ping's cadence, and how long the desk's answer to one is watched for. §6's
 * prose again; see `KEEPALIVE_MS` for what the capture does and does not hold.
 */
export const PING_MS = 3000

/**
 * How many periods the desk may leave silent before the session is a session that has gone.
 * §6 measures the desk answering the ping, so its silence is the only early sign there is:
 * the socket's own error waits for the kernel, which is minutes.
 */
const MISSED_ANSWERS = 2

type SocketFactory = (host: string, port: number) => Socket

function defaultConnect(host: string, port: number): Socket {
  return createConnection({ host, port })
}

/**
 * Why a session is not up, as the operator's row and alarm read it: a dial nothing answered,
 * or a session the desk was holding and no longer is. The second is the state §6 measures —
 * a client that goes without its goodbye leaves the desk taking TCP and answering nothing
 * until it is reset — and an operator sent to check an address that answered is being sent
 * to look at the wrong thing.
 */
export type SqSessionCause = 'unreachable' | 'lost'

/**
 * The SQ's own control service on 51326: the session the desk expects, kept alive the two
 * ways §6 measures, and left by the door the desk expects.
 *
 * A session, not a request: the desk expects a client to open, identify itself, push its
 * layout, settle and then stay — pushing state (`7f 08 …` and `7f 0e …`) as the show moves,
 * which this reads and answers with nothing, because the desk's own read form is
 * unmeasured. What it does write is the one thing this story measured: a DCA membership.
 *
 * The desk's own door on 51321 is a channel this opens when the session comes up and holds
 * for its life, never a dial made at teardown: the quit path is past the point Electron
 * waits for asynchronous work (`src/main/index.ts:290-293`), so a dial there never reaches
 * its `connect`, and the `BYE.` that would have released the desk never leaves the process.
 */
export class SqNativeEngine {
  /** Called when the session comes up or goes down, with why when it goes. */
  onStatus: ((online: boolean, detail?: string, cause?: SqSessionCause) => void) | null = null

  /** The desk the show names, and the socket the session runs on. */
  private host: string | null = null
  private socket: Socket | null = null
  /** The channel `BYE.` goes out on: opened with the session, never dialled at teardown. */
  private leave: Socket | null = null
  /** The keepalive's own socket, sent from rather than bound. */
  private datagram: DatagramSocket | null = null
  private dialling = false
  /** The dial's own deadline, while an attempt is in flight. */
  private dialDeadline: ReturnType<typeof setTimeout> | null = null
  /**
   * The session's frames are written, and the desk has not said anything yet. It is not a
   * session until it answers: the state §6 measures is a desk that takes the connection and
   * answers nothing, and a panel that read that as running would be wrong for as long as it
   * takes the deadline to notice.
   */
  private opened = false
  /** The desk has spoken: the session is up, and the panel is told so. */
  private up = false
  /** Set while the show still names this desk: what a retry and a ping check. */
  private wanted = false
  private keepalive: NodeJS.Timeout | null = null
  private ping: NodeJS.Timeout | null = null
  /** The deadline the desk's answer to a ping is watched under. */
  private deadline: NodeJS.Timeout | null = null
  private retry: NodeJS.Timeout | null = null
  /** Periods the desk has left unanswered, in a row. */
  private missed = 0
  /**
   * What the panel was last told, or null before it was told anything. A desk that is
   * absent fails its dial every couple of seconds and an alarm per attempt is an alarm
   * nobody reads, so only the change from one state to the other is reported.
   */
  private online: boolean | null = null

  /**
   * The dial is the one thing a test has to be able to stand in for, because the ports are
   * the desk's own and not the show's: a drive that owns a desk gets a real session either
   * way, and nothing else here is a policy rather than a protocol.
   */
  constructor(private readonly connect: SocketFactory = defaultConnect) {}

  /**
   * Opens the session with a desk and keeps it open. Idempotent: the renderer re-sends its
   * settings whenever anything else in the show changes, and re-dialling on each of those
   * would drop whatever the desk was in the middle of.
   */
  open(host: string): void {
    const address = host.trim()
    if (address === '') return
    this.wanted = true
    if (address === this.host && (this.socket !== null || this.dialling)) return
    // A desk that moved is left the way a quit leaves one, and for the same reason — and its
    // release is not the goodbye's to skip either.
    if (this.host !== null) {
      try {
        this.sayGoodbye()
      } finally {
        this.release()
        // What the panel was last told belonged to the desk this is no longer dialling: the
        // session that follows is news again, however the old one ended.
        this.online = null
      }
    }
    this.host = address
    this.dial()
  }

  /**
   * Lets the desk go: `BYE.` goes out on the channel the session was holding, and everything
   * else — the sockets, the cadences — is released. Written synchronously, because the quit
   * path is where this matters and the kernel sends what is already queued even as the
   * process exits.
   *
   * The release is not the goodbye's to skip: a goodbye that throws — a log sink that
   * cannot write, a socket whose end() fails on a channel nobody expected — must not leave
   * a socket and three timers behind on the one path that runs while the app is closing.
   */
  closeAll(): void {
    this.wanted = false
    try {
      this.sayGoodbye()
    } finally {
      this.release()
      this.host = null
      // A configure stops a service before it starts it again (`ServiceHost.bringUp`), so the
      // same desk can come back on settings that moved something else. Nothing is being
      // watched in between, and a session that comes up then is a change the panel has to
      // hear: without this, the row and the status would stay wherever the last session left
      // them and the desk the show is really on would read as one nobody opened.
      this.online = null
    }
  }

  /**
   * One membership written to the desk: the pair frame and then the channel's own flag, which
   * is two frames, and how many of them went out is the answer.
   *
   * The flag rides along because the desk keeps it per channel rather than per pair: it says
   * whether the channel rides any fader at all, so writing it with the pair leaves the desk
   * told the channel's fact as this write leaves it — the channel placed on its first fader and
   * the channel taken off its last are each told what is true now, and nothing has to be
   * remembered from the call before (`frames.ts` holds the polarity the capture fixes).
   *
   * Only a session the desk has spoken on is written to. A socket still dialling, a connection
   * the desk took and said nothing on, and a session that was lost are all desks nobody is
   * talking to: frames written into one are bytes that go nowhere, so nothing is written and
   * the answer is 0. Nothing here throws either — a recall writes one membership after another
   * and reports the ones that did not go, so a 0 is the caller's to name rather than a fault
   * of this engine's.
   */
  sendMembership(intent: SqMembershipIntent): number {
    const socket = this.up ? this.socket : null
    const pair = intent.placed ? assignPair(intent.channel, intent.dca) : clearPair(intent.channel, intent.dca)
    let frames = 0
    // The pair, then the channel's flag: the capture's own order, and a frame that cannot go
    // ends the write rather than being written after one that did not.
    for (const frame of [pair, dcaFlag(intent.channel, intent.rides)]) {
      if (!this.write(socket, frame)) break
      frames += 1
    }
    return frames
  }

  /**
   * Several memberships as one write: every pair and its flag, in order, in a single buffer —
   * all of them or none. A highest-wins switch is a place and a clear, and written apart the
   * desk sometimes applies the first before the second on a control tick of its own, so the
   * channel rides both faders for up to ~190 ms and the two offsets add: 24 of 50 such
   * switches dipped by the full offset on an SQ-6, against none of 46 written as one
   * (2026-10-04, LR recorded over USB). The answer is how many frames went: every one, or 0.
   */
  sendMemberships(intents: readonly SqMembershipIntent[]): number {
    const socket = this.up ? this.socket : null
    const frames = intents.flatMap(intent => [
      intent.placed ? assignPair(intent.channel, intent.dca) : clearPair(intent.channel, intent.dca),
      dcaFlag(intent.channel, intent.rides)
    ])
    if (frames.length === 0) return 0
    return this.write(socket, frames.flat()) ? frames.length : 0
  }

  /**
   * The desk's own door. A session that never came up has no channel and nothing to say.
   *
   * The write is queued even on a channel that has not finished opening — the kernel sends
   * what it has when the process goes — but a goodbye nobody saw is the one thing this
   * channel exists for, so a channel that never opened is reported rather than assumed.
   */
  private sayGoodbye(): void {
    const leave = this.leave
    this.leave = null
    if (leave === null) return
    const told = this.write(leave, GOODBYE)
    // `connecting` is still true until the dial has finished: the write above is queued on
    // a connection that may never open, and that is not the same as having said it.
    const pending = leave.connecting === true
    try {
      leave.end()
    } catch {
      // Already gone at the OS level; what the desk reads is the write above.
    }
    if (!told) {
      reportMainError(
        `[main] the SQ at ${this.host ?? 'the desk the show named'} was not told goodbye — it may be mute until it is reset`
      )
      return
    }
    if (pending) {
      reportMainError(
        `[main] the SQ at ${this.host ?? 'the desk the show named'} may not have been told goodbye — the channel to ${NATIVE_LEAVE_PORT} was still opening`
      )
    }
  }

  /** Everything the session opened, let go of: no goodbye, because the session is over. */
  private release(): void {
    this.clearTimers()
    const socket = this.socket
    const leave = this.leave
    this.socket = null
    this.leave = null
    this.opened = false
    this.up = false
    this.dialling = false
    this.missed = 0
    if (this.datagram !== null) {
      try {
        this.datagram.close()
      } catch {
        // Never bound, so never running: nothing to close.
      }
      this.datagram = null
    }
    socket?.destroy()
    leave?.destroy()
  }

  private clearTimers(): void {
    clearInterval(this.keepalive ?? undefined)
    clearInterval(this.ping ?? undefined)
    clearTimeout(this.deadline ?? undefined)
    clearTimeout(this.retry ?? undefined)
    clearTimeout(this.dialDeadline ?? undefined)
    this.keepalive = null
    this.ping = null
    this.deadline = null
    this.retry = null
    this.dialDeadline = null
  }

  /** One attempt at the desk the show names. */
  private dial(): void {
    const host = this.host
    if (host === null || !this.wanted || this.dialling || this.socket !== null) return
    let socket: Socket
    try {
      socket = this.connect(host, NATIVE_TCP_PORT)
    } catch (error) {
      // A connector that throws before it returns an attempt that never started, and the
      // flag is what everything else reads as "a dial is in flight": left up, it would keep
      // `open()` idempotent against a desk that is not being dialled, with nothing left to
      // clear it. Reported as the unreachable desk it is, so the retry cadence owns it.
      this.sessionOver(error instanceof Error ? error.message : String(error))
      return
    }
    this.dialling = true
    this.socket = socket
    const reader = createFrameReader()

    // The attempt itself gets a deadline. A connect the kernel never answers — a desk that
    // has gone away mid-handshake, a network that drops the SYN — hangs for its own minute
    // and a half otherwise, and until then there is no session to lose and no retry armed:
    // the same deadline the desk link's MIDI half carries, for the same reason.
    const opened = setTimeout(() => {
      if (this.socket !== socket) return
      this.sessionOver(`the desk at ${host}:${NATIVE_TCP_PORT} did not answer within ${CONNECT_DEADLINE_MS} ms`)
    }, CONNECT_DEADLINE_MS)
    opened.unref?.()
    this.dialDeadline = opened

    socket.once('connect', () => {
      if (this.socket !== socket) return
      clearTimeout(opened)
      this.dialDeadline = null
      this.dialling = false
      this.startSession(socket)
    })

    socket.once('error', (error: Error) => {
      if (this.socket !== socket) return
      this.sessionOver(error.message)
    })

    socket.once('close', () => {
      if (this.socket !== socket) return
      this.sessionOver('the desk closed the connection')
    })

    socket.on('data', (chunk: Buffer) => {
      if (this.socket !== socket) return
      // Whole frames, and nothing done with them beyond this: the desk speaking is the
      // session's liveness, and what it says is Story 11.5's to read.
      if (reader.push(chunk).length > 0) this.heard()
    })
  }

  /** The measured session, in the order the capture's wire shows it, then the cadences. */
  private startSession(socket: Socket): void {
    const host = this.host
    if (host === null) return
    this.missed = 0
    for (const frame of sessionFrames()) {
      if (this.write(socket, frame)) continue
      // The connection went while the session was being written: that is a session that
      // never opened, not one to report as up.
      this.sessionOver('the connection went while the session was being written')
      return
    }
    this.opened = true

    // The desk's own door: dialled now, held for the session's life and unref'd, so the
    // goodbye at teardown is a write on a channel that already exists.
    const leave = this.connect(host, NATIVE_LEAVE_PORT)
    leave.once('error', (error: Error) => {
      // The channel the goodbye needs never opened. That is worth saying when it happens:
      // what the operator does with it — stop the client before the desk, reset a desk left
      // mute — is decided at teardown, and `sayGoodbye` says it again there.
      reportMainError(
        `[main] the SQ at ${host} is not holding its leave channel on ${NATIVE_LEAVE_PORT} (${error.message}) — quitting may leave it mute`
      )
    })
    leave.unref()
    this.leave = leave

    this.datagram = createSocket('udp4')
    this.datagram.on('error', () => {
      // A datagram the kernel hands back — an address nothing is on — is not what ends a
      // session: the desk answering is.
    })
    this.datagram.unref()

    this.keepalive = setInterval(() => this.keepAliveTick(), KEEPALIVE_MS)
    // A keepalive for a desk that is not there must not be what keeps the app alive on quit.
    this.keepalive.unref?.()
    this.ping = setInterval(() => this.pingTick(), PING_MS)
    this.ping.unref?.()

    // The hello is the first ping, and the desk owes it an answer: the deadline is what
    // names a desk that took the connection and said nothing, and the session is not up
    // until something comes back.
    this.armDeadline()
  }

  /** One datagram, to the desk's own keepalive port. */
  private keepAliveTick(): void {
    const datagram = this.datagram
    const host = this.host
    // The cadences start with the session's own frames: they are what keeps it alive, and a
    // desk that took the connection is a desk to keep alive whether or not it has answered.
    if (datagram === null || host === null || !this.opened) return
    try {
      datagram.send(Buffer.from(keepAliveFrame()), NATIVE_KEEPALIVE_PORT, host)
    } catch {
      // The socket went with the session; the session's own end is reported by the socket
      // it ran on rather than by a datagram that could not leave.
    }
  }

  /**
   * One ping, and the deadline its answer is watched under. The measured form is what the
   * session opened with; the desk answers in kind.
   */
  private pingTick(): void {
    const socket = this.socket
    if (socket === null || !this.opened) return
    if (!this.write(socket, helloFrame())) return
    // A ping going out while the last one is still unanswered does not push the judgement
    // back: what is counted is the desk's silence, period by period.
    if (this.deadline === null) this.armDeadline()
  }

  /**
   * Watches for the answer the desk owes. One period with none is one period, and the next
   * is the one that decides: the session is lost with the cause the alarm names, and both
   * cadences stop with it.
   */
  private armDeadline(): void {
    this.clearDeadline()
    this.deadline = setTimeout(() => {
      this.deadline = null
      this.missed += 1
      const socket = this.socket
      if (this.missed >= MISSED_ANSWERS) {
        if (socket !== null) this.sessionOver('the pings went unanswered', 'lost')
        return
      }
      if (socket !== null) this.armDeadline()
    }, PING_MS)
    this.deadline.unref?.()
  }

  private clearDeadline(): void {
    clearTimeout(this.deadline ?? undefined)
    this.deadline = null
  }

  /**
   * A frame the desk sent — any frame at all.
   *
   * Everything the desk says is the desk still being there: the capture measures it
   * answering the hello in the same form (`7f 00 02 …`) and pushing its state (`7f 08 …`
   * strip names among it) while the client works. So the silence this watches for is *no
   * frame at all*, and a desk that keeps talking is a session that is alive, whichever of
   * its frames arrive.
   *
   * The first one is also what makes the session up: a connection the desk took and then
   * said nothing on is the state §6 measured, and the deadline is what names it.
   *
   * Nothing is answered: no read is sent, because what the desk says about a membership is
   * the unmeasured half of this protocol (Story 11.5's lane).
   */
  private heard(): void {
    this.missed = 0
    this.clearDeadline()
    if (this.up || !this.opened) return
    this.up = true
    this.report(true, `session open with ${this.host ?? 'the desk'}:${NATIVE_TCP_PORT}`)
  }

  /**
   * A session that is over, with why, and as which cause.
   *
   * The cause is what the row and the alarm are written from. It is read from whether the
   * desk ever spoke — a desk that said nothing is a desk that is not answering, and is
   * dialled again — unless the caller knows better: two periods of silence from a desk that
   * took the connection is the state §6 measures, a desk that takes a client again only after
   * it is reset, and dialling that in a loop would be a lie about the state the alarm names.
   */
  private sessionOver(detail: string, cause?: SqSessionCause): void {
    const lost = cause ?? (this.up ? 'lost' : 'unreachable')
    this.release()
    this.report(false, detail, lost)
    if (lost === 'unreachable') this.armRetry()
  }

  private armRetry(): void {
    if (this.retry !== null || !this.wanted) return
    this.retry = setTimeout(() => {
      this.retry = null
      if (this.wanted && this.socket === null) this.dial()
    }, RETRY_MS)
    // A retry for a desk that is not there must not be what keeps the app alive on quit.
    this.retry.unref?.()
  }

  /**
   * One frame on the wire, and whether it went out. A socket can go between a timer and its
   * callback — the desk's door is on two of them — and a throw from there would be an
   * interval taking the main process with it.
   */
  private write(socket: Socket | null, bytes: readonly number[]): boolean {
    if (socket === null || socket.destroyed || !socket.writable) return false
    try {
      socket.write(Buffer.from(bytes))
      return true
    } catch {
      return false
    }
  }

  /** The change of state, and only the change: an outage is one thing to report. */
  private report(online: boolean, detail?: string, cause?: SqSessionCause): void {
    if (this.online === online) return
    this.online = online
    this.onStatus?.(online, detail, cause)
  }
}

/** One session for the whole app: the desk is a device, not a cue. */
export const sqNative = new SqNativeEngine()
