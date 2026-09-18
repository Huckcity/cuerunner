#!/usr/bin/env node
/**
 * Streaming acceptance: a seek into the pre-roll is served by the pre-roll.
 *
 * A streamed voice reads through a bounded window of decoded audio kept ahead of the
 * playhead, which is what lets a ninety-second file play without ever being resident. A
 * jump that lands inside that window needs no work at all — the frames are decoded and
 * waiting — and the decoder must not be repositioned for it anyway: doing that throws
 * the window away, reads the same frames back off the disk, and leaves a playing voice
 * with nothing to read for as long as the read takes. That is silence in the output and
 * an underrun in the counters, on a seek the desk had already served from memory.
 *
 * The other half is that a jump outside the window is a reposition: the decoder really
 * does move, the media that comes out is the media from the new position, and the frames
 * spent waiting for it are a reposition rather than starvation.
 *
 *   node native/audio/tests/stream-seek.mjs [--binary path]
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
/** The soak's pre-roll: the window a position has to land inside to be served from it. */
const PREROLL_MS = 750
const SEEK_STEP_MS = 80
/** Seeks per pass over the voices below — a pass repeats until the loop's turns are done. */
const SEEKS_PER_PASS = 4
const SEEK_TURNS = 800
const SEEK_GAP_MS = 5
const SOURCE_SECONDS = 90
const SOURCE_FRAMES = SAMPLE_RATE * SOURCE_SECONDS
/** Wide enough for a socket round trip and for the voice to advance a little. */
const SETTLE_SLACK_MS = 400
const SEEKING = ['ramp', 'ramp2', 'ramp3', 'ramp4']
const BEDS = ['bed1', 'bed2', 'bed3', 'bed4', 'bed5', 'bed6']
const VOICES = SEEKING.length + BEDS.length

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

const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-seek-'))
const sourcePath = join(workDir, 'ramp.wav')
const capturePath = join(workDir, 'capture.wav')

// A ramp long enough for the seeks below to stay inside it: the value of a sample says
// which frame it came from, so the captured mix proves where playback really was.
{
  const channels = 2
  const dataBytes = SOURCE_FRAMES * channels * 4
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
  for (let frame = 0; frame < SOURCE_FRAMES; frame++) {
    const value = frame / SOURCE_FRAMES
    for (let channel = 0; channel < channels; channel++) {
      buffer.writeFloatLE(value, offset)
      offset += 4
    }
  }
  writeFileSync(sourcePath, buffer)
}

/** The frame the last sample of the captured mix was taken from, inverting the ramp. */
function captureTailFrame(path) {
  const buffer = readFileSync(path)
  const channels = buffer.readUInt16LE(22) || 2
  const bytesPerFrame = 4 * channels
  const frames = Math.floor((buffer.length - 44) / bytesPerFrame)
  if (frames <= 0) return null
  return buffer.readFloatLE(44 + (frames - 1) * bytesPerFrame) * SOURCE_FRAMES
}

const socketPath = join(workDir, 'engine.sock')
console.log(
  `stream seek — silent backend, ${PREROLL_MS} ms pre-roll, ${VOICES} streaming voices, ` +
    `${SEEK_TURNS * SEEKS_PER_PASS} seeks of +${SEEK_STEP_MS} ms`
)

