#!/usr/bin/env node
// Verifies and repairs the Electron binary after npm install.
//
// npm runs a dependency's install scripts before the root postinstall, so on Node 26
// Electron's own postinstall extracts its zip before `scripts/postinstall.js` has patched
// fd-slicer — and that extraction stalls without saying so, leaving `dist/` partial and no
// `path.txt` (see patch-fd-slicer.js). A network timeout or a corrupt cache fails the same
// way, just as quietly. This runs from the root postinstall — which always executes — and
// repairs the Electron binary when npm's own electron postinstall didn't deliver it.

'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * @typedef {'ok' | 'missing-module' | 'missing-path-file' | 'missing-binary'} BinaryState
 *
 * @param {string} rootDir - project root directory (contains node_modules/)
 * @returns {{ state: BinaryState, binaryPath: string | null }}
 */
function getElectronBinaryState(rootDir) {
  const electronDir = path.join(rootDir, 'node_modules', 'electron')

  if (!fs.existsSync(electronDir)) {
    return { state: 'missing-module', binaryPath: null }
  }

  const pathFile = path.join(electronDir, 'path.txt')
  if (!fs.existsSync(pathFile)) {
    return { state: 'missing-path-file', binaryPath: null }
  }

  const executableName = fs.readFileSync(pathFile, 'utf8').trim()
  const binaryPath = path.join(electronDir, 'dist', executableName)

  if (!fs.existsSync(binaryPath)) {
    return { state: 'missing-binary', binaryPath }
  }

  return { state: 'ok', binaryPath }
}

/**
 * Attempt to download/install the Electron binary by running its install.js.
 * Returns true if the binary was successfully installed, false otherwise.
 *
 * @param {string} rootDir - project root directory
 * @returns {boolean}
 */
function repairElectronBinary(rootDir) {
  const electronDir = path.join(rootDir, 'node_modules', 'electron')
  const installScript = path.join(electronDir, 'install.js')

  if (!fs.existsSync(installScript)) {
    return false
  }

  try {
    execFileSync(process.execPath, [installScript], {
      cwd: electronDir,
      stdio: 'inherit',
      timeout: 300_000, // 5 minutes — a cold ~200 MB download can exceed 2 minutes
    })
    return getElectronBinaryState(rootDir).state === 'ok'
  } catch (_err) {
    return false
  }
}

// ── Diagnose-and-repair flow ────────────────────────────────────────────────

/**
 * Check the Electron binary and attempt repair if needed.
 * Prints diagnostic messages to stdout; exits 0 in all cases
 * (a hard exit here would break CI that installs deps but only runs tests).
 *
 * @param {object} opts
 * @param {string}  opts.rootDir   - project root (default: cwd)
 * @param {boolean} opts.autoRepair - attempt repair if missing (default: true)
 * @param {(msg: string) => void} opts.log - logger (default: console.log)
 * @returns {BinaryState} final state after repair attempt
 */
function ensureElectronBinary(opts = {}) {
  const {
    rootDir = path.resolve(__dirname, '..'),
    autoRepair = true,
    log = console.log,
  } = opts

  const state = getElectronBinaryState(rootDir)

  if (state.state === 'ok') return 'ok'
  if (state.state === 'missing-module') return 'missing-module' // no electron in deps; fine

  // ── Diagnostic banner ──────────────────────────────────────────────────
  log('')
  log('\x1b[33m╔══════════════════════════════════════════════════════════════╗\x1b[0m')
  log('\x1b[33m║  ⚠ Electron binary not found                                 ║\x1b[0m')
  log('\x1b[33m╚══════════════════════════════════════════════════════════════╝\x1b[0m')
  log('')

  if (state.state === 'missing-path-file') {
    log('  node_modules/electron/path.txt is missing.')
    log('  The Electron postinstall did not run or the download failed.')
  } else {
    log(`  path.txt exists but the binary was not found.`)
    log('  The Electron ZIP extraction may have failed or was interrupted.')
  }

  // ── Attempt repair ─────────────────────────────────────────────────────
  if (autoRepair) {
    log('')
    log('  Attempting automatic repair...')
    const ok = repairElectronBinary(rootDir)
    if (ok) {
      log('  \x1b[32m✓ Electron binary installed successfully.\x1b[0m')
      log('')
      return 'ok'
    }
    log('  \x1b[31m✗ Automatic repair failed (network error, timeout, etc.).\x1b[0m')
  }

  // ── Manual recovery instructions ───────────────────────────────────────
  log('')
  log('  Manual recovery steps (try in order):')
  log('')
  log('  1. Re-run this project\'s postinstall (patches fd-slicer, retries electron):')
  log('     node scripts/postinstall.js')
  log('')
  log('  2. Verify electron is working:')
  log('     npx electron --version')
  log('')
  log('  3. As a last resort, clear the npm cache and reinstall:')
  log('     npm cache clean --force')
  log('     rm -rf node_modules package-lock.json')
  log('     npm install')
  log('')

  return state.state
}

// ── CLI entry point ─────────────────────────────────────────────────────────

if (require.main === module) {
  ensureElectronBinary()
}

// ── Exports (for testing) ───────────────────────────────────────────────────

module.exports = {
  getElectronBinaryState,
  repairElectronBinary,
  ensureElectronBinary,
}