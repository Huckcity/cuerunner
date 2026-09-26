#!/usr/bin/env node
// Patches fd-slicer's ReadStream so that Node 26 can extract zip archives again.
//
// fd-slicer@1.1.0 gets two things wrong about Node's stream contract, and either one
// stops `extract-zip` (yauzl → fd-slicer) with nothing printed and no non-zero exit:
//
// 1. It uses `this.destroyed` as its own private EOF/cancel sentinel. On Node 26
//    `destroyed` is an accessor on Readable.prototype backed by stream state, so writing
//    it marks the stream destroyed: the EOF `push(null)` never emits 'end' and any bytes
//    still buffered in the pipe are abandoned. Downstream stages that need EOF to flush
//    (zlib inflate inside extract-zip's `stream.pipeline(...)`) then wait forever.
//
// 2. Its `destroy()` returns early once that sentinel is set — and that is exactly when
//    Node's autoDestroy calls it, after 'end'. `stream.pipeline` waits for 'close' on
//    every stream it is handed, so the promise never settles even though every byte
//    arrived and the file was written. Only *stored* zip entries reach pipeline as the
//    raw ReadStream (deflated ones are wrapped by yauzl's AssertByteCountStream), which
//    is why this stayed hidden on Linux: electron's linux-x64 zip is entirely deflated
//    while the darwin-arm64 one carries stored entries (`…/Contents/PkgInfo` at the 70th
//    entry), so the macOS unit lane stalled there and no other lane did.
//
// With no pending handles, the process exits silently mid-extraction either way. That is
// how `npm install` ends up with a `node_modules/electron/dist` holding a few files and
// no `path.txt`, which makes electron-vite report `Error: Electron uninstall` (verified:
// Node 24.9 extracts fine, Node 26.7 stalls on the first zip entry; and with defect 1
// patched alone, extraction of `electron-v41.5.0-darwin-arm64.zip` stops dead at the
// 70th entry on Node 26.7 and Node 24.21 alike, while the same patch extracts the
// linux-x64 zip whole).
//
// The fix renames the sentinel to a private property inside ReadStream only, so it
// cannot collide with stream state, and closes the stream the way Node expects when
// `destroy()` arrives with the sentinel already set — keeping fd-slicer's own reference
// accounting, so the file descriptor shared by the archive's streams is still released
// exactly once. Behaviour is otherwise identical to upstream.

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
const CLOSED = '_fdsClosed'
const CLOSED_RE = /\b(this|self)\._fdsClosed\b/

// Upstream's `destroy` — matched verbatim after the sentinel rename above, so an
// unrecognised body is refused rather than half-patched — and its replacement.
// `Readable.prototype.destroy` is what emits the 'close' that `stream.pipeline` waits
// for, and fd-slicer's reference is only released here when the EOF path has not
// already released it (that path unrefs the shared FdSlicer, and unref'ing twice closes
// the file descriptor the archive's other streams are still reading from).
const DESTROY_BEFORE = `ReadStream.prototype.destroy = function(err) {
  if (this._fdsDestroyed) return;
  err = err || new Error("stream destroyed");
  this._fdsDestroyed = true;
  this.emit('error', err);
  this.context.unref();
};`

const DESTROY_AFTER = `ReadStream.prototype.destroy = function(err) {
  if (this._fdsClosed) return;
  this._fdsClosed = true;
  var released = this._fdsDestroyed;
  this._fdsDestroyed = true;
  Readable.prototype.destroy.call(this, err);
  if (!released) this.context.unref();
};`

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Patch a fd-slicer source string: the ReadStream sentinel (so EOF survives Node's
 * `destroyed` accessor) and ReadStream's `destroy` (so `stream.pipeline` sees a 'close').
 * A copy the sentinel rename has already reached gets the destroy half alone.
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
  if (CLOSED_RE.test(block)) {
    return { status: 'already-patched' }
  }
  // A copy the sentinel rename has already reached (v0.14.0 shipped one) has no `destroyed` left
  // to rename, and is missing exactly the destroy half: refusing it as unrecognised would leave
  // the half-patch that stalls `stream.pipeline` on the macOS lane.
  if (!/\b(this|self)\.destroyed\b/.test(block) && !block.includes(SENTINEL)) {
    return { status: 'unsupported' }
  }

  const renamed = block.replace(SENTINEL_RE, `$1.${SENTINEL}`)
  if (!renamed.includes(DESTROY_BEFORE)) {
    return { status: 'unsupported' }
  }

  const patched = renamed.replace(DESTROY_BEFORE, DESTROY_AFTER)
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
