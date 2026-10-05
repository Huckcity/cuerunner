#!/usr/bin/env node
/**
 * Compiles and runs tests/snapshot-cell.cpp — the cell the engine publishes its state
 * through (src/snapshot_cell.h), with one writer and several readers hammering it.
 *
 * It runs twice where it can. The plain build proves the record is never torn. The
 * ThreadSanitizer build proves the cell has no data race, which is the property the old
 * seqlock lacked: its payload was ordinary memory that a reader could copy mid-write, so a
 * retry made the result right while the access was still undefined behaviour. TSan is
 * skipped, and said to be, on a compiler or platform that does not have it.
 *
 *   node native/audio/tests/snapshot-cell.mjs [--compiler <c++>]
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

const override = argValue('--compiler', process.env.CXX)
const isMsvc = !override && process.platform === 'win32'
const command = override ?? (isMsvc ? 'cl' : 'g++')
const flags = isMsvc ? ['/nologo', '/std:c++17', '/EHsc', '/O2'] : ['-std=c++17', '-O2', '-Wall', '-Wextra', '-pthread']

const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-snapshot-cell-'))
let status = 1
try {
  status = run('plain', [])
  if (status === 0) {
    if (isMsvc) {
      console.log('snapshot-cell: ThreadSanitizer skipped (MSVC has none)')
    } else {
      status = run('thread', ['-fsanitize=thread', '-g', '-fno-omit-frame-pointer'], true)
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
process.exit(status)

/** The sanitizer runtime giving up before a line of the test ran, as opposed to a report. */
function refusedToStart(result) {
  return result.status !== 0 && /unexpected memory mapping/.test(`${result.stderr ?? ''}${result.stdout ?? ''}`)
}

/** Builds and runs one flavour; `optional` lets a compiler without the sanitizer pass. */
function run(name, extra, optional = false) {
  const binary = join(workDir, `snapshot-cell-${name}${isMsvc ? '.exe' : ''}`)
  const outputArgs = isMsvc ? [`/Fe${binary}`] : ['-o', binary]
  const compile = spawnSync(command, [...flags, ...extra, `-I${srcDir}`, join(here, 'snapshot-cell.cpp'), ...outputArgs], {
    encoding: 'utf8'
  })
  if (compile.error) {
    console.error(`snapshot-cell: ${command} could not be run (${compile.error.message})`)
    return 1
  }
  if (compile.status !== 0) {
    if (optional) {
      console.log(`snapshot-cell: the ${name} build is not available with ${command}; skipped`)
      return 0
    }
    process.stderr.write(compile.stderr)
    console.error(`snapshot-cell: ${command} failed with status ${compile.status}`)
    return 1
  }
  const env = { ...process.env, TSAN_OPTIONS: 'halt_on_error=1' }
  let result = spawnSync(binary, [], { encoding: 'utf8', env })
  if (name === 'thread' && refusedToStart(result)) {
    // An older sanitizer runtime cannot map its shadow memory under the kernel's address
    // randomisation; the same binary runs with it off, which needs no privilege.
    const arch = spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout?.trim()
    if (arch) result = spawnSync('setarch', [arch, '-R', binary], { encoding: 'utf8', env })
    if (refusedToStart(result)) {
      console.log('snapshot-cell: ThreadSanitizer cannot start on this host (memory mapping); skipped')
      return 0
    }
  }
  const said = result.stdout ?? ''
  process.stdout.write(`[${name}] ${said}${said.endsWith('\n') ? '' : '\n'}`)
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '')
    // A run killed by a signal has no status and one that never started has an error, and
    // both came out as a bare exit 1 after an empty "[thread]" — all the 2026-10-05 night
    // left to read. The line says which it was.
    console.error(`snapshot-cell: the ${name} build ${howItEnded(result)}`)
  }
  return result.status ?? 1
}

/** How a run that did not pass ended: never started, killed, or a status of its own. */
function howItEnded(result) {
  const silent = (result.stdout ?? '') === '' && (result.stderr ?? '') === '' ? ', having printed nothing' : ''
  if (result.error) return `could not run (${result.error.message})${silent}`
  if (result.signal) return `was killed by ${result.signal}${silent}`
  return `exited with status ${result.status}${silent}`
}
