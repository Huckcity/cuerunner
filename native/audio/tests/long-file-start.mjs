#!/usr/bin/env node
/**
 * Long-file acceptance: the region an operator trims out of a very long recording.
 *
 * The file this is about is the one download the operator keeps around for one sound:
 * twelve hours of rain, trimmed to the thirty seconds they want under a scene. Somewhere
 * in the middle of it, because a middle is where the good part is. Two things have to
 * hold for that to be a show cue rather than a wait:
 *
 *   - a start deep in the file makes sound promptly. dr_mp3 without a seek table decodes
 *     forward from the start of the stream to reach a target, which on an hour-deep
 *     region is seconds of silence before the first sample — so the engine measures the
 *     file once (a frame count and a dr_mp3 seek table) and enters it from the table.
 *   - the start's acknowledgement is prompt even while the engine is reading a file. An
 *     acknowledgement is a promise to the connection thread, which is waiting on it with
 *     a deadline; it used to be resolved by the thread that does the reading, so a long
 *     read answered a command late enough that a start which was already audible was
 *     reported as one that never arrived.
 *
 * The fixture is ninety seconds of tone, concatenated here into an hour: frames
 * concatenate, and the file states no length, so the engine has to measure it the same
 * way it measures a download that was cut and rejoined.
 *
 *   node native/audio/tests/long-file-start.mjs [--binary path]
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const defaultBinary = join(repoRoot, 'native', 'audio', 'build', `cuerunner-audio${process.platform === 'win32' ? '.exe' : ''}`)
const binaryIndex = process.argv.indexOf('--binary')
const binary = binaryIndex >= 0 ? process.argv[binaryIndex + 1] : process.env.CUERUNNER_AUDIO_BIN ?? defaultBinary

const SAMPLE_RATE = 48000
const BLOCK_FRAMES = 512
const FIXTURE = join(repoRoot, 'native', 'audio', 'tests', 'fixtures', 'long-tone.mp3')
const COPIES = 60
/** 55 minutes in: far enough that a seek without a table is seconds of decode. */
const DEEP_START_SECONDS = 55 * 60
const REGION_SECONDS = 30
/** The ack is a socket round trip; the sound is a socket round trip plus a seek. */
const ACK_DEADLINE_MS = 500
const SOUND_DEADLINE_MS = 1000
/** A whole-file scan is running when the engine is asked to stop; it may not be waited
 *  for — the scan of this fixture runs for a second or more, and the engine's own way
 *  down is milliseconds. */
const SHUTDOWN_DEADLINE_MS = 600
const SCAN_SETTLE_MS = 200

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
const wall = () => Date.now()

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
      resolve: (value) => { clearTimeout(timer); resolve(value) },
      reject: (error) => { clearTimeout(timer); reject(error) }
    })
    this.socket.write(`${JSON.stringify({ id, verb, ...params })}\n`)
    return { promise, sent: wall() }
  }

  close() {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.reject(new Error('the engine connection closed'))
    }
    this.socket?.destroy()
  }
}

/** Wall ms from `start` to the first captured sample after `marker`, or null. */
async function firstSound(capturePath, marker, start, budgetMs) {
  const deadline = wall() + budgetMs
  while (wall() < deadline) {
    try {
      const size = statSync(capturePath).size
      const from = Math.max(44, marker)
      if (size > from) {
        const buffer = readFileSync(capturePath).subarray(from)
        for (let i = 0; i + 4 <= buffer.length; i += 8) {
          if (Math.abs(buffer.readFloatLE(i)) > 1e-4) return wall() - start
        }
      }
    } catch {
      // The capture is not there yet.
    }
    await sleep(10)
  }
  return null
}

const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-long-'))
const sourcePath = join(workDir, 'hour-of-rain.mp3')
const capturePath = join(workDir, 'capture.wav')

// An hour of the fixture's ninety seconds: whole MP3 frames, joined in order.
{
  const chunk = readFileSync(FIXTURE)
  const parts = new Array(COPIES).fill(chunk)
  writeFileSync(sourcePath, Buffer.concat(parts))
}

const socketPath = join(workDir, 'engine.sock')
const copiedMb = (statSync(sourcePath).size / 1e6).toFixed(0)
console.log(`long file start — ${COPIES} x 90 s concatenated (${copiedMb} MB), region at ${DEEP_START_SECONDS / 60} min`)

const child = spawn(binary, [
  '--socket', socketPath,
  '--backend', 'silent',
  '--sample-rate', String(SAMPLE_RATE),
  '--buffer-frames', String(BLOCK_FRAMES),
  '--capture', capturePath
], { stdio: ['ignore', 'pipe', 'pipe'] })

