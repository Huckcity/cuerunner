import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import type { ClientRequestArgs, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { PeerCertificate } from 'node:tls'
import type { TelemetryChannel } from '../../shared/show'
import { channelsFrom, subscriptionPaths } from './mapping'
import type { Resources } from './mapping'
import { createSseParser } from './sse'

// One EW-DX receiver, kept live. The receiver pushes what changes over a single SSCv2
// subscription, so this holds that session open, keeps the last thing it said about every
// path, and answers `snapshot()` from that cache. The service above it keeps polling on its
// own interval — which is also what keeps the receiver's 20 Hz audio level from reaching
// the bus — and a session that is down makes the snapshot throw, which is the outage the
// service already knows how to raise once and clear.

export interface EwDxOptions {
  /** `https://host` for a receiver; a test double may be `http://`. */
  origin: string
  /** The API user. Third-party access has to be enabled in WSM before a receiver has one. */
  username?: string
  password: string
  /** SHA-256 fingerprint of the certificate this receiver is trusted to present. */
  pinnedFingerprint?: string
  /** Called once with the fingerprint of a receiver nobody has pinned yet. */
  onFingerprint?: (fingerprint: string) => void
  /**
   * The serial of the receiver this is meant to be. An address says where a receiver was, and a
   * lease that changed can hand it to another one: when what answers has a different serial it is
   * refused before the password is sent, rather than logged into as if it were the same.
   */
  expectedSerial?: string
  /** Called with the serial of whatever answered, once it has been checked. */
  onSerial?: (serial: string) => void
  heartbeatMs?: number
  requestTimeoutMs?: number
  /** First and longest wait before a dropped session is reopened. */
  retryMs?: readonly [number, number]
}

/** The most channels any EW-DX receiver has: an EM 4. */
const MAX_CHANNELS = 4
/** No reply a receiver gives is bigger than this; a peer that sends more is not a receiver. */
const MAX_BODY = 1024 * 1024

class RefusedError extends Error {}

/** A different receiver is at the address: not a fault of the link, and not the one that was asked for. */
class WrongReceiverError extends RefusedError {}

/**
 * Why a session is down, for the layer above: a receiver that has *gone from where it was* is
 * worth looking for elsewhere; one that refused (a wrong password, a certificate that changed) is
 * not, because moving does not change its answer.
 */
export type FailureKind = 'unreachable' | 'wrong-receiver' | 'refused' | 'other'

export class EwDxError extends Error {
  constructor(message: string, readonly kind: FailureKind) {
    super(message)
    this.name = 'EwDxError'
  }
}

/** What the words `describeNetworkError` says mean for finding the receiver again. */
const UNREACHABLE = new Set([
  'connection refused',
  'receiver unreachable',
  'connection lost',
  'receiver did not answer in time',
  'receiver closed the connection'
])

function classify(error: unknown, described: string): FailureKind {
  if (error instanceof WrongReceiverError) return 'wrong-receiver'
  if (error instanceof RefusedError) return 'refused'
  return UNREACHABLE.has(described) ? 'unreachable' : 'other'
}

/**
 * An agent that does not hand a connection to the HTTP layer until the certificate has been
 * checked, so nothing — least of all the password in the first request — is written to a
 * receiver that has not been recognised.
 *
 * The check has to live here. Node calls `checkServerIdentity` only for a chain it already
 * trusts, and a receiver's certificate is self-signed: with `rejectUnauthorized: false` that
 * hook is simply never called, and a pin kept in it pins nothing. The connection is made
 * with the chain left unverified and the fingerprint is what is decided on, once the
 * handshake is done and before the socket is passed on.
 */
class PinnedAgent extends https.Agent {
  constructor(private readonly verify: (certificate: PeerCertificate) => Error | undefined) {
    super({ keepAlive: false })
  }

  createConnection(
    options: ClientRequestArgs,
    callback?: (error: Error | null, stream: Duplex) => void
  ): Duplex | null | undefined {
    let settled = false
    const settle = (error: Error | null, stream: Duplex): void => {
      if (settled) return
      settled = true
      callback?.(error, stream)
    }
    const socket = tls.connect({
      ...(options as tls.ConnectionOptions),
      // The chain proves nothing about a self-signed receiver; the pin is the proof.
      rejectUnauthorized: false
    })
    socket.once('secureConnect', () => {
      const error = this.verify(socket.getPeerCertificate())
      if (error) {
        socket.destroy()
        settle(error, socket)
      } else {
        settle(null, socket)
      }
    })
    socket.once('error', error => settle(error, socket))
    // Asynchronous: the socket is delivered through the callback once it has been checked.
    return undefined
  }
}

/**
 * What a socket error means to the person reading the alarm. Node's own wording — `aborted`,
 * `connect ECONNREFUSED 10.0.0.4:443` — names the mechanism, and the operator needs the
 * situation: the alarm reads "Rack A: connection lost", not "Rack A: aborted".
 */
export function describeNetworkError(error: unknown): string {
  if (error instanceof RefusedError) return error.message
  const code = (error as { code?: unknown } | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'ECONNREFUSED') return 'connection refused'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ENOTFOUND') return 'receiver unreachable'
  if (code === 'ECONNRESET' || code === 'EPIPE' || message === 'aborted') return 'connection lost'
  if (code === 'ETIMEDOUT') return 'receiver did not answer in time'
  return message
}

export class EwDxClient {
  private readonly options: EwDxOptions
  private readonly resources = new Map<string, unknown>()
  private serial = ''
  private ready = false
  /** Why the session is not up, or undefined while the first connection is still being made. */
  private failure: string | undefined
  private failureKind: FailureKind = 'other'
  private stopped = true
  private abort: AbortController | null = null
  private waiters: Array<() => void> = []
  private retry: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private delay: number
  /**
   * The certificate this client will talk to. It starts as the stored pin, or as nothing for
   * a receiver never seen; and the first certificate shown becomes the one trusted for the
   * rest of the run, so a reconnect cannot quietly accept a different one.
   */
  private trusted: string | undefined
  /**
   * Which receiver this client is for. It starts as the serial the machine remembered, or as
   * nothing for one never reached; and the first receiver it reaches becomes the one it is for,
   * for the rest of the run — so a lease that changes under a running client cannot hand it a
   * stranger that it then logs into.
   */
  private meant: string | undefined
  private readonly agent = new PinnedAgent(certificate => this.check(certificate))

  constructor(options: EwDxOptions) {
    this.options = options
    this.delay = options.retryMs?.[0] ?? 1000
    this.trusted = options.pinnedFingerprint
    this.meant = options.expectedSerial
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.failure = undefined
    void this.run()
  }

  stop(): void {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    this.abort?.abort(new Error('stopped'))
    this.clear()
    this.release()
  }

  /**
   * What the receiver's linked channels say right now. While the first connection is being
   * made it waits up to `waitMs` for it; once a session has dropped it does not wait, it
   * says why, because the next poll is the retry and the service has an outage to report.
   */
  async snapshot(waitMs: number): Promise<TelemetryChannel[]> {
    if (!this.ready && this.failure === undefined) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, waitMs)
        timer.unref?.()
        this.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    if (!this.ready) {
      throw new EwDxError(this.failure ?? 'receiver did not answer in time', this.failure === undefined ? 'unreachable' : this.failureKind)
    }
    return channelsFrom(this.serial, this.resources as Resources)
  }

  // ── The session ───────────────────────────────────────────────────────────

  private async run(): Promise<void> {
    while (!this.stopped) {
      const controller = new AbortController()
      this.abort = controller
      try {
        await this.session(controller.signal)
        this.failure = 'receiver closed the connection'
        this.failureKind = 'unreachable'
      } catch (error) {
        if (this.stopped) return
        this.failure = describeNetworkError(error)
        this.failureKind = classify(error, this.failure)
        // A refusal is a decision the receiver made, not a fault in the link; waiting
        // longer does not change the answer, so it is retried at the slowest pace.
        if (error instanceof RefusedError) this.delay = this.options.retryMs?.[1] ?? 10_000
      } finally {
        if (this.heartbeat) clearInterval(this.heartbeat)
        this.heartbeat = null
      }
      this.clear()
      this.release()
      if (this.stopped) return
      await new Promise<void>(resolve => {
        this.retry = setTimeout(resolve, this.delay)
        this.retry.unref?.()
      })
      this.delay = Math.min(this.delay * 2, this.options.retryMs?.[1] ?? 10_000)
    }
  }

  private async session(signal: AbortSignal): Promise<void> {
    const identity = await this.getJson('/api/device/identity', false, signal)
    const serial = (identity as { serial?: unknown } | null)?.serial
    if (typeof serial !== 'string' || serial === '') throw new RefusedError('not an EW-DX receiver')
    // The identity is public, so this is learned before any credential leaves: a receiver that is
    // not the one this source was made for never sees the password.
    if (this.meant !== undefined && serial !== this.meant) {
      throw new WrongReceiverError(
        `a different receiver answers here (serial ${serial}, not ${this.meant}) — press Trust again if you replaced it`
      )
    }
    this.meant = serial
    this.options.onSerial?.(serial)

    const version = await this.getJson('/api/ssc/version', false, signal)
    const protocol = String((version as { protocol?: unknown } | null)?.protocol ?? '')
    if (!/^2\./.test(protocol)) throw new RefusedError(`unsupported SSC protocol ${protocol || 'unknown'}`)

    // The receiver has no channel list to ask for; it has channels until one answers 404.
    let channels = 0
    while (channels < MAX_CHANNELS && (await this.status(`/api/channel/${channels}`, signal)) === 200) {
      channels += 1
    }
    if (channels === 0) throw new RefusedError('receiver has no channels')

    const expected = new Set(subscriptionPaths(channels))
    const response = await this.send('GET', '/api/ssc/state/subscriptions', { authorised: true, signal })
    if (response.statusCode !== 200) {
      response.resume()
      throw this.refusal(response.statusCode)
    }
    const location = String(response.headers['content-location'] ?? '')
    if (!location.startsWith('/api/ssc/state/subscriptions/')) {
      response.destroy()
      throw new Error('receiver did not name the subscription')
    }

    const added = await this.send('PUT', `${location}/add`, {
      authorised: true,
      body: JSON.stringify([...expected]),
      signal
    })
    const addedBody = await this.readBody(added)
    if (added.statusCode !== 200) {
      response.destroy()
      throw new Error(`subscription refused (HTTP ${added.statusCode}${addedBody ? `: ${addedBody.slice(0, 120)}` : ''})`)
    }

    const seen = new Set<string>()
    const parser = createSseParser(event => {
      if (event.event !== 'message') return
      let pushed: unknown
      try {
        pushed = JSON.parse(event.data)
      } catch {
        return // a push that is not JSON says nothing; the next one will
      }
      if (typeof pushed !== 'object' || pushed === null) return
      for (const [path, value] of Object.entries(pushed)) {
        this.resources.set(path, value)
        seen.add(path)
      }
      // Every subscribed path has said its first word: the cache is a whole picture now,
      // and not a few readings that arrived before the rest.
      if (!this.ready && [...expected].every(path => seen.has(path))) {
        this.serial = serial
        this.ready = true
        this.failure = undefined
        this.delay = this.options.retryMs?.[0] ?? 1000
        this.release()
      }
    })

    // A receiver with nothing linked sends nothing for long stretches, so silence on the
    // stream proves nothing. A question it has to answer does.
    this.heartbeat = setInterval(() => {
      this.getJson('/api/ssc/version', false, signal).catch(() => response.destroy())
    }, this.options.heartbeatMs ?? 10_000)
    this.heartbeat.unref?.()

    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        response.destroy()
        // Best effort: the session limit is per client, and one left behind is one fewer.
        void this.send('DELETE', location, { authorised: true, signal: undefined })
          .then(res => res.resume())
          .catch(() => undefined)
        reject(signal.reason)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      response.setEncoding('utf8')
      response.on('data', chunk => {
        try {
          parser.feed(chunk)
        } catch (error) {
          response.destroy(error as Error)
        }
      })
      response.on('end', resolve)
      response.on('error', reject)
      response.on('close', resolve)
    })
  }

  // ── Requests ──────────────────────────────────────────────────────────────

  private send(
    method: string,
    path: string,
    options: { authorised?: boolean; body?: string; signal: AbortSignal | undefined }
  ): Promise<IncomingMessage> {
    const url = new URL(path, this.options.origin)
    const secure = url.protocol === 'https:'
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.authorised) {
      const user = this.options.username ?? 'api'
      headers.authorization = `Basic ${Buffer.from(`${user}:${this.options.password}`).toString('base64')}`
    }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(options.body))
    }

    return new Promise((resolve, reject) => {
      const base = {
        method,
        headers,
        hostname: url.hostname,
        port: url.port || (secure ? 443 : 80),
        path: url.pathname,
        agent: false as const
      }
      const request = secure
        ? https.request({ ...base, agent: this.agent }, resolve)
        : http.request(base, resolve)

      const timer = setTimeout(
        () => request.destroy(new Error('receiver did not answer in time')),
        this.options.requestTimeoutMs ?? 5000
      )
      timer.unref?.()
      request.on('response', () => clearTimeout(timer))
      request.on('error', error => {
        clearTimeout(timer)
        reject(error)
      })
      options.signal?.addEventListener('abort', () => request.destroy(options.signal?.reason), { once: true })
      request.end(options.body)
    })
  }

  /** The pin: trust the first certificate a receiver shows, then only that one. */
  private check(cert: PeerCertificate): Error | undefined {
    const presented = cert.fingerprint256
    if (this.trusted === undefined) {
      this.trusted = presented
      this.options.onFingerprint?.(presented)
      return undefined
    }
    if (this.trusted.toUpperCase() !== presented.toUpperCase()) {
      return new RefusedError('certificate changed since it was trusted')
    }
    return undefined
  }

  private refusal(status: number | undefined): Error {
    if (status === 401) return new RefusedError('password rejected')
    if (status === 403) return new RefusedError('not allowed — enable third-party access in WSM')
    return new Error(`HTTP ${status}`)
  }

  private async readBody(response: IncomingMessage): Promise<string> {
    let text = ''
    response.setEncoding('utf8')
    for await (const chunk of response) {
      text += chunk as string
      if (text.length > MAX_BODY) {
        response.destroy()
        throw new Error('reply too large')
      }
    }
    return text
  }

  private async getJson(path: string, authorised: boolean, signal: AbortSignal): Promise<unknown> {
    const response = await this.send('GET', path, { authorised, signal })
    const text = await this.readBody(response)
    if (response.statusCode !== 200) throw this.refusal(response.statusCode)
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('receiver sent something that is not JSON')
    }
  }

  private async status(path: string, signal: AbortSignal): Promise<number | undefined> {
    const response = await this.send('GET', path, { authorised: true, signal })
    await this.readBody(response)
    if (response.statusCode === 401 || response.statusCode === 403) throw this.refusal(response.statusCode)
    return response.statusCode
  }

  // ── State ─────────────────────────────────────────────────────────────────

  /** A session that is gone takes what it said with it: a stale reading is worse than none. */
  private clear(): void {
    this.resources.clear()
    this.ready = false
  }

  private release(): void {
    const waiting = this.waiters
    this.waiters = []
    for (const wake of waiting) wake()
  }
}
