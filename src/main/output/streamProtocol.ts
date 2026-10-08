// The scheme a camera cue's network stream reaches its output through: `cuerunner-stream:`.
//
// An output draws every picture into WebGL and the acceptance suite reads its pixels back, and
// Chromium refuses both for a picture from another origin that does not say it may be shared —
// which no IP camera says. So the output never reads the camera itself: it reads this scheme,
// main fetches the stream (with the camera's login, if its address carried one) and hands the
// bytes on with the one header that makes them drawable. Range requests pass through, so a
// progressive HTTP video seeks, and a stream's bytes are piped, never gathered, so an MJPEG
// stream that never ends is never buffered.
//
// Main fetches nothing it was not told to: an origin is allowed when a camera cue naming it is
// put on an output (`allow`), and a request for any other origin is refused. The page asking is
// the app's own, but the address came from a show file, and a show file is not trusted to make
// main fetch whatever it names.

import { STREAM_SCHEME, streamOrigin, streamTarget } from '../../shared/camera'

/** How many camera origins are remembered at once: past it the oldest is forgotten. */
export const MAX_STREAM_ORIGINS = 64

/** The origins main will fetch a stream from, each with the login its cue's address carried. */
export class StreamAllowance {
  private readonly origins = new Map<string, string | null>()

  /** A camera cue naming `url` went up: its origin may be fetched from, with its login. */
  allow(url: string): void {
    const origin = streamOrigin(url)
    if (origin === null) return
    let authorization: string | null = null
    try {
      const parsed = new URL(url.trim())
      if (parsed.username !== '' || parsed.password !== '') {
        const user = decodeURIComponent(parsed.username)
        const password = decodeURIComponent(parsed.password)
        authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
      }
    } catch {
      return
    }
    this.origins.delete(origin)
    this.origins.set(origin, authorization)
    while (this.origins.size > MAX_STREAM_ORIGINS) {
      const oldest = this.origins.keys().next().value
      if (oldest === undefined) break
      this.origins.delete(oldest)
    }
  }

  /** What a request on the scheme fetches, and with what login; null for one it may not. */
  target(proxied: string): { url: string; authorization: string | null } | null {
    const url = streamTarget(proxied)
    if (url === null) return null
    const origin = streamOrigin(url)
    if (origin === null || !this.origins.has(origin)) return null
    return { url, authorization: this.origins.get(origin) ?? null }
  }
}

/** The headers of the camera's answer that are passed on: what a media element reads. */
const PASSED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']

/** One request on the scheme, answered. Exported for the tests; main installs it. */
export async function answerStreamRequest(
  url: string,
  rangeHeader: string | null,
  allowance: StreamAllowance,
  fetcher: (url: string, init: { headers: Record<string, string> }) => Promise<Response>
): Promise<Response> {
  const target = allowance.target(url)
  if (target === null) return new Response('not a stream a cue names', { status: 403 })
  const headers: Record<string, string> = {}
  if (rangeHeader !== null) headers['Range'] = rangeHeader
  if (target.authorization !== null) headers['Authorization'] = target.authorization
  let answer: Response
  try {
    answer = await fetcher(target.url, { headers })
  } catch (error) {
    return new Response(`the stream could not be reached: ${error instanceof Error ? error.message : String(error)}`, { status: 502 })
  }
  const passed: Record<string, string> = {
    // The pages that read this are the app's own, on another origin than this scheme: an output
    // draws the frame into WebGL, which refuses a picture that is not shared with it.
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  }
  for (const name of PASSED_HEADERS) {
    const value = answer.headers.get(name)
    if (value !== null) passed[name] = value
  }
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: passed })
}

/** The privileges the scheme is registered with, before the app is ready. */
export const STREAM_SCHEME_PRIVILEGES = {
  scheme: STREAM_SCHEME,
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true }
} as const

/** Installs the handler on the default session. Called once the app is ready. */
export function installStreamProtocol(
  protocol: Electron.Protocol,
  allowance: StreamAllowance,
  fetcher: (url: string, init: { headers: Record<string, string> }) => Promise<Response>
): void {
  protocol.handle(STREAM_SCHEME, request => answerStreamRequest(request.url, request.headers.get('range'), allowance, fetcher))
}
