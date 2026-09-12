#!/usr/bin/env node
// Runs the Playwright E2E suite on a display of its own.
//
// Electron always opens real windows. Pointed at the developer's display, the suite
// steals focus, covers whatever is on screen and cannot run at all over ssh. So on
// Linux it runs under Xvfb — a virtual X server nobody is looking at — and
// `npm run test:e2e:headed` is the explicit opt-in that puts the windows back in
// front of you. macOS and Windows have no cheap Xvfb equivalent, so there the suite
// uses the session's own display.

'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// Same geometry as CI. The app window is 1280x800, so it fits, and the suite's layout
// assertions were written against this screen.
const XVFB_SCREEN = '1600x1000x24'

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Find an executable on PATH. POSIX only: this is what decides whether a Linux host
 * can be given a virtual display at all.
 *
 * @param {string} name - executable name, no extension
 * @param {string} pathEnv - a PATH string
 * @returns {string | null} absolute path, or null when nothing on PATH matches
 */
function findExecutable(name, pathEnv) {
  for (const dir of String(pathEnv || '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Not in this directory; keep looking.
    }
  }
  return null
}

/**
 * Environment for an isolated run.
 *
 * Electron 28+ prefers the session's Wayland compositor over `DISPLAY`, so on a Wayland
 * desk a virtual X server alone buys nothing: the app renders on the compositor the
 * operator is sitting in front of. `e2e/helpers.ts` passes `--ozone-platform=x11` to
 * every app it launches, which is what pins the surface; dropping the socket name here
 * is the backstop for anything else the run spawns.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
function withoutWayland(env) {
  const isolated = { ...env }
  delete isolated.WAYLAND_DISPLAY
  return isolated
}

/**
 * The Playwright CLI to run, resolved from the installed package.
 *
 * Not `npx`: Node refuses to spawn a `.cmd` without a shell (EINVAL), which is what the
 * Windows lane got instead of a test run, and going through a shell would put the
 * arguments through another round of quoting. This is the same file `npx playwright`
 * would run.
 */
function playwrightCli() {
  try {
    return path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js')
  } catch {
    throw new Error('Playwright is not installed — run `npm install` before the E2E suite.')
  }
}

/**
 * Decide how to start Playwright.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.argv] - arguments to pass through to `playwright test`
 * @param {NodeJS.Platform} [opts.platform] - defaults to the running platform
 * @param {string} [opts.pathEnv] - PATH to search for xvfb-run; defaults to this process's
 * @param {NodeJS.ProcessEnv} [opts.env] - environment to hand the run; defaults to this process's
 * @param {string} [opts.cli] - Playwright CLI to run; defaults to the installed one
 * @param {string} [opts.node] - interpreter for it; defaults to this one
 * @param {boolean} [opts.headed] - force the real display; defaults to `--headed` in argv
 * @returns {{ mode: 'virtual' | 'direct', command: string, args: string[], env: NodeJS.ProcessEnv }}
 * @throws {Error} on Linux without xvfb-run, unless the run asked for the real display
 */
function resolveE2eRun(opts = {}) {
  const {
    argv = [],
    platform = process.platform,
    pathEnv = process.env.PATH,
    env = process.env,
    cli = playwrightCli(),
    node = process.execPath,
    headed = argv.includes('--headed'),
  } = opts

  const playwrightArgs = [cli, 'test', ...argv]

  // A run that asked to be watched belongs on the display the developer is using,
  // compositor and all.
  if (headed) return { mode: 'direct', command: node, args: playwrightArgs, env }

  // Only Linux has an Xvfb to borrow; elsewhere the session display is all there is.
  if (platform !== 'linux') return { mode: 'direct', command: node, args: playwrightArgs, env }

  const xvfbRun = findExecutable('xvfb-run', pathEnv)
  if (xvfbRun === null) {
    throw new Error(
      'xvfb-run is not installed, so the E2E suite has no display to run on that is not yours.\n' +
        '  Install it (Debian/Ubuntu: sudo apt install xvfb), or run the suite on your desktop\n' +
        '  on purpose with: npm run test:e2e:headed',
    )
  }

  return {
    mode: 'virtual',
    command: xvfbRun,
    args: ['-a', '-s', `-screen 0 ${XVFB_SCREEN}`, node, ...playwrightArgs],
    env: withoutWayland(env),
  }
}

// ── CLI entry point ─────────────────────────────────────────────────────────

if (require.main === module) {
  let run
  try {
    run = resolveE2eRun({ argv: process.argv.slice(2) })
  } catch (err) {
    console.error(`\ne2e: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }

  if (run.mode === 'virtual') {
    console.log('e2e: Electron windows open on a private virtual display; nothing appears on your screen.')
    console.log('     To watch a run instead: npm run test:e2e:headed')
  }

  const result = spawnSync(run.command, run.args, { stdio: 'inherit', env: run.env })
  if (result.error) {
    console.error(`e2e: could not start ${run.command}: ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

// ── Exports (for testing) ───────────────────────────────────────────────────

module.exports = {
  XVFB_SCREEN,
  findExecutable,
  playwrightCli,
  withoutWayland,
  resolveE2eRun,
}
