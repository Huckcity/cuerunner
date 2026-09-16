#!/usr/bin/env node
/**
 * Silent-pacer acceptance: the device-less backend is the stand-in for a real device, and
 * a real device consumes frames in real time whatever the machine is doing. This suite
 * stalls the pacer on purpose — SIGSTOP, the same starvation a contended runner produces —
 * and asserts the engine's clock keeps wall time across it.
 *
 * A pacer that rebases its deadline after running late silently loses that wall time, and
 * the show clock runs slow with it: a 3000 ms wait then measures as 5-9 s of wall time.
 *
 *   node native/audio/tests/pace.mjs [--binary path]
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const defaultBinary = join(repoRoot, 'native', 'audio', 'build', `cuerunner-audio${process.platform === 'win32' ? '.exe' : ''}`)
const binaryIndex = process.argv.indexOf('--binary')
const binary = binaryIndex >= 0 ? process.argv[binaryIndex + 1] : process.env.CUERUNNER_AUDIO_BIN ?? defaultBinary

const BLOCK_FRAMES = 512
const SAMPLE_RATE = 48000
const BASELINE_MS = 600
const STALL_MS = 500
const SETTLE_MS = 400
/** Slack for a healthy clock, wide enough for socket round trips and a loaded machine. */
const TOLERANCE = 0.05

let failures = 0
let checks = 0
function check(name, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const wallNowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000

class EngineClient {
  constructor(socketPath) {
    this.socketPath = socketPath
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
  }

  async connect() {
    this.socket = connect(this.socketPath)
    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8')
      let newline = this.buffer.indexOf('\n')
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim() !== '') this.handle(line)
        newline = this.buffer.indexOf('\n')
      }
    })
    await new Promise((resolvePromise, rejectPromise) => {
      this.socket.once('connect', resolvePromise)
      this.socket.once('error', rejectPromise)
    })
  }

  handle(line) {
    const message = JSON.parse(line)
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (pending === undefined) return
    this.pending.delete(message.id)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(`${message.error?.code}: ${message.error?.message}`))
  }

  /**
   * A request settles or fails: an engine that dies mid-run must fail the check it was
   * answering, not hang the suite.
   */
  request(verb, params = {}, timeoutMs = 5000) {
    const id = this.nextId++
    const { promise, resolve, reject } = Promise.withResolvers()
    const timer = setTimeout(() => {
      this.pending.delete(id)
      reject(new Error(`the engine did not answer ${verb} within ${timeoutMs} ms`))
    }, timeoutMs)
    this.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      }
    })
    this.socket.write(`${JSON.stringify({ id, verb, ...params })}\n`)
    return promise
  }

  close() {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.reject(new Error('the engine connection closed'))
    }
    this.socket?.destroy()
  }
}

/** The engine's own clock reading, with the wall time it was taken at. */
async function sample(client) {
  const { clockMs } = await client.request('clock')
  return { clockMs, wallMs: wallNowMs() }
}

if (process.platform === 'win32') {
  // SIGSTOP is POSIX; the starvation this injects has no cheap equivalent there yet.
  console.log('pace — skipped: no SIGSTOP on Windows')
  process.exit(0)
}

const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-pace-'))
const socketPath = join(workDir, 'engine.sock')
console.log(`pace — silent backend, ${BLOCK_FRAMES} frame blocks at ${SAMPLE_RATE} Hz`)

const child = spawn(binary, [
  '--socket', socketPath,
  '--backend', 'silent',
  '--sample-rate', String(SAMPLE_RATE),
  '--buffer-frames', String(BLOCK_FRAMES)
], { stdio: ['ignore', 'pipe', 'pipe'] })

let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

const client = new EngineClient(socketPath)
const connectDeadline = Date.now() + 8000
for (;;) {
  try {
    await client.connect()
    break
  } catch (error) {
    if (Date.now() > connectDeadline) {
      console.error(`the engine never accepted a connection: ${error.message}\n${stderr}`)
      child.kill('SIGKILL')
      rmSync(workDir, { recursive: true, force: true })
      process.exit(1)
    }
    await sleep(50)
  }
}

let stalled = false

try {
  await sleep(200)

  console.log('\nclock keeps wall time when the pacer is left alone')
  const before = await sample(client)
  await sleep(BASELINE_MS)
  const after = await sample(client)
  const baselineSlope = (after.clockMs - before.clockMs) / (after.wallMs - before.wallMs)
  check(
    'engine clock tracks wall time',
    Math.abs(baselineSlope - 1) <= TOLERANCE,
    `slope ${baselineSlope.toFixed(4)} over ${(after.wallMs - before.wallMs).toFixed(0)} ms`
  )

  console.log(`\nclock keeps wall time across a ${STALL_MS} ms stall`)
  const stalledFrom = await sample(client)
  process.kill(child.pid, 'SIGSTOP')
  stalled = true
  await sleep(STALL_MS)
  process.kill(child.pid, 'SIGCONT')
  stalled = false
  await sleep(SETTLE_MS)
  const recovered = await sample(client)

  const wall = recovered.wallMs - stalledFrom.wallMs
  const clock = recovered.clockMs - stalledFrom.clockMs
  const slope = clock / wall
  check(
    'a stalled pacer repays the wall time it lost',
    slope >= 1 - TOLERANCE,
    `clock advanced ${clock.toFixed(0)} ms in ${wall.toFixed(0)} ms of wall time (slope ${slope.toFixed(4)}; ` +
      `${(wall - clock).toFixed(0)} ms lost)`
  )
  check(
    'the clock is back in phase after the stall',
    Math.abs(wall - clock) <= 100,
    `${Math.abs(wall - clock).toFixed(0)} ms apart`
  )
} finally {
  // A child left stopped would never answer the shutdown below, and the suite would hang
  // instead of failing, so it is always resumed first.
  if (stalled) {
    try {
      process.kill(child.pid, 'SIGCONT')
    } catch {
      // The child is gone; nothing to resume.
    }
  }
  // The exit is watched from before the shutdown is asked for: a child that has already
  // gone would otherwise leave this waiting on a listener attached too late.
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve(true)
      : new Promise((resolve) => child.once('exit', () => resolve(true)))
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([client.request('shutdown').catch(() => {}), sleep(2000)])
  }
  client.close()
  const killed = await Promise.race([exited, sleep(2000).then(() => false)])
  if (!killed) child.kill('SIGKILL')
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
