import { createServer, connect, type Server, type Socket } from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { describe } from '../bus/ServiceHost'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import {
  HEARTBEAT_MS,
  MAX_MESSAGE_BYTES,
  REDUNDANCY_PROTOCOL,
  decodeMessage,
  defaultRedundancySettings,
  encodeMessage,
  isDigest,
  peerStatus,
  prefersOutgoing,
  shouldTakeOver,
  type HelloMessage,
  type PeerMessage,
  type RedundancyDigest,
  type RedundancySettings,
  type RedundancyStatus,
  type ShowNotice,
  type UnstampedNotice
} from '../../shared/redundancy'
import type { ShowSettings } from '../../shared/show'

/**
 * How often the partner's silence is looked at. A quarter of a second is four looks
 * inside the shortest timeout the settings allow, so a machine that stops answering is
 * noticed when it happened rather than when the clock next came round.
 */
const CHECK_MS = 250

/** How long after a failed dial the partner is tried again. */
const RETRY_MS = 2000

export interface RedundancyOptions {
  /**
   * This machine's half of the pair. Read when the service starts and whenever the
   * operator changes it: the role and the partner's address belong to the machine,
   * because both machines of a pair run the same workspace file.
   */
  settings?: () => RedundancySettings
  /** The clock the silence is measured on. */
  now?: () => number
  /** Shortened by tests that cannot wait half a second for a beat. */
  heartbeatMs?: number
  checkMs?: number
  retryMs?: number
}

/** One socket between this machine and its partner, either end of the pair. */
interface PeerConnection {
  socket: Socket
  outgoing: boolean
  hello: HelloMessage | null
  buffer: string
  /**
   * A line's characters can arrive split across two reads, and decoding each chunk on its
   * own would turn a byte pair into U+FFFD on both machines — a show name or a cue name
   * that no longer matches the sender's, which the pair reads as "the cue lists differ".
   * The decoder holds the partial character until the rest of it arrives.
   */
  decoder: StringDecoder
}

/** What this machine has heard from its partner. */
interface PeerFacts {
  hello: HelloMessage | null
  digest: RedundancyDigest | null
  lastHeardAt: number
  everHeard: boolean
  socket: Socket | null
}

/**
 * Redundant playback: this machine's half of a pair of machines running the same show.
 *
 * Both halves run the whole app, so what crosses the network is state rather than sound
 * — which cue is running, how far into its file, what the operator has selected. The
 * machine that drives publishes its show five times a second; the machine standing by
 * keeps that mirror, warms the same media, and takes the show over when its partner
 * stops answering. The decision to take it is made here, where the socket is, and the
 * window is told afterwards: a takeover that waited for a window to agree would be no
 * use in the one situation it exists for.
 *
 * Nothing about a show is decided here. The cue list lives in the window, so this
 * service mirrors and announces, and the window works out what can be picked up.
 */
export class RedundancyService implements ShowService {
  readonly id = 'redundancy'
  readonly label = 'Redundant playback'
  readonly pro = true
  /**
   * None: redundancy's role and partner are the machine's rather than the show's — the
   * service reads them from its own settings, handed in as options — so no configure of
   * the show's settings may restart it. AD-14.
   */
  readonly settingsSections = [] as const

  private context: ServiceContext | null = null
  private config: RedundancySettings = defaultRedundancySettings()
  private server: Server | null = null
  private connections = new Set<PeerConnection>()
  private peer: PeerFacts = { hello: null, digest: null, lastHeardAt: 0, everHeard: false, socket: null }
  /** This machine's own show, as the window last published it. */
  private digest: RedundancyDigest | null = null
  private driving = false
  private term = 0
  /** True once this machine has claimed a show its partner was not driving any more. */
  private tookOver = false
  private lastEvent: string | null = null
  /** The change in who is driving that the window has not been told yet. */
  private pending: ShowNotice | null = null
  /** The last change this machine decided on, kept in the status for a window that reloads. */
  private lastNotice: ShowNotice | null = null
  /** Counts the decisions, so a window can act on each one exactly once. */
  private noticeSeq = 0
  /** The token the missing-token warning was last raised for, so it is raised once. */
  private warnedToken: string | null = null
  /**
   * The partner refused this machine on its own terms — a token that does not match, a
   * machine id it already knows as its own. Nothing this end can do changes that, so
   * dialling it every two seconds for the life of the app would be nothing but noise.
   */
  private refused = false
  private silent = false
  private listening = false
  private beatSeq = 0
  private lastPublished = ''
  private lastState = ''
  private lastDetail = ''
  private beatTimer: NodeJS.Timeout | null = null
  private checkTimer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null

