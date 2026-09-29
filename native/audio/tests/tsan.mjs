#!/usr/bin/env node
/**
 * The engine under ThreadSanitizer: a minute of the soak's show, then the stop-under-load
 * test, against a build made with `-fsanitize=thread`. Any report fails the run.
 *
 * It exists because the races this finds do not fail a test. A torn read of the mix
 * snapshot, a stream slot read while it was being built and a connection thread that outlives
 * the engine all pass every functional lane and crash a show one run in a dozen — the soak's
 * SIGSEGV that #172 was opened for. TSan reports the access, not the crash.
 *
 * The sanitizer slows the engine, so nothing here is a timing measurement: the soak's own
 * tolerance for how late a start may be is the one it has everywhere, and it has held. The
 * build goes to a directory of its own, so the engine the other lanes run is untouched.
 *
 *   node native/audio/tests/tsan.mjs [--minutes n]
 *
 * Linux, gcc or clang: the lane the engine's own workflow runs on.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'linux') {
  console.log('tsan — skipped: this lane is Linux only')
  process.exit(0)
}

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const minutes = process.argv.includes('--minutes') ? process.argv[process.argv.indexOf('--minutes') + 1] : '1'

const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-tsan-'))
const logDir = join(workDir, 'reports')
const buildDir = join(workDir, 'build')
mkdirSync(logDir)
let status = 1

/** A compiler that always adds the sanitizer: the build script takes CXX and CC as one command. */
function wrapper(name, real) {
  const path = join(workDir, name)
  writeFileSync(path, `#!/bin/sh\nexec ${real} -fsanitize=thread -fno-omit-frame-pointer -g -Wno-tsan "$@"\n`)
  chmodSync(path, 0o755)
  return path
}

/**
 * The engine, started with address randomisation off where `setarch` can do it: an older
 * ThreadSanitizer runtime dies with "unexpected memory mapping" under the kernel's default,
 * and the soak and the stop test both start whatever `--binary` names.
 */
function unrandomised(binary) {
  const arch = spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout?.trim()
  if (!arch || spawnSync('setarch', [arch, '-R', 'true']).status !== 0) return binary
  const path = join(workDir, 'engine-tsan')
  writeFileSync(path, `#!/bin/sh\nexec setarch ${arch} -R "${binary}" "$@"\n`)
  chmodSync(path, 0o755)
  return path
}

function step(label, command, args, env = {}) {
  console.log(`tsan — ${label}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  })
  return result.status ?? 1
}

try {
  const cxx = process.env.CXX ? process.env.CXX.split(' ')[0] : 'g++'
  const cc = process.env.CC ? process.env.CC.split(' ')[0] : cxx.includes('clang') ? 'clang' : 'gcc'
  const built = step('building the engine with -fsanitize=thread', process.execPath, ['scripts/build-native-audio.mjs'], {
    CXX: wrapper('cxx-tsan', cxx),
    CC: wrapper('cc-tsan', cc),
    CUERUNNER_NATIVE_BUILD_DIR: buildDir
  })
  if (built !== 0) {
    console.error('tsan: the sanitizer build failed')
  } else {
    const binary = unrandomised(join(buildDir, 'cuerunner-audio'))
    const env = { TSAN_OPTIONS: `halt_on_error=0:log_path=${join(logDir, 'tsan')}` }
    const soak = step(`the soak, ${minutes} min`, process.execPath, ['native/audio/tests/soak.mjs', '--minutes', minutes, '--binary', binary], env)
    const race = step('stopping under load', process.execPath, ['native/audio/tests/shutdown-race.mjs', '--binary', binary], env)
    const reports = readdirSync(logDir, { withFileTypes: true }).filter((entry) => entry.isFile())
    for (const report of reports) {
      const text = readFileSync(join(logDir, report.name), 'utf8')
      const summaries = text.split('\n').filter((line) => line.startsWith('SUMMARY:'))
      console.error(`tsan: ${report.name}\n${[...new Set(summaries)].join('\n')}`)
    }
    if (reports.length > 0) console.error(`tsan: ${reports.length} report file(s) — the engine has a data race`)
    status = soak === 0 && race === 0 && reports.length === 0 ? 0 : 1
    if (status === 0) console.log('tsan — clean')
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
process.exit(status)
