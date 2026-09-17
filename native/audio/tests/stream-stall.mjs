#!/usr/bin/env node
/**
 * Fault injection: a reader that cannot keep up, mid-show.
 *
 * The streamed path exists so a long file never has to be resident, which means
 * playback depends on reads arriving before the ring runs dry. When they do not — a
 * stalled share, a busy disk, a machine that was asleep at the wrong moment — the
 * engine has to fill the silence, count it, tell the operator, and carry on from where
 * the show actually is. What it must not do is crash, end the cue, or lose the clock.
 *
 * The stall is injected by stopping the engine process outright (SIGSTOP): every part
 * of it that could deliver frames — the pacer, the reader — stops, exactly as it would
 * with a share that has gone away. On resume it owes the wall time it lost and renders
 * the backlog as fast as it can, which drains the ring faster than it can be refilled.
 * That is the starvation a production disk produces, with a definite beginning.
 *
 *   node native/audio/tests/stream-stall.mjs [--binary path]
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const defaultBinary = join(repoRoot, 'native', 'audio', 'build', `cuerunner-audio${process.platform === 'win32' ? '.exe' : ''}`)
const binaryIndex = process.argv.indexOf('--binary')
const binary = binaryIndex >= 0 ? process.argv[binaryIndex + 1] : process.env.CUERUNNER_AUDIO_BIN ?? defaultBinary

const SAMPLE_RATE = 48000
const BLOCK_FRAMES = 512
/** Small enough that the catch-up after the stall cannot be served from the ring. */
const PREROLL_MS = 85
const STALL_MS = 2000
const TOLERANCE = 0.05
/**
 * How the clock check is measured: after the resume, the engine is given a moment to drain
 * (`SETTLE_MS`) and the clock is compared with wall time over a window in which it is
 * actually running (`RUNNING_WINDOW_MS`). A window that spans the SIGSTOP asks the engine to
 * advance a clock while its process is frozen, which no scheduler can do.
 */
const SETTLE_MS = 300
const RUNNING_WINDOW_MS = 400
/**
 * Underruns accrued per second of *rendered audio* before starvation is called a runaway. The
 * engine is answerable for the audio it renders, not for how much of it a busy runner lets it
 * render, so the allowance is per second of audio rather than per second of wall time.
 */
const RUNAWAY_UNDERRUNS_PER_SECOND = 2000

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
    await new Promise((resolvePromise, rejectPromise) => {
      this.socket.once('connect', resolvePromise)
      this.socket.once('error', rejectPromise)
    })
  }

  handle(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(`${message.error?.code}: ${message.error?.message}`))
      return
    }
    if (message.event) this.events.push(message.event)
  }

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

if (process.platform === 'win32') {
  // SIGSTOP is POSIX; the starvation this injects has no cheap equivalent there yet.
  console.log('stream stall — skipped: no SIGSTOP on Windows')
  process.exit(0)
}

const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-stall-'))
const sourcePath = join(workDir, 'long.wav')
const capturePath = join(workDir, 'capture.wav')