  constructor(private readonly options: RedundancyOptions = {}) {}

  start(context: ServiceContext, _settings: ShowSettings): void {
    this.stop()
    // The operator may have fixed what caused the refusal — a token, an address, an id
    // copied from another machine — so a new start is the moment to try again.
    this.refused = false
    this.context = context
    const config = (this.options.settings ?? defaultRedundancySettings)()
    // A machine whose role the operator has changed is not the machine that took the
    // show over any more: flipping the role is the instruction to give it back.
    if (config.role !== this.config.role) this.tookOver = false
    this.config = config
    this.driving = this.tookOver || config.role === 'live'

    if (!config.enabled) {
      // The window is told the pair is off rather than left holding the last thing it
      // heard: a machine that has been unpaired is not a machine with a partner it has
      // gone quiet on.
      context.setState('stopped', 'disabled')
      this.publish()
      return
    }

    // Raised when the machine's token changes rather than on every start: a show being
    // saved twice is not two warnings, and the fact has not changed between them.
    if (config.token !== this.warnedToken) {
      this.warnedToken = config.token
      if (config.token === '') {
        context.bus.alert(
          'warning',
          this.id,
          'Redundant playback: no token set, so any machine on this network that finds the port can claim the pair'
        )
      }
    }
    this.bind(context)
    this.dial()
    this.beatTimer = setInterval(() => this.sendBeat(), this.options.heartbeatMs ?? HEARTBEAT_MS)
    this.beatTimer.unref?.()
    this.checkTimer = setInterval(() => this.check(), this.options.checkMs ?? CHECK_MS)
    this.checkTimer.unref?.()
    this.publish()
  }

  stop(): void {
    for (const timer of [this.beatTimer, this.checkTimer, this.retryTimer]) clearInterval(timer ?? undefined)
    clearTimeout(this.retryTimer ?? undefined)
    this.beatTimer = null
    this.checkTimer = null
    this.retryTimer = null
    // Before the sockets are closed, so nothing they do on the way out arms a timer this
    // stop has already passed: a stopped machine does not dial anybody.
    this.context = null

    for (const connection of [...this.connections]) this.close(connection, 'this machine stopped')
    this.connections.clear()
    this.server?.close()
    this.server = null
    this.listening = false
    this.peer = { hello: null, digest: null, lastHeardAt: 0, everHeard: false, socket: null }
    this.silent = false
    this.lastPublished = ''
    this.lastState = ''
    clearTimeout(this.retryTimer ?? undefined)
    this.retryTimer = null
  }

  /**
   * `publish` carries this machine's show, which the window owns and sends on every
   * change; `status` answers with what this machine has heard right now, for a panel that
   * is open and reading it; `takeover` is the operator taking the show from a partner that
   * is still answering, and `release` hands it back.
   */
  async command(action: string, payload?: unknown): Promise<unknown> {
    // A stopped machine has no partner and no timer: a takeover taken here would be a
    // decision nothing could act on, and it would surface later as a notice from another
    // shift. The operator is told instead — except when asking what has been heard, which
    // a stopped machine can answer truthfully.
    if (this.context === null && action !== 'publish' && action !== 'status') {
      throw new Error('Redundant playback is not running on this machine')
    }
    switch (action) {
      case 'publish': {
        if (!isDigest(payload)) throw new Error('That is not a show mirror')
        this.digest = payload
        this.publish()
        return { driving: this.driving, term: this.term }
      }
      case 'status':
        // Asked for, not announced: the age of a partner's silence is the panel's to
        // watch, and it is a reading rather than an event.
        return this.status()
      case 'takeover':
        return this.take(this.now(), 'the operator took the show')
      case 'release':
        return this.release()
      default:
        throw new Error(`Unknown action "${action}"`)
    }
  }

  // ── The sockets ─────────────────────────────────────────────────────────────

  private bind(context: ServiceContext): void {
    try {
      const server = createServer(socket => this.attach(socket, false))
      server.on('error', error => {
        this.listening = false
        this.server = null
        context.setState('degraded', `port ${this.config.port}: ${describe(error)}`)
        context.bus.alert('warning', this.id, `Redundant playback: port ${this.config.port}: ${describe(error)}`)
      })
      server.on('listening', () => {
        this.listening = true
        this.publish()
      })
      server.listen(this.config.port, '0.0.0.0')
      this.server = server
    } catch (error) {
      context.setState('degraded', describe(error))
    }
  }