const child = spawn(binary, [
  '--socket', socketPath,
  '--backend', 'silent',
  '--sample-rate', String(SAMPLE_RATE),
  '--channels', '2',
  '--buffer-frames', String(BLOCK_FRAMES),
  '--cache-max-file-bytes', '300000',
  '--stream-preroll-ms', String(PREROLL_MS),
  '--stream-max-bytes-per-voice', String(4 * 1024 * 1024),
  '--stream-max-total-bytes', String(64 * 1024 * 1024),
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

try {
  await sleep(150)

  const prepared = await client.request('prepare', { cueId: SEEKING[0], filePath: sourcePath })
  check('the file streams rather than being cached', prepared.streaming === true, JSON.stringify(prepared))
  check(
    'and the fixture is long enough for the seeks below',
    prepared.frames === SOURCE_FRAMES,
    `${prepared.frames} frames against ${SOURCE_FRAMES}`
  )

  console.log('\nthe mix plays before anything is asked of it')
  const start = (cueId, volume) =>
    client.request('start', {
      cueId,
      whenMs: 0,
      options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume, pan: 0, fadeInDuration: 0, outputs: null }
    })
  // Several seekers and a bed of companions, each with a ring of its own: a seek happens
  // inside a mix, and the reader work that could starve it is per voice rather than per
  // seek. Only the first seeker is audible, so the capture below is that voice's own
  // signal and the frame in it can be read back.
  await start(SEEKING[0], 1)
  for (const cueId of [...SEEKING.slice(1), ...BEDS]) {
    await client.request('prepare', { cueId, filePath: sourcePath })
    await start(cueId, 0)
  }
  await sleep(800)

  const playing = await client.request('progress', { cueId: SEEKING[0] })
  check('the seeker is playing', playing !== null && playing.state === 'playing', JSON.stringify(playing))
  const before = await client.request('info')
  check(
    'every voice in the mix is streaming',
    before.media.streamingVoices === VOICES,
    `${before.media.streamingVoices} of ${VOICES}`
  )
  check('nothing has starved yet', before.media.decodeUnderruns === 0, `${before.media.decodeUnderruns} frames of silence`)

  console.log(`\n${SEEK_TURNS} turns of ${SEEKS_PER_PASS} seeks inside the ${PREROLL_MS} ms pre-roll`)
  let issued = 0
  for (let turn = 0; turn < SEEK_TURNS; turn++) {
    for (const cueId of SEEKING) {
      const progress = await client.request('progress', { cueId })
      if (progress === null) continue
      const target = Math.round(progress.elapsedMs + SEEK_STEP_MS)
      if (target > SOURCE_SECONDS * 1000 - 5000) continue
      await client.request('seek', { cueId, positionMs: target })
      issued++
    }
    await sleep(SEEK_GAP_MS)
  }

  // One more in-window seek with the playhead read straight after it: the jump has to
  // land where it was asked to, out of the pre-roll.
  const at = await client.request('progress', { cueId: SEEKING[0] })
  const told = Math.round(at.elapsedMs + SEEK_STEP_MS)
  await client.request('seek', { cueId: SEEKING[0], positionMs: told })
  issued++
  const landed = await client.request('progress', { cueId: SEEKING[0] })
  const afterSeeks = await client.request('info')

  check(
    'an in-window seek is served from the pre-roll, not from the disk',
    afterSeeks.media.decodeUnderruns === 0,
    `${afterSeeks.media.decodeUnderruns} frames of silence over ${issued} seeks`
  )
  check('the seekers are still playing', landed !== null && landed.state === 'playing', JSON.stringify(landed))
  check(
    'and they went where they were told',
    landed !== null && landed.elapsedMs >= told - 100 && landed.elapsedMs <= told + SETTLE_SLACK_MS,
    `asked for ${told} ms, playing at ${landed?.elapsedMs?.toFixed(0)} ms`
  )
  check(
    'no error was raised for a seek that needed no work',
    client.events.filter((event) => event.type === 'error').length === 0,
    JSON.stringify(client.events.filter((event) => event.type === 'error'))
  )

  console.log('\na seek outside the pre-roll is a reposition')
  const starvedBefore = afterSeeks.media.decodeUnderruns
  await client.request('seek', { cueId: SEEKING[0], positionMs: 2000 })
  await sleep(600)
  const repositioned = await client.request('progress', { cueId: SEEKING[0] })
  const afterReposition = await client.request('info')
  check(
    'the voice plays on from the new position',
    repositioned !== null && repositioned.state === 'playing' &&
      repositioned.elapsedMs >= 2000 - 100 && repositioned.elapsedMs <= 2000 + 600 + SETTLE_SLACK_MS,
    JSON.stringify(repositioned)
  )
  const tailFrame = captureTailFrame(capturePath)
  const tailMs = tailFrame === null ? null : (tailFrame * 1000) / SAMPLE_RATE
  check(
    'and the media that came out is the media from there',
    tailMs !== null && tailMs >= 1500 && tailMs <= 2000 + SETTLE_SLACK_MS * 2,
    `the capture's last sample is frame ${tailFrame === null ? '?' : Math.round(tailFrame)} (${tailMs?.toFixed(0)} ms)`
  )
  check(
    'a reposition is not counted as starvation',
    afterReposition.media.decodeUnderruns === starvedBefore,
    `${starvedBefore} → ${afterReposition.media.decodeUnderruns} frames of silence`
  )

  await client.request('stopAll', { fadeMs: 0 }).catch(() => {})
  await sleep(200)
} catch (error) {
  check('the seek suite ran to the end', false, `${error.message}${stderr ? `\n${stderr.trim().split('\n').slice(-3).join('\n')}` : ''}`)
} finally {
  client.close()
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
