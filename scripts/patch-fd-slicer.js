#!/usr/bin/env node
// Patches fd-slicer's ReadStream so that Node 26 can extract zip archives again.
//
// fd-slicer@1.1.0 uses `this.destroyed` as its own private EOF/cancel sentinel.
// On Node 26 `destroyed` is an accessor on Readable.prototype backed by stream
// state, so writing it marks the stream destroyed: the EOF `push(null)` never
// emits 'end' and any bytes still buffered in the pipe are abandoned. Downstream
// stages that need EOF to flush (zlib inflate inside extract-zip's
// `stream.pipeline(...)`) then wait forever — with no pending handles the process
// exits silently mid-extraction.
//
// That is how `npm install` ends up with a `node_modules/electron/dist` holding a
// single half-written file and no `path.txt`, which makes electron-vite report
// `Error: Electron uninstall` (verified: Node 24.9 extracts fine, Node 26.7 stalls
// on the first zip entry).
//
// The fix renames the sentinel to a private property inside ReadStream only, so it
// cannot collide with stream state. Behaviour is otherwise identical to upstream.

'use strict'

const fs = require('fs')
const path = require('path')

// The ReadStream section of fd-slicer/index.js — the only class reachable from
// yauzl (and therefore extract-zip). Bounded by these two markers so the identical
// (unused-by-us) WriteStream and BufferSlicer copies are left untouched.
const READ_STREAM_START = 'function ReadStream(context, options) {'
const READ_STREAM_END = 'util.inherits(WriteStream, Writable);'

const SENTINEL = '_fdsDestroyed'
const SENTINEL_RE = /\b(this|self)\.destroyed\b/g

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Patch a fd-slicer source string.
 *
 * @param {string} src - contents of fd-slicer/index.js
 * @returns {{ status: 'patched' | 'already-patched' | 'unsupported', output?: string }}
 */
function patchSource(src) {
  const start = src.indexOf(READ_STREAM_START)
  const end = src.indexOf(READ_STREAM_END)

  if (start === -1 || end === -1 || end < start) {
    return { status: 'unsupported' }
  }

  const block = src.slice(start, end)
  if (block.includes(SENTINEL)) {
    return { status: 'already-patched' }
  }
  if (!/\b(this|self)\.destroyed\b/.test(block)) {
    return { status: 'unsupported' }
  }

  const patched = block.replace(SENTINEL_RE, `$1.${SENTINEL}`)
  return { status: 'patched', output: src.slice(0, start) + patched + src.slice(end) }
}

/**
 * Every fd-slicer/index.js visible from a project root — the hoisted copy plus any
 * nested (non-hoisted) copy that extract-zip's own dependency chain would resolve.
 *
 * @param {string} rootDir - project root directory (contains node_modules/)
 * @returns {string[]} absolute paths
 */
function findFdSlicerFiles(rootDir) {
  const files = new Set()
  const hoisted = path.join(rootDir, 'node_modules', 'fd-slicer', 'index.js')

  if (fs.existsSync(hoisted)) {
    files.add(hoisted)
  }

  if (typeof fs.globSync === 'function') {
    try {
      for (const rel of fs.globSync('node_modules/**/node_modules/fd-slicer/index.js', { cwd: rootDir })) {
        files.add(path.join(rootDir, rel))
      }
    } catch {
      // Globbing is best-effort; the hoisted copy is the normal layout.
    }
  }

  return [...files]
}

/**
 * Patch every fd-slicer copy in the project.
 *
 * @param {object} [opts]
 * @param {string} opts.rootDir - project root (default: repo root)
 * @param {(msg: string) => void} opts.log - logger (default: console.log)
 * @returns {'patched' | 'already-patched' | 'not-found'} aggregate result
 */
function patchFdSlicer(opts = {}) {
  const { rootDir = path.resolve(__dirname, '..'), log = console.log } = opts

  const files = findFdSlicerFiles(rootDir)
  if (files.length === 0) {
    log('patch-fd-slicer: fd-slicer not installed, skipping')
    return 'not-found'
  }

  let changed = 0
  let already = 0

  for (const file of files) {
    const result = patchSource(fs.readFileSync(file, 'utf8'))

    if (result.status === 'patched') {
      fs.writeFileSync(file, result.output)
      changed++
    } else if (result.status === 'already-patched') {
      already++
    } else {
      log(`patch-fd-slicer: unexpected fd-slicer contents in ${path.relative(rootDir, file)}, skipping`)
    }
  }

  if (changed > 0) {
    log(`patch-fd-slicer: patched ${changed} fd-slicer copy(ies) for Node 26 zip extraction ✓`)
    return 'patched'
  }
  if (already > 0) {
    log('patch-fd-slicer: fd-slicer already patched, skipping')
    return 'already-patched'
  }
  return 'not-found'
}

// ── CLI entry point ─────────────────────────────────────────────────────────

if (require.main === module) {
  patchFdSlicer()
}

// ── Exports (for testing) ───────────────────────────────────────────────────

module.exports = {
  patchSource,
  findFdSlicerFiles,
  patchFdSlicer,
}
