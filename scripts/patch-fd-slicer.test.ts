// Tests for scripts/patch-fd-slicer.js — the Node 26 zip-extraction fix.
// Uses real tmpdir fixtures (no mocking needed for fs ops), and drives the patched
// ReadStream through `stream.pipeline` — the thing extract-zip awaits for a stored entry.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { once } from 'events'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { pipeline } from 'stream/promises'

// We import CJS module; vitest handles the interop.
// @ts-ignore — js file, no type declarations
const { patchSource, findFdSlicerFiles, patchFdSlicer } = require('./patch-fd-slicer.js')

// fd-slicer@1.1.0's ReadStream verbatim (the only class yauzl — and so extract-zip —
// reaches), followed by a WriteStream stub: the same file reuses the `destroyed`
// sentinel there, and the patch must leave that copy alone.
const FIXTURE = `const { Readable, Writable } = require('stream');
const fs = require('fs');
const util = require('util');

util.inherits(ReadStream, Readable);
function ReadStream(context, options) {
  options = options || {};
  Readable.call(this, options);

  this.context = context;
  this.context.ref();

  this.start = options.start || 0;
  this.endOffset = options.end;
  this.pos = this.start;
  this.destroyed = false;
}

ReadStream.prototype._read = function(n) {
  var self = this;
  if (self.destroyed) return;

  var toRead = Math.min(self._readableState.highWaterMark, n);
  if (self.endOffset != null) {
    toRead = Math.min(toRead, self.endOffset - self.pos);
  }
  if (toRead <= 0) {
    self.destroyed = true;
    self.push(null);
    self.context.unref();
    return;
  }
  self.context.pend.go(function(cb) {
    if (self.destroyed) return cb();
    var buffer = new Buffer(toRead);
    fs.read(self.context.fd, buffer, 0, toRead, self.pos, function(err, bytesRead) {
      if (err) {
        self.destroy(err);
      } else if (bytesRead === 0) {
        self.destroyed = true;
        self.push(null);
        self.context.unref();
      } else {
        self.pos += bytesRead;
        self.push(buffer.slice(0, bytesRead));
      }
      cb();
    });
  });
};

ReadStream.prototype.destroy = function(err) {
  if (this.destroyed) return;
  err = err || new Error("stream destroyed");
  this.destroyed = true;
  this.emit('error', err);
  this.context.unref();
};

util.inherits(WriteStream, Writable);
function WriteStream(context, options) {
  options = options || {};
  Writable.call(this, options);

  this.destroyed = false;
}
WriteStream.prototype.destroy = function() {
  if (this.destroyed) return;
  this.destroyed = true;
};

module.exports = { ReadStream, WriteStream };
`

// The state this patch was in before the `destroy` half: the sentinel renamed (so Node 26
// reaches EOF) and `destroy` left as shipped. Every byte arrives and the file is written,
// yet `stream.pipeline` is still waiting for a 'close' that never comes — the stall the
// macOS unit lane sat in, extract-zip never resolving and node exiting with nothing said.
const RENAME_ONLY = FIXTURE.replace(/\b(this|self)\.destroyed\b/g, '$1._fdsDestroyed')

function writeFixture(rootDir: string, source = FIXTURE) {
  const dir = path.join(rootDir, 'node_modules', 'fd-slicer')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'index.js')
  fs.writeFileSync(file, source, 'utf8')
  return file
}

/**
 * One zip entry read the way extract-zip reads it: a ReadStream over `bytes` of a file,
 * piped into a write stream. Returns once the write side has closed — long enough for a
 * 'close' the source was going to emit to have landed — with whether the pipeline has
 * settled by then. No wall-clock wait: `setImmediate` is one event-loop turn, and a
 * 'close' emitted on a tick is queued before it.
 */
async function driveEntry(modulePath: string, sourcePath: string, bytes: number) {
  const { ReadStream } = require(modulePath)
  const unrefs: number[] = []
  const context = {
    fd: fs.openSync(sourcePath, 'r'),
    ref: () => {},
    unref: () => { unrefs.push(1) },
    pend: { go: (fn: (cb: () => void) => void) => fn(() => {}) },
  }

  const source = new ReadStream(context, { start: 0, end: bytes })
  const dest = path.join(path.dirname(sourcePath), 'extracted.bin')
  const write = fs.createWriteStream(dest)
  let sourceClosed = false
  let settled: string | null = null
  source.on('close', () => { sourceClosed = true })
  pipeline(source, write).then(
    () => { settled = 'resolved' },
    (err: Error) => { settled = `rejected: ${err.message}` },
  )

  try {
    await once(write, 'close')
    await new Promise((resolve) => setImmediate(resolve))
    return {
      settled,
      sourceClosed,
      extracted: fs.readFileSync(dest),
      unrefs: unrefs.length,
    }
  } finally {
    fs.closeSync(context.fd)
  }
}