  private dial(): void {
    if (this.config.peerHost === '') return
    const socket = connect(this.config.peerPort, this.config.peerHost)
    this.attach(socket, true)
  }

  /**
   * Takes a socket into the pair. Both ends dial each other, so a hello is what decides
   * which of the two connections is the one kept — and that decision is made the same
   * way at both ends, from the two machine ids.
   */
  private attach(socket: Socket, outgoing: boolean): void {
    const connection: PeerConnection = { socket, outgoing, hello: null, buffer: '', decoder: new StringDecoder('utf8') }
    this.connections.add(connection)
    socket.setNoDelay(true)
    socket.on('data', chunk => this.receive(connection, chunk))
    socket.on('error', () => this.detach(connection))
    socket.on('close', () => this.detach(connection))

    // Only the socket this machine dialled is greeted here. What this machine says
    // about itself carries the token, and the listener answers every address that
    // reaches it — so a socket somebody else opened is greeted back *after* it has
    // proved it knows that token, never before. (See `onHello`.)
    if (outgoing) this.greet(connection)
  }

  /** What this machine says about itself: who it is, which half, and the shared token. */
  private greet(connection: PeerConnection): void {
    this.write(connection, {
      t: 'hello',
      protocol: REDUNDANCY_PROTOCOL,
      id: this.config.id,
      name: this.config.name,
      role: this.config.role,
      driving: this.driving,
      term: this.term,
      token: this.config.token
    })
  }

  private detach(connection: PeerConnection): void {
    if (!this.connections.delete(connection)) return
    connection.socket.destroy()
    this.forget(connection)
  }

