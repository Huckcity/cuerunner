#!/usr/bin/env node
// Root postinstall: make a fresh `npm install` produce a usable Electron binary.
//
// Runs after every dependency install script (npm always runs dependency scripts
// first), so it is the only place that can both patch what those scripts depend on
// and repair their fallout.
//
// 1. Patch @electron/rebuild's node-gyp.js (import.meta.dirname is undefined when
//    the module is dynamically imported inside a forked CJS process).
// 2. Patch fd-slicer's ReadStream — without it, zip extraction deadlocks on Node 26
//    (the EOF sentinel collides with stream state) or stalls in `stream.pipeline`
//    (ReadStream.destroy emits no 'close'), and the Electron binary never lands
//    (see patch-fd-slicer.js).
// 3. Verify the Electron binary exists and repair it if not. Requires step 2, since
//    the repair re-runs electron's install script, which extracts a zip.

'use strict'

const fs = require('fs')
const path = require('path')

const { ensureElectronBinary } = require('./check-electron.js')
const { patchFdSlicer } = require('./patch-fd-slicer.js')

// ── 1. @electron/rebuild patch ──────────────────────────────────────────────

function patchElectronRebuild() {
  const target = path.resolve(__dirname, '../node_modules/@electron/rebuild/lib/module-type/node-gyp/node-gyp.js')

  if (!fs.existsSync(target)) {
    console.log('postinstall: @electron/rebuild not found, skipping patch')
    return
  }

  const src = fs.readFileSync(target, 'utf8')
  const before = "path.resolve(import.meta.dirname, 'worker.js')"
  const after = "new URL('worker.js', import.meta.url)"

  if (!src.includes(before)) {
    console.log('postinstall: @electron/rebuild already patched or changed, skipping')
    return
  }

  fs.writeFileSync(target, src.replace(before, after))
  console.log('postinstall: patched @electron/rebuild node-gyp.js ✓')
}

// ── Run ─────────────────────────────────────────────────────────────────────

patchElectronRebuild()
patchFdSlicer()
ensureElectronBinary()