describe('patchSource', () => {
  it('renames the ReadStream sentinel without touching the WriteStream copy', () => {
    const { status, output } = patchSource(FIXTURE)
    expect(status).toBe('patched')

    const readStreamSection = output!.split('util.inherits(WriteStream, Writable);')[0]
    const writeStreamSection = output!.split('util.inherits(WriteStream, Writable);')[1]

    expect(readStreamSection).not.toMatch(/\.destroyed\b/)
    expect(readStreamSection).toContain('this._fdsDestroyed = false;')
    expect(readStreamSection).toContain('if (self._fdsDestroyed) return;')
    expect(readStreamSection).toContain('this._fdsDestroyed = true;')
    expect(writeStreamSection).toMatch(/this\.destroyed = false/)
  })

  it('closes the stream when destroy arrives with the sentinel already set', () => {
    const { output } = patchSource(FIXTURE)
    const readStreamSection = output!.split('util.inherits(WriteStream, Writable);')[0]

    expect(readStreamSection).toContain('Readable.prototype.destroy.call(this, err);')
    expect(readStreamSection).not.toContain("this.emit('error', err)")
  })

  it('is idempotent — patching an already patched source is a no-op', () => {
    const { output } = patchSource(FIXTURE)
    expect(patchSource(output!).status).toBe('already-patched')
  })

  it('reports unsupported instead of corrupting an unrecognised source', () => {
    expect(patchSource('module.exports = {}').status).toBe('unsupported')
  })

  it('refuses a source whose destroy body is not the one it knows', () => {
    const rewritten = FIXTURE.replace('  if (this.destroyed) return;\n', '')
    expect(patchSource(rewritten).status).toBe('unsupported')
  })
})

describe('the patched ReadStream', () => {
  let rootDir: string
  let source: string

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-fd-slicer-test-'))
    source = path.join(rootDir, 'entry.bin')
    fs.writeFileSync(source, Buffer.alloc(8, 7))
  })
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }) })

  it('settles stream.pipeline for a stored entry, whatever the archive holds', async () => {
    const patched = writeFixture(path.join(rootDir, 'patched'))
    expect(patchFdSlicer({ rootDir: path.join(rootDir, 'patched'), log: () => {} })).toBe('patched')

    const entry = await driveEntry(patched, source, 8)

    expect(entry.settled).toBe('resolved')
    expect(entry.extracted).toEqual(Buffer.alloc(8, 7))
    expect(entry.sourceClosed).toBe(true)
    // The archive's streams share one file descriptor and one reference count: unref'ing
    // it a second time closes the descriptor under the entries still to come.
    expect(entry.unrefs).toBe(1)
  })

  it('is the stall the macOS lane hit when destroy() was left as shipped', async () => {
    const renameOnly = writeFixture(path.join(rootDir, 'rename-only'), RENAME_ONLY)

    const entry = await driveEntry(renameOnly, source, 8)

    expect(entry.extracted).toEqual(Buffer.alloc(8, 7))
    expect(entry.sourceClosed).toBe(false)
    expect(entry.settled).toBe(null)
  })
})

describe('findFdSlicerFiles', () => {
  let rootDir: string

  beforeEach(() => { rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-fd-slicer-test-')) })
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }) })

  it('finds nothing when fd-slicer is not installed', () => {
    expect(findFdSlicerFiles(rootDir)).toEqual([])
  })

  it('finds the hoisted copy', () => {
    const file = writeFixture(rootDir)
    expect(findFdSlicerFiles(rootDir)).toContain(file)
  })

  it('finds nested copies too', () => {
    const rel = path.join('node_modules', 'extract-zip', 'node_modules', 'yauzl', 'node_modules', 'fd-slicer', 'index.js')
    const nested = path.join(rootDir, rel)
    fs.mkdirSync(path.dirname(nested), { recursive: true })
    fs.writeFileSync(nested, FIXTURE, 'utf8')

    expect(findFdSlicerFiles(rootDir)).toContain(nested)
  })
})

describe('patchFdSlicer', () => {
  let rootDir: string

  beforeEach(() => { rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-fd-slicer-test-')) })
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }) })

  it('patches the installed copy on disk and stays idempotent', () => {
    const file = writeFixture(rootDir)
    expect(patchFdSlicer({ rootDir, log: () => {} })).toBe('patched')
    expect(fs.readFileSync(file, 'utf8')).toContain('_fdsDestroyed')
    expect(fs.readFileSync(file, 'utf8')).toContain('_fdsClosed')
    expect(patchFdSlicer({ rootDir, log: () => {} })).toBe('already-patched')
  })

  it('is a no-op when fd-slicer is absent', () => {
    expect(patchFdSlicer({ rootDir, log: () => {} })).toBe('not-found')
  })
})
