#!/usr/bin/env node
/**
 * Device-failure acceptance: a device that stops under the engine is reported and the
 * show is silenced, without the engine stalling on itself doing it.
 *
 * The loss is noticed on the service thread, and the silencing is a panic — a command.
 * Acknowledgements are resolved by that same service thread, so a panic it waits for is
 * a wait on itself: it burns the whole acknowledgement timeout with the answer sitting
 * unread at the front of the event loop it is blocking, and every other command's
 * acknowledgement waits behind it. On the wire that is an engine which reports a lost
 * device and then ignores the desk for two seconds — the operator's stop, their panic,
 * their next GO, all unanswered.
 *
 * Nothing here needs a sound card: the engine runs the silent backend, a voice is
 * started from a WAV this file writes, and the device notification the backend callback
 * would have delivered is injected through the protocol's test verb. The other half of
 * the same fix — the stop a reopen owes its voices, and the restore-failure path that
 * used to deadlock on itself — only happens on a real device: the request comes from a
 * driver, and its failing branch needs two device opens in a row to fail. The successful
 * reopen is driven by device-smoke.mjs on hardware; that failing branch has no automated
 * cover at all.
 *
 *   node native/audio/tests/device-failure.mjs [--binary path]
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
/** A command is answered this long after a device loss, or the pump handling it stalled. */
const ANSWER_DEADLINE_MS = 1000
/** Long enough to catch a late answer and say how late it was, rather than racing it. */
const LATE_ANSWER_MS = 3000
/** The process is gone this long after shutdown, or the failure left a thread behind. */
const EXIT_DEADLINE_MS = 1500

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

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

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
    const pending = message.id !== undefined ? this.pending.get(message.id) : undefined
    if (pending !== undefined) {
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message ?? message.error))
      else pending.resolve(message.result)
      return
    }
    this.events.push(message)
  }

  request(verb, params = {}, timeoutMs = 10000) {
    const id = this.nextId++
    const { promise, resolve: resolvePromise, reject } = Promise.withResolvers()
    const timer = setTimeout(() => {
      this.pending.delete(id)
      reject(new Error(`the engine did not answer ${verb} within ${timeoutMs} ms`))
    }, timeoutMs)
    this.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolvePromise(value)
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

/** A stereo PCM WAV, long enough to still be playing when the device goes. */
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
    const value = Math.round(Math.sin((2 * Math.PI * 440 * frame) / SAMPLE_RATE) * 12000)
    buffer.writeInt16LE(value, 44 + frame * channels * 2)
    buffer.writeInt16LE(value, 44 + frame * channels * 2 + 2)
  }
  writeFileSync(filePath, buffer)
}

const START_OPTIONS = {
  startTime: 0,
  endTime: null,
  loopCount: -1,
  rate: 1,
  trim: 1,
  volume: 1,
  pan: 0,
  fadeInDuration: 0,
  outputs: null
}

if (process.platform === 'win32') {
  // The harness connects over the path the engine listens on, which is a Unix domain
  // socket; Windows is covered by the app's own e2e and ASIO lanes.
  console.log('device failure — skipped: the harness drives the engine over a Unix socket')
  process.exit(0)
}

const workDir = mkdtempSync(join(tmpdir(), 'winslab-device-failure-'))
const tonePath = join(workDir, 'tone.wav')
writeWav(tonePath, 5)
const socketPath = join(workDir, 'engine.sock')
console.log('device failure — silent backend, a device lost under a playing cue')

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

const exited = new Promise((resolvePromise) => {
  if (child.exitCode !== null || child.signalCode !== null) resolvePromise(true)
  else child.once('exit', () => resolvePromise(true))
})

const client = new EngineClient(socketPath)
let connected = true
const connectDeadline = Date.now() + 8000
for (;;) {
  try {
    await client.connect()
    break
  } catch (error) {
    client.socket?.destroy()
    if (Date.now() > connectDeadline) {
      connected = false
      console.log(`  the engine did not accept a connection: ${error.message}\n${stderr}`)
      break
    }
    await sleep(50)
  }
}

