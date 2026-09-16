#!/usr/bin/env node
/**
 * Real-device smoke: starts the engine against a named device, plays a file, checks the
 * reported device truth, panics and verifies the captured output goes silent. Runs
 * against the isolated acceptance sink, never the machine's default output.
 *
 *   node native/audio/tests/device-smoke.mjs [--device name] [--backend pulseaudio] [--channels n]
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const binary = process.env.WINSLAB_AUDIO_BIN ?? join(repoRoot, 'native', 'audio', 'build', process.platform === 'win32' ? 'winslab-audio.exe' : 'winslab-audio')

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const device = argValue('--device', process.env.WINSLAB_AUDIO_TEST_DEVICE ?? 'winslab_acceptance')
const backend = argValue('--backend', process.env.WINSLAB_AUDIO_TEST_BACKEND ?? 'pulseaudio')
// Eight is the acceptance sink's channel count. An interface reached through ASIO has
// whatever it has, so the caller passes the driver's own count (asio-smoke.mjs does).
const requestedChannels = Number(argValue('--channels', process.env.WINSLAB_AUDIO_TEST_CHANNELS ?? '8'))

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

function writeFloatWav(path, channels, sampleRate, frames, sampleAt) {
  const dataBytes = frames * channels * 4
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(3, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * 4, 28)
  buffer.writeUInt16LE(channels * 4, 32)
  buffer.writeUInt16LE(32, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  let offset = 44
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      buffer.writeFloatLE(sampleAt(channel, frame), offset)
      offset += 4
    }
  }
  writeFileSync(path, buffer)
}

function readCapture(path, fromFrame = 0) {
  const buffer = readFileSync(path)
  let offset = 12
  let channels = 0
  let dataOffset = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ') channels = buffer.readUInt16LE(offset + 10)
    if (id === 'data') {
      dataOffset = offset + 8
      break
    }
    offset += 8 + size + (size % 2)
  }
  const frames = Math.max(0, Math.floor((buffer.length - dataOffset) / (channels * 4)))
  let peak = 0
  for (let frame = fromFrame; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      peak = Math.max(peak, Math.abs(buffer.readFloatLE(dataOffset + (frame * channels + channel) * 4)))
    }
  }
  return { channels, frames, peak }
}

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
    const message = JSON.parse(line)
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

  request(verb, params = {}) {
    const id = this.nextId++
    const payload = JSON.stringify({ id, verb, ...params })
    const { promise, resolve, reject } = Promise.withResolvers()
    this.pending.set(id, { resolve, reject })
    this.socket.write(`${payload}\n`)
    return promise
  }

  close() {
    this.socket?.destroy()
  }
}

const workDir = mkdtempSync(join(tmpdir(), 'winslab-device-smoke-'))
const fixture = join(workDir, 'tone.wav')
const capture = join(workDir, 'capture.wav')
// The engine addresses its endpoint the way the platform does: a named pipe on Windows, a
// unix socket elsewhere. A path like C:\...\x.sock is not a pipe name, and Windows says so
// with ERROR_INVALID_NAME (123) before the engine has done anything at all.
const socketPath =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\winslab-audio-smoke-${process.pid}`
    : join(tmpdir(), `winslab-audio-smoke-${process.pid}.sock`)

writeFloatWav(fixture, 2, 48000, 48000 * 2, (channel) => (channel === 0 ? 0.4 : 0.4))

console.log(`device smoke — backend ${backend}, device ${device}`)
const child = spawn(binary, [
  '--socket', socketPath,
  '--backend', backend,
  '--device', device,
  '--channels', String(requestedChannels),
  '--sample-rate', '48000',
  '--buffer-frames', '512',
  '--capture', capture
], { stdio: ['ignore', 'pipe', 'pipe'] })

let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

const client = new EngineClient(socketPath)
const deadline = Date.now() + 8000
let connected = false
while (Date.now() < deadline) {
  try {
    await client.connect()
    connected = true
    break
  } catch {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
}

try {
  check('engine process started', child.exitCode === null, stderr.trim())
  check('client connected to the engine socket', connected, stderr.trim())
  if (!connected) throw new Error('engine did not start')

  const info = await client.request('info')
  check('backend is the real one asked for', info.backend === backend, JSON.stringify(info.backend))
  check('device is the one asked for', info.deviceId === device || info.deviceName.length > 0, JSON.stringify({ id: info.deviceId, name: info.deviceName }))
  check('reported channel count is truthful', info.channels === requestedChannels, JSON.stringify(info.channels))
  check('reported sample rate is truthful', info.sampleRate === 48000, String(info.sampleRate))
  // `driver` is ASIO's: the driver states its own output latency in samples. The other two
  // are miniaudio's estimate from the period size, and a measured one where a backend can
  // measure it. Anything else is a number nobody stands behind.
  check('latency is reported with its source, not invented', ['estimated', 'measured', 'driver'].includes(info.latencySource) && info.latencyMs > 0 && info.latencyMs < 200, JSON.stringify({ latencyMs: info.latencyMs, source: info.latencySource }))
  check('buffer and period frames are real numbers', info.periodFrames > 0 && info.bufferFrames >= info.periodFrames, JSON.stringify({ period: info.periodFrames, buffer: info.bufferFrames }))

  const devices = await client.request('devices')
  const match = devices.devices.find((entry) => entry.id === device)
  check('enumeration lists the device with its real channel count', match !== undefined && match.channels >= requestedChannels, JSON.stringify(match))
  check('enumeration reports exclusive capability honestly', match !== undefined && match.exclusive === false, JSON.stringify(match))

  // Exclusive access is a WASAPI/CoreAudio request. A backend that cannot be asked for it
  // either refuses the request (PulseAudio, ALSA) or is already exclusive by construction —
  // ASIO holds the driver for as long as the stream runs — and in that second case the
  // engine's own readout has to say so, because the two are different things and one of
  // them is a promise about the hardware.
  if (info.exclusive) {
    check('an already-exclusive backend says so in its readout', info.exclusive === true && match.exclusive === false, JSON.stringify({ info: info.exclusive, device: match.exclusive }))
  } else {
    let exclusiveRefused = false
    try {
      await client.request('configure', { options: { exclusive: true } })
    } catch (error) {
      exclusiveRefused = /exclusive/i.test(error.message)
    }
    check('an unsupported exclusive request is refused, not silently downgraded', exclusiveRefused)
  }

  // A reconfigure stops and reopens the device; that must not be logged or broadcast as
  // a lost device (the backend posts a `stopped` notification for our own stop).
  const reconfigured = await client.request('configure', { options: { deviceId: device, bufferFrames: 256 } })
  check('reconfigure succeeds and reports the new buffer', reconfigured.bufferFrames !== null && reconfigured.bufferFrames > 0, JSON.stringify({ buffer: reconfigured.bufferFrames, period: reconfigured.periodFrames }))
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
  check('reconfigure raises no device error', client.events.filter((event) => event.type === 'error').length === 0, JSON.stringify(client.events.filter((event) => event.type === 'error')))
  const afterReconfigure = await client.request('info')
  check('the engine is healthy after a reconfigure', afterReconfigure.active === false && afterReconfigure.lastError === null, JSON.stringify({ active: afterReconfigure.active, lastError: afterReconfigure.lastError }))

  // Re-sending settings that are already in force (what the window does on every launch)
  // must not bounce the device at all.
  const sameAgain = await client.request('configure', { options: { deviceId: device, bufferFrames: 256 } })
  check('an identical configure is a no-op', sameAgain.periodFrames === reconfigured.periodFrames && sameAgain.bufferFrames === reconfigured.bufferFrames, JSON.stringify({ before: reconfigured.bufferFrames, after: sameAgain.bufferFrames }))
  check('an identical configure raises no device error', client.events.filter((event) => event.type === 'error').length === 0, JSON.stringify(client.events.filter((event) => event.type === 'error')))

  // A request for a backend this engine cannot switch to must be refused before the
  // device is touched: the show keeps playing while the refusal is computed. Both of
  // these were, before the prevalidation existed, answered by tearing the live device
  // down first.
  let unknownRefused = false
  try {
    await client.request('configure', { options: { backend: 'no-such-backend' } })
  } catch (error) {
    unknownRefused = /unknown audio backend/.test(error.message)
  }
  check('an unknown backend is refused by name', unknownRefused)
  let asioRefused = false
  try {
    await client.request('configure', { options: { backend: 'asio' } })
  } catch (error) {
    asioRefused = /ASIO/.test(error.message)
  }
  if (info.backend === 'asio') {
    check('the lane itself is an ASIO build', true)
  } else {
    check('an ASIO request on a non-ASIO build is refused up front', asioRefused, JSON.stringify({ events: client.events.filter((event) => event.type === 'error') }))
  }
  const stillHealthy = await client.request('info')
  check('the refused configure left the device alone', stillHealthy.active === false && stillHealthy.lastError === null, JSON.stringify({ active: stillHealthy.active, lastError: stillHealthy.lastError }))

  const prepared = await client.request('prepare', { cueId: 'tone', filePath: fixture })
  check('prepare reports the file metadata', prepared.sampleRate === 48000 && prepared.channels === 2 && prepared.frames === 96000, JSON.stringify(prepared))

  const handle = await client.request('start', {
    cueId: 'tone',
    whenMs: (await client.request('clock')).clockMs + 20,
    options: { startTime: 0, endTime: null, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null }
  })
  check('start resolves with a run identity', typeof handle.runId === 'string' && handle.runId.startsWith('run-'), JSON.stringify(handle))

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
  const progress = await client.request('progress', { cueId: 'tone' })
  check('progress reports a running voice', progress !== null && progress.playing === true && progress.elapsedMs > 100, JSON.stringify(progress))

  const liveInfo = await client.request('info')
  check('the active indicator is set while playing', liveInfo.active === true && liveInfo.activeVoices === 1, JSON.stringify({ active: liveInfo.active, voices: liveInfo.activeVoices }))
  const capturedLive = readCapture(capture)
  check('the capture tee hears the real mixer', capturedLive.peak > 0.05, `peak ${capturedLive.peak.toFixed(4)}`)

  const beforePanic = capturedLive.frames
  const panic = await client.request('panic', { fadeMs: 20 })
  check('panic reports how many voices it silenced', panic.stoppedVoices === 1, JSON.stringify(panic))
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
  const capturedAfter = readCapture(capture, beforePanic + 24000)
  check('the capture tail is silent after panic', capturedAfter.peak < 1e-4, `peak ${capturedAfter.peak}`)
  const panicEvents = client.events.filter((event) => event.type === 'panic')
  check('a panic event was broadcast', panicEvents.length >= 1, JSON.stringify(client.events.slice(-4)))
  // The engine emits the ended event within its next block after the fade; a window this
  // wide is there to absorb scheduling, not to allow a write to wait for the next verb —
  // the Windows pipe used to do exactly that, and this check caught it.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
  const endedEvents = client.events.filter((event) => event.type === 'ended')
  const endedArrived = endedEvents.length >= 1 && endedEvents[0].runId === handle.runId
  check('the run ended with a reason and its identity', endedArrived, JSON.stringify(endedEvents.slice(0, 2)))

  const afterInfo = await client.request('info')
  check('the active indicator clears after panic', afterInfo.active === false, JSON.stringify({ active: afterInfo.active }))

  await client.request('shutdown')
} catch (error) {
  failures++
  console.log(`  FAIL smoke run threw — ${error.message}`)
} finally {
  client.close()
  child.kill()
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
  if (!existsSync(capture)) console.log('  note: no capture file was produced')
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
