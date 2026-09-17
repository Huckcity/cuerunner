/**
 * A network cue's request and result, as they cross the IPC boundary.
 *
 * The request is made by the main process, not by the page: a console on the LAN has no
 * reason to send CORS headers, and a cue has to keep working when the window is busy or
 * has been reloaded. The shapes live here because both processes and the preload bridge
 * read them.
 */

export interface NetworkRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  /** Milliseconds before the request is abandoned. The cue inspector defaults to 5000. */
  timeout?: number
  /** The cue the request belongs to, so a stopped cue can cancel what it started. */
  requestId?: string
}

export interface NetworkResult {
  /**
   * False only when no HTTP response arrived — DNS, refused connection, TLS, timeout or
   * cancellation. A 404 or a 500 is a response: it comes back with the status set, so
   * the cue decides what it means.
   */
  ok: boolean
  status: number | null
  statusText: string
  body: string
  error: string | null
}
