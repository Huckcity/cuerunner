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
  const result = spawnSync(binary, [], { encoding: 'utf8', env: { ...process.env, TSAN_OPTIONS: 'halt_on_error=1' } })
  process.stdout.write(`[${name}] ${result.stdout ?? ''}`)
  if (result.status !== 0) process.stderr.write(result.stderr ?? '')
  return result.status ?? 1
}
