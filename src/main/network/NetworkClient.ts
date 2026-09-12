/**
 * HTTP for network cues, run in the main process.
 *
 * A network cue used to be a `fetch()` in the renderer, which meant the request was
 * subject to the page's origin: a cue pointed at a console on the LAN was answered with
 * a CORS failure rather than the console's reply, because that console has no reason to
 * send `Access-Control-Allow-Origin`. Requests from here are ordinary HTTP clients, and
 * they keep working when the renderer is busy — showing a modal, running a script — or
 * gone.
 */

import type { NetworkRequest, NetworkResult } from '../../renderer/src/types/network'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface NetworkClientOptions {
  fetch?: FetchLike
  defaultTimeoutMs?: number
  /** Characters of response body kept. Follows the renderer's 4000-character rule. */
  bodyLimit?: number
}

const DEFAULT_TIMEOUT_MS = 5000
const BODY_LIMIT = 4000

export class NetworkClient {
  private readonly fetchImpl: FetchLike
  private readonly defaultTimeoutMs: number
  private readonly bodyLimit: number
  private readonly inFlight = new Map<string, AbortController>()

  constructor(options: NetworkClientOptions = {}) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init))
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.bodyLimit = options.bodyLimit ?? BODY_LIMIT
  }

  async request(request: NetworkRequest): Promise<NetworkResult> {
    const timeout = request.timeout ?? this.defaultTimeoutMs
    const controller = new AbortController()
    if (request.requestId !== undefined) this.inFlight.set(request.requestId, controller)

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeout)

    try {
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        // A GET with a body is a request the server may well reject; the cue has no body
        // field for GET for the same reason.
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        signal: controller.signal,
        redirect: 'follow'
      })

      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        body: await this.readBody(response),
        error: null
      }
    } catch (error) {
      if (timedOut) {
        return failure(`Request timed out after ${timeout}ms`)
      }
      if (controller.signal.aborted) {
        return failure('Request cancelled')
      }
      return failure(describeFetchError(error))
    } finally {
      clearTimeout(timer)
      if (request.requestId !== undefined) this.inFlight.delete(request.requestId)
    }
  }

  /**
   * Abandons a request that is still in flight. Returns false when it had already
   * finished, which is not an error: cancellation races the response by design.
   */
  cancel(requestId: string): boolean {
    const controller = this.inFlight.get(requestId)
    if (!controller) return false
    this.inFlight.delete(requestId)
    controller.abort()
    return true
  }

  /** Quitting: no request may keep the process alive or outlive the window. */
  close(): void {
    for (const controller of this.inFlight.values()) controller.abort()
    this.inFlight.clear()
  }

  /**
   * Reads at most `bodyLimit` characters and cancels the stream as soon as the budget is
   * spent, so a cue pointed at a large file does not pull it into memory.
   */
  private async readBody(response: Response): Promise<string> {
    if (!response.body) return ''

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let body = ''

    try {
      while (body.length < this.bodyLimit) {
        const { done, value } = await reader.read()
        if (done) return body
        if (value) body += decoder.decode(value, { stream: true })
      }

      // Budget spent: one more read tells whether the body continues. Either way the
      // stream is cancelled rather than drained.
      const { done } = await reader.read()
      if (done && body.length <= this.bodyLimit) return body
      return `${body.slice(0, this.bodyLimit)}\n… (truncated)`
    } finally {
      await reader.cancel().catch(() => {})
    }
  }
}

function failure(error: string): NetworkResult {
  return { ok: false, status: null, statusText: '', body: '', error }
}

/**
 * `fetch` reports every transport failure as the same "fetch failed"; the reason lives
 * on the cause, and "connect ECONNREFUSED" is the part an operator needs.
 */
function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = (error as Error & { cause?: unknown }).cause
  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`
  }
  const code = (cause as { code?: string } | undefined)?.code
  return code ? `${error.message}: ${code}` : error.message
}
