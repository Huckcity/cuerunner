#!/usr/bin/env node
/**
 * Compiles and runs tests/asio-rules.cpp — the ASIO backend's arithmetic with no ASIO
 * anywhere: the sample words a driver can ask for, and which buffer sizes one will accept.
 *
 * It exists because those two are rules rather than calls, and because every way of getting
 * them wrong is silent: a mis-scaled integer is a level error, a shifted one is a level
 * error with the low bits missing, an over-scaled one wraps into a full-scale click. The
 * header they live in (src/asio_convert.h) has no SDK, no Windows and no driver in it for
 * exactly this reason, so this runs wherever a C++ compiler does — the Linux lanes — while
 * the Windows-only half of the backend is proven by the engine build and, on a machine with
 * an ASIO driver, by tests/device-smoke.mjs --backend asio.
 *
 *   node native/audio/tests/asio-rules.mjs [--compiler <c++>]
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(here, '..', 'src')

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback
}

/** The compiler the engine build would use here, and the flags it would use for it. */
function compiler() {
  const override = argValue('--compiler', process.env.CXX)
  if (override) return { command: override, args: ['-std=c++17', '-O1'] }
  if (process.platform === 'win32') return { command: 'cl', args: ['/nologo', '/std:c++17', '/EHsc', '/O2'] }
  return { command: 'g++', args: ['-std=c++17', '-O1', '-Wall', '-Wextra'] }
}

const workDir = mkdtempSync(join(tmpdir(), 'winslab-asio-rules-'))
const isMsvc = compiler().command.endsWith('cl') || compiler().command.endsWith('cl.exe')
const binary = join(workDir, isMsvc ? 'asio-rules.exe' : 'asio-rules')
const { command, args } = compiler()
// `cl` has no GNU `-o`: the executable switch is `/Fe` (and `/Fo` for objects).
const outputArgs = isMsvc
  ? [`/Fe${binary}`]
  : ['-o', binary]

try {
  const compile = spawnSync(command, [...args, `-I${srcDir}`, join(here, 'asio-rules.cpp'), ...outputArgs], {
    stdio: 'inherit'
  })
  if (compile.error) {
    console.error(`asio-rules: ${command} could not be run (${compile.error.message})`)
    process.exit(1)
  }
  if (compile.status !== 0) {
    console.error(`asio-rules: ${command} failed with status ${compile.status}`)
    process.exit(1)
  }

  const run = spawnSync(binary, [], { stdio: 'inherit' })
  if (run.error) {
    console.error(`asio-rules: could not run the checks (${run.error.message})`)
    process.exit(1)
  }
  process.exit(run.status ?? 1)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
