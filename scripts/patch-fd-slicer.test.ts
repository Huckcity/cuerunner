// Tests for scripts/patch-fd-slicer.js — the Node 26 zip-extraction fix.
// Uses real tmpdir fixtures (no mocking needed for fs ops).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// We import CJS module; vitest handles the interop.
// @ts-ignore — js file, no type declarations
const { patchSource, findFdSlicerFiles, patchFdSlicer } = require('./patch-fd-slicer.js')

// Shape of fd-slicer@1.1.0: ReadStream (used by yauzl/extract-zip), followed by
// WriteStream which reuses the same `destroyed` sentinel and must stay untouched.
const FIXTURE = `function ReadStream(context, options) {
  Readable.call(this, options);
  this.pos = this.start;
  this.destroyed = false;
}

ReadStream.prototype._read = function(n) {
  var self = this;
  if (self.destroyed) return;
  if (n <= 0) {
    self.destroyed = true;
    self.push(null);
    return;
  }
};

ReadStream.prototype.destroy = function(err) {
  if (this.destroyed) return;
  this.destroyed = true;
  this.emit('error', err);
};

util.inherits(WriteStream, Writable);
function WriteStream(context, options) {
  this.destroyed = false;
}
WriteStream.prototype.destroy = function() {
  if (this.destroyed) return;
  this.destroyed = true;
};
`

function writeFixture(rootDir: string, source = FIXTURE) {
  const dir = path.join(rootDir, 'node_modules', 'fd-slicer')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'index.js')
  fs.writeFileSync(file, source, 'utf8')
  return file
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

  it('is idempotent — patching an already patched source is a no-op', () => {
    const { output } = patchSource(FIXTURE)
    expect(patchSource(output!).status).toBe('already-patched')
  })

  it('reports unsupported instead of corrupting an unrecognised source', () => {
    expect(patchSource('module.exports = {}').status).toBe('unsupported')
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
    expect(patchFdSlicer({ rootDir, log: () => {} })).toBe('already-patched')
  })

  it('is a no-op when fd-slicer is absent', () => {
    expect(patchFdSlicer({ rootDir, log: () => {} })).toBe('not-found')
  })
})
