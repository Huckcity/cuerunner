#!/usr/bin/env node
/**
 * Priority acceptance: a GO is not made to wait for a file to be scanned.
 *
 * The engine answers a connection's requests one at a time, on that connection's
 * thread. The waveform envelope and the onset scan read a whole file and take a second
 * or more on a long one, and the app asks for both whenever a cue is selected — so the
 * operator picking a cue and hitting GO is the ordinary case. Run on the connection's
 * own thread, those two scans pushed the GO's prepare and start behind them and the
 * sound arrived when the scan finished: the wait that is heard as "it takes a moment
 * before the track starts".
 *
 * This is the wire-level contract for the fix. With a three-minute file's envelope and
 * onset scan both in flight and unanswered, the start is answered, and the voice is
 * playing and moving, on the same connection — and neither of those two requests has
 * answered yet.
 *
 *   node native/audio/tests/analysis-priority.mjs [--binary path]
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const defaultBinary = join(repoRoot, 'native', 'audio', 'build', `winslab-audio${process.platform === 'win32' ? '.exe' : ''}`)
const binaryIndex = process.argv.indexOf('--binary')
const binary = binaryIndex >= 0 ? process.argv[binaryIndex + 1] : process.env.WINSLAB_AUDIO_BIN ?? defaultBinary

const SAMPLE_RATE = 48000
const BLOCK_FRAMES = 512
/** Long enough that its scan cannot be mistaken for a round trip on any machine. */
const LONG_SECONDS = 180
const SHORT_SECONDS = 4
/** Wide enough for a scan to be under way, narrow enough to catch a start that waited for it. */
const START_DEADLINE_MS = 500

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

class EngineClient {
  constructor(socketPath) {
    this.socketPath = socketPath
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
    this.events = []
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
    await new Promise((resolve, reject) => {
      this.socket.once('connect', resolve)
      this.socket.once('error', reject)
    })
  }

  handle(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const pending = message.id !== undefined ? this.pending.get(message.id) : undefined
    if (pending !== undefined) {
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message ?? message.error))
      else pending.resolve(message.result)
      return
    }
    this.events.push(message)
  }

  request(verb, params = {}, timeoutMs = 30000) {
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
    return { id, promise }
  }

  close() {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.reject(new Error('the engine connection closed'))
    }
    this.socket?.destroy()
  }
}

/** A WAV of `seconds` — a tone with a beat, so a scan has something to find. */
function writeWav(filePath, seconds) {
  const channels = 2
  const frames = SAMPLE_RATE * seconds
  const dataBytes = frames * channels * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * channels * 2, 28)
  buffer.writeUInt16LE(channels * 2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let frame = 0; frame < frames; frame++) {
    const beat = frame % SAMPLE_RATE < SAMPLE_RATE / 8 ? 1 : 0.25
    const value = Math.round(Math.sin((2 * Math.PI * 440 * frame) / SAMPLE_RATE) * 12000 * beat)
    buffer.writeInt16LE(value, 44 + frame * channels * 2)
    buffer.writeInt16LE(value, 44 + frame * channels * 2 + 2)
  }
  writeFileSync(filePath, buffer)
}

const workDir = mkdtempSync(join(tmpdir(), 'winslab-priority-'))
const longPath = join(workDir, 'concert.wav')
const shortPath = join(workDir, 'sting.wav')
writeWav(longPath, LONG_SECONDS)
writeWav(shortPath, SHORT_SECONDS)

const socketPath = join(workDir, 'engine.sock')
console.log(`analysis priority — silent backend, ${LONG_SECONDS}s file scanned while ${SHORT_SECONDS}s cue starts`)

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
    client.socket?.destroy()
    if (Date.now() > connectDeadline) {
      console.error(`the engine never accepted a connection: ${error.message}\n${stderr}`)
      child.kill('SIGKILL')
      rmSync(workDir, { recursive: true, force: true })
      process.exit(1)
    }
    await sleep(50)
  }
}

try {
  await sleep(150)

  await client.request('prepare', { cueId: 'long', filePath: longPath }).promise
  await client.request('prepare', { cueId: 'short', filePath: shortPath }).promise

  console.log('\nthe panel is reading a three-minute file', )
  const answered = []
  const onsets = client.request('onsets', { filePath: longPath })
  const waveform = client.request('waveform', { filePath: longPath, points: 1024 })
  onsets.promise.then(() => answered.push('onsets')).catch(() => answered.push('onsets-failed'))
  waveform.promise.then(() => answered.push('waveform')).catch(() => answered.push('waveform-failed'))
  await sleep(60)

  console.log('\nthe operator hits GO while it is still reading')
  const sentAt = Date.now()
  const start = await client.request('start', {
    cueId: 'short',
    whenMs: 0,
    options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null }
  }).promise
  const startMs = Date.now() - sentAt
  check('the start is answered while both scans are still running', answered.length === 0, `already answered: ${answered.join(', ')}`)
  check(`the start is answered promptly (${startMs} ms)`, startMs < START_DEADLINE_MS, `${startMs} ms`)
  check('the voice is the one the engine just made', typeof start.runId === 'string' && start.runId !== '', JSON.stringify(start))

  // The same connection, still busy with two whole-file scans, is the one the position
  // and the clock are read from: if the scans held it, neither of these could answer.
  let progress = null
  const progressDeadline = Date.now() + 1000
  while ((progress === null || progress.elapsedMs <= 0) && Date.now() < progressDeadline) {
    progress = await client.request('progress', { cueId: 'short' }).promise
    if (progress === null || progress.elapsedMs <= 0) await sleep(25)
  }
  const clock = await client.request('clock').promise
  check('the voice is playing before the scans are done', progress !== null && progress.playing === true, JSON.stringify(progress))
  check('and its position is moving', progress !== null && progress.elapsedMs > 0, JSON.stringify(progress))
  check('the clock still answers', typeof clock.clockMs === 'number' && clock.clockMs > 0)
  check('the scans were still running throughout', answered.length === 0, `answered: ${answered.join(', ')}`)

  const startOfScan = Date.now()
  await Promise.all([onsets.promise, waveform.promise])
  const scanMs = Date.now() - startOfScan
  check(`the scans did finish (waited ${scanMs} ms more)`, answered.length === 2, `answered: ${answered.join(', ')}`)

  await client.request('stop', { cueId: 'short', fadeMs: 0 }).promise
} finally {
  client.close()
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
  }
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
