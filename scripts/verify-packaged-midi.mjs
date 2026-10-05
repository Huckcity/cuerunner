#!/usr/bin/env node
// Fails a packaging job whose app was packaged without MIDI.
//
//   node scripts/verify-packaged-midi.mjs dist
//
// `midi` is an optional dependency: it is a native addon, and a developer's machine that
// cannot build it still runs the show. That bargain is for a desk, not for an installer.
// npm treats a failed optional build as nothing at all — no warning, exit 0 — and
// electron-builder packages whatever is in node_modules, so a runner that cannot build the
// addon produces an installer with no MIDI in it and a green run. v0.16.0's Windows
// installer shipped that way: the runner had no Python for node-gyp, the app's first
// screen said "MIDI unavailable", and nothing on the release lane said anything.
//
// What is checked is the artifact, after packaging: the addon electron-builder unpacks
// beside the app's archive, which is the only copy the installed app can load.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the addon sits inside any platform's packaged app, as path segments. */
export const PACKAGED_ADDON = ['app.asar.unpacked', 'node_modules', 'midi', 'build', 'Release', 'midi.node']

/** How deep under the output directory a packaged app's resources can be (a .app nests furthest). */
const MAX_DEPTH = 8

/**
 * Every packaged MIDI addon under `root`, by absolute path.
 *
 * @param {string} root - electron-builder's output directory
 * @returns {string[]}
 */
export function findPackagedMidi(root) {
  const found = []
  const walk = (dir, depth) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      if (entry.name === PACKAGED_ADDON[0]) {
        const addon = path.join(full, ...PACKAGED_ADDON.slice(1))
        if (fs.existsSync(addon) && fs.statSync(addon).size > 0) found.push(addon)
        continue
      }
      // The app's own archive contents are not where a second app would be.
      if (depth < MAX_DEPTH && entry.name !== 'node_modules') walk(full, depth + 1)
    }
  }
  walk(path.resolve(root), 0)
  return found
}

/** What the job prints when the addon is not there: the fault, why nothing else said so, and the cure. */
export function missingMessage(root) {
  return [
    `no packaged MIDI addon under ${root} (looked for ${PACKAGED_ADDON.join('/')}).`,
    'The app this job packaged cannot send or receive MIDI, and says "MIDI unavailable" at launch.',
    '`midi` is an optional dependency, so `npm ci` exits 0 when its native build fails and prints nothing:',
    'this runner could not build it. node-gyp needs Python 3 and a C++ toolchain on the runner',
    '(on Windows, a real Python — the Microsoft Store alias in WindowsApps is not one).',
    'Provision the runner, then check with: npm rebuild midi --foreground-scripts'
  ].join('\n')
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? 'dist'
  const found = findPackagedMidi(root)
  if (found.length === 0) {
    const message = missingMessage(root)
    // One annotation for the run's summary, and the whole of it in the log.
    console.error(`::error::${message.split('\n')[0]}`)
    console.error(message)
    process.exit(1)
  }
  for (const addon of found) console.log(`packaged MIDI addon: ${addon} (${fs.statSync(addon).size} bytes)`)
}