  /**
   * A connection is gone — closed by the partner, refused, or dropped — and what follows
   * is decided here rather than at each of the ways it can happen. A dial nobody answered
   * and a partner that has gone are both dialled again: a machine that comes back is not
   * something the operator should have to re-pair by hand, and which of the pair's two
   * sockets was in use decides nothing about who may dial.
   */
  private forget(connection: PeerConnection): void {
    const wasPeer = this.peer.socket === connection.socket
    if (wasPeer) this.peer.socket = null
    // A machine whose own port was taken is degraded, not finished: it is still paired by
    // dialling, and its partner coming back is still its business.
    if (this.context === null || this.refused) return
    if (wasPeer || connection.outgoing) this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      // The partner may have come back on another socket in the meantime — a machine
      // that has dialled this one is answered rather than dialled twice.
      if (this.peer.socket === null) this.dial()
    }, this.options.retryMs ?? RETRY_MS)
    this.retryTimer.unref?.()
  }

  private write(connection: PeerConnection, message: PeerMessage): void {
    if (connection.socket.destroyed) return
    connection.socket.write(encodeMessage(message))
  }

  private close(connection: PeerConnection, reason: string): void {
    this.write(connection, { t: 'bye', reason })
    this.connections.delete(connection)
    connection.socket.end()
    this.forget(connection)
  }

  private receive(connection: PeerConnection, chunk: Buffer): void {
    connection.buffer += connection.decoder.write(chunk)
    // A partner sends a line at a time. Anything past a message is not a partner that
    // has come unstuck, and buffering it would be this machine taken down by whoever
    // found the port.
    if (connection.buffer.length > MAX_MESSAGE_BYTES) {
      this.close(connection, 'that message was too long')
      return
    }
    let end = connection.buffer.indexOf('\n')
    while (end >= 0) {
      const line = connection.buffer.slice(0, end)
      connection.buffer = connection.buffer.slice(end + 1)
      const message = decodeMessage(line)
      if (message) this.handle(connection, message)
      end = connection.buffer.indexOf('\n')
    }
  }

  private handle(connection: PeerConnection, message: PeerMessage): void {
    switch (message.t) {
      case 'hello':
        this.onHello(connection, message)
        return
      case 'beat':
        this.onBeat(connection, message)
        return
      case 'bye':
        this.close(connection, message.reason)
        return
      case 'refuse':
        this.refused = true
        this.lastEvent = `the machine at ${this.peerAddress()} refused this one: ${message.reason}`
        this.close(connection, 'refused')
        this.publish()
        return
    }
  }

  private onHello(connection: PeerConnection, message: HelloMessage): void {
    if (message.protocol !== REDUNDANCY_PROTOCOL) {
      this.refuse(connection, `this machine speaks version ${REDUNDANCY_PROTOCOL}`)
      return
    }
    if (message.token !== this.config.token) {
      this.refuse(connection, 'the token does not match')
      return
    }
    if (message.id === this.config.id) {
      this.refuse(connection, 'that is this machine')
      return
    }
    // One partner at a time. A machine that is not the partner is turned away while the
    // partner is answering, and the refusal says which machine it came from — an
    // operator who has copied a configuration onto a third machine needs to know that
    // rather than watch two of them fight.
    if (this.peer.hello && this.peer.hello.id !== message.id && this.peerAlive()) {
      this.refuse(connection, `${this.peer.hello.name} is this machine's partner`)
      return
    }
    // Both ends dial each other, so the same partner can turn up on two sockets. Each
    // end keeps the one the lower id opened — but only while there are two of them: a
    // partner reachable in one direction only still has a link, and dropping the sole
    // socket it has would leave the pair with nothing.
    const keepOutgoing = prefersOutgoing(this.config.id, message.id)
    const others = [...this.connections].filter(
      candidate => candidate !== connection && candidate.hello?.id === message.id
    )
    if (others.length > 0) {
      if (connection.outgoing !== keepOutgoing) {
        this.close(connection, 'the other socket is the one in use')
        return
      }
      for (const other of others) this.close(other, 'the other socket is the one in use')
    }

    // The peer has proved it knows the token: it is answered in kind, on the socket it
    // opened.
    if (!connection.outgoing) this.greet(connection)

    const fresh = this.peer.hello?.id !== message.id
    connection.hello = message
    this.peer.hello = message
    this.peer.socket = connection.socket
    this.peer.lastHeardAt = this.now()
    this.peer.everHeard = true
    if (fresh) {
      this.lastEvent = `${message.name} is here, ${message.role === 'live' ? 'running the show' : 'standing by'}`
      this.silent = false
    }
    this.updateDriving()
    this.publish()
  }

  private onBeat(connection: PeerConnection, message: { seq: number; term: number; driving: boolean; digest: RedundancyDigest | null }): void {
    // A beat from a socket that has not said who it is, or from one that is not the
    // partner, is not this machine's business.
    if (!connection.hello || connection.hello.id !== this.peer.hello?.id) return
    if (this.peer.socket !== null && this.peer.socket !== connection.socket) return

    connection.hello = { ...connection.hello, driving: message.driving, term: message.term }
    this.peer.hello = connection.hello
    this.peer.lastHeardAt = this.now()
    this.peer.everHeard = true
    if (message.digest) this.peer.digest = message.digest
    if (this.silent) {
      this.silent = false
      this.lastEvent = `${connection.hello.name} is answering again`
      this.context?.bus.alert('info', this.id, `Redundant playback: ${connection.hello.name} is answering again`)
    }
    this.updateDriving()
    this.publish()
  }

  private refuse(connection: PeerConnection, reason: string): void {
    this.write(connection, { t: 'refuse', reason })
    this.lastEvent = `refused a machine: ${reason}`
    this.connections.delete(connection)
    connection.socket.end()
    // The operator is watching for exactly this: a machine at the other end of the
    // network that is not the partner, and the reason it was turned away.
    this.publish()
  }

  // ── What this machine is doing ──────────────────────────────────────────────

  private sendBeat(): void {
    if (this.context === null) return
    for (const connection of this.connections) {
      if (!connection.hello) continue
      this.write(connection, {
        t: 'beat',
        seq: this.beatSeq,
        term: this.term,
        driving: this.driving,
        digest: this.digest
      })
      this.beatSeq += 1
    }
  }

  /**
   * Looks at the partner. A partner that has gone quiet is the one thing this service
   * exists for: the alarm is raised once per outage, the machine's state says so, and a
   * standby configured to take over does it here rather than waiting for a window.
   */
  private check(): void {
    const now = this.now()
    const alive = this.peerAlive()
    if (this.peer.everHeard && !alive && !this.silent) {
      this.silent = true
      const name = this.peer.hello?.name ?? 'the partner'
      const quietFor = now - this.peer.lastHeardAt
      this.lastEvent = `${name} went quiet at ${clockTime(now)}`
      // Who drives is recomputed on the silence, not only on the next hello: the machine
      // the taker stood down is the one that has to carry on, and the taker is not coming
      // back to release it.
      this.updateDriving()
      this.context?.bus.alert(
        'warning',
        this.id,
        `Redundant playback: ${name} has not answered for ${(quietFor / 1000).toFixed(1)} s`
      )
      if (shouldTakeOver({
        enabled: this.config.enabled,
        role: this.config.role,
        takeover: this.config.takeover,
        driving: this.driving,
        peerEverHeard: this.peer.everHeard,
        peerAlive: alive
      })) {
        this.take(now, 'the live machine stopped answering')
        return
      }
    }
    this.publish()
  }

  /**
   * Claims the show. The term is what makes two machines agree about who is driving: it
   * is bumped above whatever the partner had claimed, so a machine that comes back and
   * finds its show already taken stays a standby instead of both of them running.
   */
  private take(now: number, reason: string): { driving: boolean; term: number; adopted: boolean } {
    const already = this.driving
    if (!already) {
      this.term = Math.max(this.term, this.peer.hello?.term ?? 0) + 1
      this.tookOver = true
      this.driving = true
      const quietFor = this.peer.everHeard ? now - this.peer.lastHeardAt : 0
      this.lastEvent = `took the show over at ${clockTime(now)} (${reason})`
      this.context?.bus.alert('warning', this.id, `Redundant playback: this machine has the show — ${reason}`)
      this.pending = this.notice({
        kind: 'takeover',
        at: now,
        silentMs: quietFor,
        digest: this.peer.digest,
        reason,
        term: this.term
      })
      this.publish()
    }
    return { driving: this.driving, term: this.term, adopted: !already }
  }

  /** Gives the show back, so a live machine that has come back can drive again. */
  private release(): { driving: boolean; term: number } {
    const at = this.now()
    this.tookOver = false
    // Who is driving is worked out before the line is written: the operator's own action
    // is the more useful thing for this machine to be saying afterwards.
    this.updateDriving()
    this.lastEvent = `the show was handed back at ${clockTime(at)}`
    this.context?.bus.alert('info', this.id, 'Redundant playback: the show was handed back')
    // A machine that has given the show back is not the sound any more, and says why in
    // its own words rather than the partner's.
    if (!this.driving) {
      this.pending = this.notice({
        kind: 'stand-down',
        at,
        term: this.term,
        reason: 'the show was handed back'
      })
    }
    this.publish()
    return { driving: this.driving, term: this.term }
  }

  /**
   * Who is driving. A machine configured as the live one drives unless its partner is
   * driving under a higher term — which is how the machine that took the show over keeps
   * it when the one it took it from comes back.
   */
  private updateDriving(): void {
    const peer = this.peer.hello
    // A partner that has stopped answering is not running the show any more, whatever it
    // claimed before it went: holding the live machine back for it would leave the pair
    // with neither of them driving — the one state a pair exists to prevent. And two
    // takeovers that land on the same term — a partition that healed with both machines
    // having claimed the show — are broken by id, the way the two sockets between the pair
    // are, so both ends compute the same answer and one of them yields.
    const peerHoldsShow = peer !== null && peer.driving && this.peerAlive() &&
      (peer.term > this.term || (peer.term === this.term && this.config.id > peer.id))
    const suppressed = peerHoldsShow
    if (suppressed && this.tookOver) this.tookOver = false
    const driving = this.tookOver || (this.config.role === 'live' && !suppressed)
    // A machine that has just stopped driving says why — and the window is told, because
    // a machine that is no longer the sound must stop making it. Two machines playing the
    // same cue is the one outcome a pair exists to prevent. Only the partner taking the
    // show over reaches this: handing it back is the operator's own action, and it says
    // so in its own words.
    if (this.driving && !driving && peer && suppressed) {
      this.lastEvent = `${peer.name} is running the show`
      this.pending = this.notice({
        kind: 'stand-down',
        at: this.now(),
        term: peer.term,
        reason: `${peer.name} is running the show`
      })
    }
    this.driving = driving
  }

  private peerAlive(): boolean {
    if (!this.peer.everHeard) return false
    return this.now() - this.peer.lastHeardAt <= this.config.timeoutMs
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private peerAddress(): string {
    return `${this.config.peerHost}:${this.config.peerPort}`
  }

  /**
   * Tells the window what has been heard and what this machine is doing about it. It is
   * published on a change rather than on every look — a status four times a second would
   * push the show's own events out of the history for nothing — and the window works out
   * how long ago the partner was heard from the stamp on the event.
   */
  /** Stamps a decision with the next number in this machine's own count. */
  private notice(notice: UnstampedNotice): ShowNotice {
    this.noticeSeq += 1
    return { ...notice, seq: this.noticeSeq }
  }

  /**
   * Publishes the status, and the change in who is driving with it. The notice travels in
   * the status rather than beside it because the window that has to act on it may not have
   * been listening when it was made — a renderer that crashed mid-takeover comes back to a
   * status, and only the status is guaranteed to still be there.
   */
  private publish(): void {
    const context = this.context
    if (!context) return
    if (this.pending !== null) {
      this.lastNotice = this.pending
      this.pending = null
    }
    const status = this.status()
    const key = statusKey(status)
    if (key === this.lastPublished) return
    this.lastPublished = key
    context.bus.publish({ kind: 'redundancy', at: status.at, status })

    // An unpaired machine has no row to rewrite: `start` has already said it is stopped
    // and disabled, and the status published above is what the settings tab reads.
    if (!this.config.enabled) return

    // The service's own row in the monitor says the same thing in one line. It is set
    // only when it changes, so the row is not rewritten four times a second with the
    // same sentence.
    const state = status.peer === null
      ? (this.config.peerHost === '' ? 'running' : 'degraded')
      : status.peer.alive
        ? 'running'
        : 'degraded'
    if (state !== this.lastState || status.detail !== this.lastDetail) {
      this.lastState = state
      this.lastDetail = status.detail
      context.setState(state, status.detail)
    }
  }

  private status(): RedundancyStatus {
    const now = this.now()
    const peer = peerStatus(
      {
        hello: this.peer.hello,
        digest: this.peer.digest,
        lastHeardAt: this.peer.lastHeardAt,
        everHeard: this.peer.everHeard
      },
      { digest: this.digest, now, timeoutMs: this.config.timeoutMs }
    )
    return {
      at: now,
      enabled: this.config.enabled,
      role: this.config.role,
      name: this.config.name,
      driving: this.driving,
      term: this.term,
      listening: this.listening,
      detail: this.describe(peer),
      peer,
      lastEvent: this.lastEvent,
      lastNotice: this.lastNotice
    }
  }

  /** The one line the monitor and the settings tab show. */
  private describe(peer: RedundancyStatus['peer']): string {
    if (!this.config.enabled) return `${this.config.name}: not paired — this machine runs the show on its own`
    const half = this.driving ? 'running the show' : 'standing by'
    if (peer === null) {
      const where = this.listening
        ? `listening on ${this.config.port}`
        : `not listening (port ${this.config.port})`
      return this.config.peerHost === ''
        ? `${half} — ${where}, no partner address`
        : `${half} — ${where}, nothing answering at ${this.peerAddress()}`
    }
    if (!peer.alive) return `${half} — ${peer.name} has gone quiet`
    // Two machines set to the same half is a configuration mistake, and the one place it
    // shows is here: both halves driving means two shows, and neither driving means the
    // operator's next GO is the only thing that fires anything.
    const both = peer.role === this.config.role
      ? this.config.role === 'live'
        ? ' — both machines are configured as the live one'
        : ' — neither machine is configured to run the show'
      : ''
    return peer.inSync
      ? `${half} — ${peer.name} in sync${both}`
      : `${half} — ${peer.name} out of sync: ${peer.note}${both}`
  }
}

