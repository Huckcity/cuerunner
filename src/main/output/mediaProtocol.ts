// The scheme pictures are read through: `cuerunner-media://file/<path>`.
//
// A video element seeks by asking for byte ranges, and a page loaded from the app's own files
// has no business reading arbitrary `file://` URLs (the content policy says `'self'`). So
// media comes through a scheme of the app's own: main answers it, reads only files whose
// names say they are video or images, and answers ranges — a `206` with exactly the bytes
// asked for — so a forty-minute video opens at once and seeks without reading what it skips.
// The scheme is registered as privileged (standard, secure, streamable) before the app is
// ready, which Electron requires; the handler is installed once it is.

import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { extname } from 'node:path'
import { MEDIA_SCHEME, isImageFile, isVideoFile, mediaPathOf } from '../../shared/visual'

/** Content types by extension, for the files the scheme serves. */
const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif'
}

export function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

export type ByteRange = { start: number; end: number }

/**
 * The range a `Range` header asks for, in a file of `size` bytes: `null` for the whole file
 * (no header, or one this does not read), `'unsatisfiable'` for a range outside the file.
 * Only the one-range forms a media element sends are read: `bytes=a-b`, `bytes=a-` and
 * `bytes=-n`.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (header === null) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null
  const [, from, to] = match
  if (from === '' && to === '') return null
  if (from === '') {
    const suffix = Number(to)
    if (suffix <= 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(from)
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1)
  if (start >= size || end < start) return 'unsatisfiable'
  return { start, end }
}

/** Whether a path is one the scheme will serve: a picture, by its name. */
export function servable(filePath: string): boolean {
  return isVideoFile(filePath) || isImageFile(filePath)
}

/** The scheme's answer to one request. Exported for the tests; main installs it. */
export function answerMediaRequest(
  url: string,
  rangeHeader: string | null,
  stat: (path: string) => { size: number; isFile: boolean } | null = defaultStat,
  open: (path: string, range: ByteRange) => ReadableStream = defaultOpen
): Response {
  const filePath = mediaPathOf(url)
  if (filePath === null || !servable(filePath)) return new Response('not a picture', { status: 404 })
  const info = stat(filePath)
  if (info === null || !info.isFile) return new Response('not found', { status: 404 })
  const range = parseRange(rangeHeader, info.size)
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } })
  }
  const whole = { start: 0, end: info.size - 1 }
  const served = range ?? whole
  const headers: Record<string, string> = {
    'Content-Type': contentTypeOf(filePath),
    'Accept-Ranges': 'bytes',
    'Content-Length': String(info.size === 0 ? 0 : served.end - served.start + 1),
    // A show's media is a file on this machine: nothing to cache across runs, and nothing a
    // stale copy would get right after the operator replaces it.
    'Cache-Control': 'no-store',
    // The pages that read this are the app's own, from another origin than this scheme: an
    // output draws a frame into WebGL, which refuses a picture that is not shared with it.
    'Access-Control-Allow-Origin': '*'
  }
  if (range !== null) headers['Content-Range'] = `bytes ${served.start}-${served.end}/${info.size}`
  if (info.size === 0) return new Response(null, { status: 200, headers })
  return new Response(open(filePath, served), { status: range === null ? 200 : 206, headers })
}

function defaultStat(path: string): { size: number; isFile: boolean } | null {
  const stats = statSync(path, { throwIfNoEntry: false })
  return stats === undefined ? null : { size: stats.size, isFile: stats.isFile() }
}

function defaultOpen(path: string, range: ByteRange): ReadableStream {
  return Readable.toWeb(createReadStream(path, { start: range.start, end: range.end })) as ReadableStream
}

/** The privileges the scheme is registered with, before the app is ready. */
export const MEDIA_SCHEME_PRIVILEGES = {
  scheme: MEDIA_SCHEME,
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true }
} as const

/** Installs the handler on the default session. Called once the app is ready. */
export function installMediaProtocol(protocol: Electron.Protocol): void {
  protocol.handle(MEDIA_SCHEME, request => answerMediaRequest(request.url, request.headers.get('range')))
}