let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
const client = new EngineClient(socketPath)
const connectDeadline = wall() + 8000
for (;;) {
  try {
    await client.connect()
    break
  } catch (error) {
    client.socket?.destroy()
    if (wall() > connectDeadline) {
      console.error(`the engine never accepted a connection: ${error.message}\n${stderr}`)
      child.kill('SIGKILL')
      rmSync(workDir, { recursive: true, force: true })
      process.exit(1)
    }
    await sleep(50)
  }
}

const options = (startSeconds) => ({
  startTime: startSeconds * 1000,
  endTime: startSeconds * 1000 + REGION_SECONDS * 1000,
  loopCount: 0,
  rate: 1,
  trim: 1,
  volume: 1,
  pan: 0,
  fadeInDuration: 0,
  outputs: null
})

try {
  await sleep(150)

  const preparedAt = wall()
  const prepared = await client.request('prepare', { cueId: 'storm', filePath: sourcePath }).promise
  console.log(`\nthe hour-long file is measured once, at the first open: ${wall() - preparedAt} ms (${(prepared.durationMs / 60000).toFixed(0)} min)`)
  check('the file is streamed rather than held decoded', prepared.streaming === true, JSON.stringify(prepared))
  check('its length is stated after the single pass', prepared.durationMs > 59 * 60000, `${prepared.durationMs} ms`)

  console.log(`\nthe operator fires the region at ${DEEP_START_SECONDS / 60} min`)
  const marker = statSync(capturePath).size
  const start = client.request('start', { cueId: 'storm', whenMs: 0, options: options(DEEP_START_SECONDS) })
  let ackMs = null
  let ackError = null
  try {
    await start.promise
    ackMs = wall() - start.sent
  } catch (error) {
    ackError = error.message
    ackMs = wall() - start.sent
  }
  const sound = await firstSound(capturePath, marker, start.sent, 6000)
  check('the start is acknowledged without waiting for the file', ackError === null && ackMs < ACK_DEADLINE_MS,
    ackError ?? `${ackMs} ms`)
  check(`the region makes sound promptly (${sound === null ? 'never' : `${sound} ms`})`,
    sound !== null && sound < SOUND_DEADLINE_MS, `${sound} ms`)
  await client.request('stop', { cueId: 'storm', fadeMs: 0 }).promise
  await sleep(200)

  console.log('\na second region, with the file already measured')
  const secondMarker = statSync(capturePath).size
  const second = client.request('start', { cueId: 'storm', whenMs: 0, options: options(300) })
  await second.promise
  const secondSound = await firstSound(capturePath, secondMarker, second.sent, 6000)
  check(`the second region makes sound promptly (${secondSound === null ? 'never' : `${secondSound} ms`})`,
    secondSound !== null && secondSound < SOUND_DEADLINE_MS, `${secondSound} ms`)
  await client.request('stop', { cueId: 'storm', fadeMs: 0 }).promise

  // A twelve-hour WAV cannot be a RIFF file: its sizes are 32-bit, so the same recording
  // arrives as RF64 (EBU Tech 3306) or under Sony's Wave64 GUID. Both are WAV to dr_wav;
  // the sniffer is what has to let them through, and a region deep inside one has to
  // start as promptly as the MP3's does. The fixture is sparse: a header, one thirty-
  // second region six hours in, and holes everywhere else.
  console.log('\nthe same twelve hours as a WAV (RF64, past what a RIFF header can state)')
  const WAV_HOURS = 12
  const WAV_FRAMES = WAV_HOURS * 3600 * SAMPLE_RATE
  const WAV_CHANNELS = 2
  const wavBytes = WAV_FRAMES * WAV_CHANNELS * 2
  const wavPath = join(workDir, 'rain-rf64.wav')
  {
    const header = Buffer.alloc(80)
    header.write('RF64', 0)
    header.writeUInt32LE(0xffffffff, 4)
    header.write('WAVE', 8)
    header.write('ds64', 12)
    header.writeUInt32LE(28, 16)
    header.writeBigUInt64LE(BigInt(72 + wavBytes), 20)
    header.writeBigUInt64LE(BigInt(wavBytes), 28)
    header.writeBigUInt64LE(BigInt(WAV_FRAMES), 36)
    header.writeUInt32LE(0, 44)
    header.write('fmt ', 48)
    header.writeUInt32LE(16, 52)
    header.writeUInt16LE(1, 56)
    header.writeUInt16LE(WAV_CHANNELS, 58)
    header.writeUInt32LE(SAMPLE_RATE, 60)
    header.writeUInt32LE(SAMPLE_RATE * WAV_CHANNELS * 2, 64)
    header.writeUInt16LE(WAV_CHANNELS * 2, 68)
    header.writeUInt16LE(16, 70)
    header.write('data', 72)
    header.writeUInt32LE(0xffffffff, 76)
    writeFileSync(wavPath, header)
    const wavFd = openSync(wavPath, 'r+')
    const toneFrames = REGION_SECONDS * SAMPLE_RATE
    const tone = Buffer.alloc(toneFrames * WAV_CHANNELS * 2)
    for (let frame = 0; frame < toneFrames; frame++) {
      const value = Math.round(Math.sin((2 * Math.PI * 300 * frame) / SAMPLE_RATE) * 12000)
      tone.writeInt16LE(value, frame * WAV_CHANNELS * 2)
      tone.writeInt16LE(value, frame * WAV_CHANNELS * 2 + 2)
    }
    writeSync(wavFd, tone, 0, tone.length, 80 + DEEP_START_SECONDS * SAMPLE_RATE * WAV_CHANNELS * 2)
    ftruncateSync(wavFd, 80 + wavBytes)
    closeSync(wavFd)
  }
  let wavPrepared = null
  let wavRefusal = null
  try {
    wavPrepared = await client.request('prepare', { cueId: 'rain', filePath: wavPath }).promise
  } catch (error) {
    wavRefusal = error.message
  }
  check('the WAV states its twelve hours',
    wavPrepared !== null && Math.abs(wavPrepared.durationMs - WAV_HOURS * 3600000) < 2000,
    wavRefusal ?? `${wavPrepared?.durationMs} ms`)
  const wavMarker = statSync(capturePath).size
  const wavStart = client.request('start', { cueId: 'rain', whenMs: 0, options: options(DEEP_START_SECONDS) })
  let wavStartError = null
  try {
    await wavStart.promise
  } catch (error) {
    wavStartError = error.message
  }
  const wavSound = wavStartError === null ? await firstSound(capturePath, wavMarker, wavStart.sent, 6000) : null
  check(`the WAV region makes sound promptly (${wavSound === null ? 'never' : `${wavSound} ms`})`,
    wavStartError === null && wavSound !== null && wavSound < SOUND_DEADLINE_MS, wavStartError ?? `${wavSound} ms`)
  await client.request('stop', { cueId: 'rain', fadeMs: 0 }).promise

  // Sony's Wave64 is the same container under a GUID header — the one a converter writes
  // for .w64 — and the fixture here is a real one, a second of tone at 8 kHz.
  console.log('\na Wave64, from the other converter')
  const w64 = join(repoRoot, 'native', 'audio', 'tests', 'fixtures', 'tone.w64')
  let w64Prepared = null
  let w64Refusal = null
  try {
    w64Prepared = await client.request('prepare', { cueId: 'w64', filePath: w64 }).promise
  } catch (error) {
    w64Refusal = error.message
  }
  check('a Wave64 is read as wav',
    w64Prepared !== null && w64Prepared.format === 'wav' && w64Prepared.sampleRate === 8000,
    w64Refusal ?? JSON.stringify(w64Prepared))
  const w64Marker = statSync(capturePath).size
  const w64Start = client.request('start', { cueId: 'w64', whenMs: 0, options: options(0) })
  let w64StartError = null
  try {
    await w64Start.promise
  } catch (error) {
    w64StartError = error.message
  }
  const w64Sound = w64StartError === null ? await firstSound(capturePath, w64Marker, w64Start.sent, 4000) : null
  check(`the Wave64 plays (${w64Sound === null ? 'never' : `${w64Sound} ms`})`,
    w64StartError === null && w64Sound !== null && w64Sound < SOUND_DEADLINE_MS, w64StartError ?? `${w64Sound} ms`)
  await client.request('stop', { cueId: 'w64', fadeMs: 0 }).promise

  console.log('\nthe engine is stopped while it is reading the file end to end')
  let scanFinished = false
  void client
    .request('waveform', { filePath: sourcePath, points: 1024 }, 120000)
    .promise.then(() => { scanFinished = true })
    .catch(() => { scanFinished = true })
  await sleep(SCAN_SETTLE_MS)
  check('the scan is still in flight when the stop arrives', !scanFinished)
  const stoppedAt = wall()
  child.kill('SIGTERM')
  const exitedIn = await Promise.race([
    exited.then(() => wall() - stoppedAt),
    sleep(SHUTDOWN_DEADLINE_MS + 500).then(() => null)
  ])
  check(`the engine goes down without waiting for the scan (${exitedIn === null ? 'still running' : `${exitedIn} ms`})`,
    exitedIn !== null && exitedIn < SHUTDOWN_DEADLINE_MS, `${exitedIn} ms`)
} finally {
  client.close()
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
  }
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