function clockTime(at: number): string {
  return new Date(at).toTimeString().slice(0, 8)
}

/**
 * The status without the numbers that move on their own — the time it was taken, and how
 * long the partner has been quiet — so that a heartbeat arriving is not a change the
 * window is told about.
 *
 * The silence is not thrown away, though: it is counted in steps of a second, because it
 * is the one fact that changes with nothing happening at all, and the panel reads it. A
 * partner that is answering keeps its silence inside the first step and never reaches the
 * window; a partner that has gone gets a status a second for as long as it stays gone, so
 * "last heard 4.2 s ago" is true when it is read rather than frozen at the moment it was
 * written.
 */
function statusKey(status: RedundancyStatus): string {
  return JSON.stringify({
    ...status,
    at: 0,
    // The last notice is part of the status, but its arrival is already a change to
    // `lastEvent` and to who is driving; keeping only its number out of the key stops the
    // ageing of an old notice from looking like news.
    lastNotice: status.lastNotice === null ? null : status.lastNotice.seq,
    // And the silence is left out for the same reason: it is the one number that moves
    // with nothing happening, and a status a second for every second a partner is quiet
    // would fill the run log with rows that say the same thing. The panel watches that
    // number by asking for the status on its own tick — see the `status` command — so the
    // event stream stays a record of what changed.
    peer: status.peer === null ? null : { ...status.peer, silentMs: 0 }
  })
}