/** Starts the cue and waits until the engine reports it moving. */
async function startAndWaitForPlaying() {
  await client.request('start', { cueId: 'tone', whenMs: 0, options: START_OPTIONS })
  const deadline = Date.now() + 2000
  let progress = null
  while (Date.now() < deadline) {
    progress = await client.request('progress', { cueId: 'tone' })
    if (progress?.playing === true && progress.elapsedMs > 0) return progress
    await sleep(10)
  }
  return progress
}

try {
  check('the engine starts', connected)

  if (connected) {
    await client.request('prepare', { cueId: 'tone', filePath: tonePath })

    // Control: the same verb the failure triggers, asked for normally. It reports what it
    // silenced, which is what makes the check after the loss mean something.
    const first = await startAndWaitForPlaying()
    check('a voice is playing before the loss', first?.playing === true, JSON.stringify(first))
    const control = await client.request('panic', { fadeMs: 0 })
    check('a panic before the loss silences the voice it reports', control.ok === true && control.stoppedVoices === 1, JSON.stringify(control))

    const second = await startAndWaitForPlaying()
    check('a second voice is playing when the device goes', second?.playing === true, JSON.stringify(second))

    // The device stops under the engine, exactly as the backend callback delivers it.
    const injectedAt = Date.now()
    await client.request('simulateDeviceNotification', { type: 'stopped', deliberate: false })
    let errors = []
    const reportDeadline = Date.now() + ANSWER_DEADLINE_MS
    while (Date.now() < reportDeadline) {
      errors = client.events.filter((message) => message?.event?.type === 'error')
      if (errors.length > 0) break
      await sleep(10)
    }
    check('the lost device is reported, once, as a device error', errors.length === 1 && errors[0].event.code === 'device', JSON.stringify(errors))
    check('the report names the failure', /stopped unexpectedly/.test(errors[0]?.event?.message ?? ''), JSON.stringify(errors[0] ?? {}))

    // The panic the failure queues is applied by the render thread and reported back to
    // the desk as a panic event — both through the pump that is handling the failure.
    const panicEvents = () => client.events.filter((message) => message?.event?.type === 'panic')
    let announced = 0
    const announceDeadline = Date.now() + ANSWER_DEADLINE_MS
    while (Date.now() < announceDeadline) {
      announced = panicEvents().length
      if (announced >= 2) break
      await sleep(10)
    }
    check('the loss is announced as a panic', announced >= 2, `panics seen: ${announced}`)

    // Now the desk asks for something that needs an acknowledgement of its own. The
    // service thread is the only thread that can answer one, which is why it must never
    // wait for one: if it does, it is inside that wait now, and this is where it shows.
    // The clock is the one that started with the loss, so the time the checks above
    // spent first cannot hide it.
    let followUp = null
    let followUpError = null
    try {
      followUp = await client.request('panic', { fadeMs: 0 }, LATE_ANSWER_MS)
    } catch (error) {
      followUpError = error
    }
    const sinceLossMs = Date.now() - injectedAt
    check(`a command sent during the failure is answered ${sinceLossMs} ms after the loss`, followUp !== null && sinceLossMs < ANSWER_DEADLINE_MS, followUpError?.message ?? '')
    check('the failure is what silenced the voice, not the panic that followed', followUp?.ok === true && followUp.stoppedVoices === 0, JSON.stringify(followUp))

    let after = null
    const silentDeadline = Date.now() + ANSWER_DEADLINE_MS
    while (Date.now() < silentDeadline) {
      after = await client.request('info')
      if (after.active === false && after.activeVoices === 0) break
      await sleep(10)
    }
    check('the show is silent after the loss', after.active === false && after.activeVoices === 0, JSON.stringify({ active: after.active, activeVoices: after.activeVoices }))
    check('the loss is what info reports', /stopped unexpectedly/.test(after.lastError ?? ''), JSON.stringify(after.lastError))

    // A failure must not leave a thread behind waiting on its own acknowledgement: the
    // engine still goes down when it is asked to. SIGTERM, because the shutdown verb
    // leaves the accept loop to the watchdog's six-second goodbye.
    const signalledAt = Date.now()
    child.kill('SIGTERM')
    const gone = await Promise.race([exited, sleep(EXIT_DEADLINE_MS).then(() => false)])
    check(`the engine shuts down after the failure (${Date.now() - signalledAt} ms)`, gone === true, `still running after ${EXIT_DEADLINE_MS} ms\n${stderr}`)
  }
} finally {
  client.close()
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
