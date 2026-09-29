#!/usr/bin/env node
/**
 * The engine told to stop while its clients are mid-request.
 *
 * A connection is served by a thread of its own that runs the engine's verbs. Those threads
 * were detached, so a stop could reach the end of `main` — and free the engine and the
 * server — while one was still inside a verb: a use-after-free that shows as a crash at
 * quit, or as nothing at all until it does. The server now drains them, and this holds it
 * to that: several connections keep a stream of `info` and `clock` requests in flight, the
 * engine is sent SIGTERM, and it must leave by itself, with status 0, promptly, and without
 * saying a connection thread outlived it.
 *
 * A plain build cannot prove a race is absent, only fail when it bites; the point of running
 * this against a ThreadSanitizer or AddressSanitizer build (`--binary`) is that those make
 * the bite certain. The Linux and macOS lanes run it, Windows has no SIGTERM to send.
 *
 *   node native/audio/tests/shutdown-race.mjs [--binary path] [--rounds n]
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform === 'win32') {
  console.log('shutdown-race — skipped: there is no SIGTERM to send on Windows')
  process.exit(0)
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const defaultBinary = join(repoRoot, 'native', 'audio', 'build', 'cuerunner-audio')
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const binary = arg('--binary') ?? process.env.CUERUNNER_AUDIO_BIN ?? defaultBinary
const rounds = Number(arg('--rounds') ?? 12)
const CLIENTS = 4

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-shutdown-race-'))
let failures = 0

async function connectTo(socketPath, child) {
  const deadline = Date.now() + 8000
  for (;;) {
    try {
      const socket = connect(socketPath)
      await new Promise((resolvePromise, rejectPromise) => {
        socket.once('connect', resolvePromise)
        socket.once('error', rejectPromise)
      })
      socket.on('error', () => {})
      socket.on('data', () => {})
      return socket
    } catch (error) {
      if (Date.now() > deadline || child.exitCode !== null) throw error
      await sleep(30)
    }
  }
}

async function round(index) {
  const socketPath = join(workDir, `engine-${index}.sock`)
  const child = spawn(binary, ['--socket', socketPath, '--backend', 'silent', '--sample-rate', '48000', '--buffer-frames', '512'], {
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
  const exited = new Promise((resolvePromise) => child.once('exit', (code, signal) => resolvePromise({ code, signal })))

  const sockets = []
  const writers = []
  try {
    for (let i = 0; i < CLIENTS; i++) sockets.push(await connectTo(socketPath, child))
    // Each connection writes requests as fast as the socket takes them, so at the moment of
    // the stop every connection thread is inside a verb or about to be.
    let id = 1
    for (const socket of sockets) {
      writers.push(
        setInterval(() => {
          for (let n = 0; n < 40; n++) socket.write(`${JSON.stringify({ id: id++, verb: n % 2 ? 'info' : 'clock' })}\n`)
        }, 1)
      )
    }
    await sleep(150)
    child.kill('SIGTERM')
    const result = await Promise.race([exited, sleep(8000).then(() => null)])
    if (result === null) {
      failures++
      console.log(`  FAIL round ${index}: the engine did not leave within 8 s of SIGTERM`)
      child.kill('SIGKILL')
    } else if (result.signal !== null || result.code !== 0) {
      failures++
      console.log(`  FAIL round ${index}: it left as ${result.signal ?? `exit ${result.code}`}\n${stderr}`)
    } else if (/connection thread\(s\) still running/.test(stderr) || /ThreadSanitizer|AddressSanitizer/.test(stderr)) {
      failures++
      console.log(`  FAIL round ${index}: ${stderr.trim().split('\n').slice(-6).join('\n')}`)
    }
  } finally {
    for (const writer of writers) clearInterval(writer)
    for (const socket of sockets) socket.destroy()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
}

console.log(`shutdown-race — ${rounds} stops with ${CLIENTS} connections mid-request each`)
try {
  for (let i = 0; i < rounds; i++) await round(i)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
console.log(failures === 0 ? `  ok   all ${rounds} left cleanly\n` : `\n${failures}/${rounds} rounds failed`)
process.exit(failures === 0 ? 0 : 1)