// Four seconds of a ramp: the value of a sample says which frame it came from, so the
// capture proves where playback really was, not merely that it was still running.
{
  const channels = 2
  const frames = SAMPLE_RATE * 10
  const dataBytes = frames * channels * 4
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(3, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * channels * 4, 28)
  buffer.writeUInt16LE(channels * 4, 32)
  buffer.writeUInt16LE(32, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  let offset = 44
  for (let frame = 0; frame < frames; frame++) {
    const value = frame / 480000
    for (let channel = 0; channel < channels; channel++) {
      buffer.writeFloatLE(value, offset)
      offset += 4
    }
  }
  writeFileSync(sourcePath, buffer)
}

const socketPath = join(workDir, 'engine.sock')
console.log(`stream stall — silent backend, ${PREROLL_MS} ms pre-roll, ${STALL_MS} ms stalled reader`)

const child = spawn(binary, [
  '--socket', socketPath,
  '--backend', 'silent',
  '--sample-rate', String(SAMPLE_RATE),
  '--buffer-frames', String(BLOCK_FRAMES),
  '--cache-max-file-bytes', '300000',
  '--stream-preroll-ms', String(PREROLL_MS),
  '--capture', capturePath
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

let stalled = false

try {
  await sleep(150)

  console.log('\nthe streamed cue plays before anything goes wrong')
  const prepared = await client.request('prepare', { cueId: 'long', filePath: sourcePath })
  check('the file streams rather than being cached', prepared.streaming === true, JSON.stringify(prepared))
  await client.request('start', {
    cueId: 'long',
    whenMs: 0,
    options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null }
  })
  await sleep(700)
  const before = await client.request('progress', { cueId: 'long' })
  const infoBefore = await client.request('info')
  check('the voice is playing', before !== null && before.state === 'playing', JSON.stringify(before))
  check(
    'and its position is advancing',
    before.elapsedMs > 400,
    `${before.elapsedMs.toFixed(0)} ms after ~700 ms`
  )
  check('nothing has starved yet', infoBefore.media.decodeUnderruns === 0, JSON.stringify(infoBefore.media))

  console.log(`\nthe reader stalls for ${STALL_MS} ms`)
  process.kill(child.pid, 'SIGSTOP')
  stalled = true
  await sleep(STALL_MS)
  process.kill(child.pid, 'SIGCONT')
  stalled = false

  // The engine owes the wall time it lost and renders the backlog as fast as it can,
  // which is what drains the ring: the wait for media becomes visible in its counters.
  const underrunDeadline = Date.now() + 8000
  let infoAfter = await client.request('info')
  while (infoAfter.media.decodeUnderruns === 0 && Date.now() < underrunDeadline) {
    await sleep(100)
    infoAfter = await client.request('info')
  }
  const progressStarved = await client.request('progress', { cueId: 'long' })
  check(
    'the wait for the reader is counted',
    infoAfter.media.decodeUnderruns > 0,
    `decodeUnderruns ${infoAfter.media.decodeUnderruns} after 8 s`
  )
  check(
    'and it is surfaced as a warning',
    (infoAfter.warnings ?? []).some((warning) => /streaming underruns/.test(warning)),
    JSON.stringify(infoAfter.warnings)
  )

  console.log('\nthe show carries on')
  // Measured over a *running* window, after the engine has been resumed and has had its
  // chance to drain. Whether it *repays* the stalled time is the audio check below, which is
  // the one that catches a show that never caught up.
  await sleep(SETTLE_MS)
  const clockBeforeRun = await client.request('clock')
  const wallBeforeRun = wallNowMs()
  await sleep(RUNNING_WINDOW_MS)
  const clockAfter = await client.request('clock')
  const wallAfter = wallNowMs()
  const clockAdvanced = clockAfter.clockMs - clockBeforeRun.clockMs
  const wallAdvanced = wallAfter - wallBeforeRun
  check(
    'the show clock keeps wall time while it runs',
    wallAdvanced > 0 && clockAdvanced / wallAdvanced >= 1 - TOLERANCE,
    `clock advanced ${clockAdvanced.toFixed(0)} ms in ${wallAdvanced.toFixed(0)} ms of wall time`
  )

  await sleep(400)
  const after = await client.request('progress', { cueId: 'long' })
  const infoSettled = await client.request('info')
  check(
    'the cue is still playing, not ended',
    after !== null && after.state === 'playing',
    JSON.stringify(after)
  )
  check(
    'and the stream caught up again',
    after !== null && progressStarved !== null && after.elapsedMs > progressStarved.elapsedMs + 200,
    `position ${progressStarved?.elapsedMs?.toFixed(0)} ms while starved → ${after?.elapsedMs?.toFixed(0)} ms`
  )
  // Counted per second of audio the engine actually rendered rather than per second of wall
  // time: a busy runner renders less audio in the same window and accrues more underruns while
  // it does, so an absolute allowance would be measuring the machine. What the engine is
  // answerable for is whether starvation runs away — an unbounded cascade — so that is what is
  // counted, and the audio it managed is the denominator.
  const renderedSeconds = Math.max(0.001, (after?.elapsedMs - progressStarved?.elapsedMs) / 1000)
  const accrued = infoSettled.media.decodeUnderruns - infoAfter.media.decodeUnderruns
  check(
    'the starvation stopped rather than running away',
    accrued / renderedSeconds <= RUNAWAY_UNDERRUNS_PER_SECOND,
    `${infoAfter.media.decodeUnderruns} → ${infoSettled.media.decodeUnderruns} over ${renderedSeconds.toFixed(2)} s of audio (${(accrued / renderedSeconds).toFixed(0)}/s)`
  )
  check('no error was raised for a slow read', client.events.filter((event) => event.type === 'error').length === 0, JSON.stringify(client.events.filter((event) => event.type === 'error')))

  // The engine tees its real mixer output; the tail of it must be the ramp again, not
  // the silence the starved frames were filled with.
  await client.request('stopAll', { fadeMs: 0 }).catch(() => {})
  await sleep(200)
  child.kill('SIGKILL')
  await sleep(100)
  let peakInTail = 0
  try {
    const buffer = readFileSync(capturePath)
    const channels = buffer.readUInt16LE(22) || 2
    const bytesPerFrame = 4 * channels
    const frames = Math.floor((buffer.length - 44) / bytesPerFrame)
    for (let frame = Math.max(0, frames - SAMPLE_RATE / 2); frame < frames; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        peakInTail = Math.max(peakInTail, Math.abs(buffer.readFloatLE(44 + frame * bytesPerFrame + channel * 4)))
      }
    }
  } catch (error) {
    check('the capture could be read', false, error.message)
  }
  check('audio, not silence, is what came out of the stall', peakInTail > 0.1, `tail peak ${peakInTail.toFixed(4)}`)
} finally {
  if (stalled) {
    try {
      process.kill(child.pid, 'SIGCONT')
    } catch {
      // The child is gone; nothing to resume.
    }
  }
  client.close()
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
