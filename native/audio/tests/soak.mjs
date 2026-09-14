#!/usr/bin/env node
/**
 * Soak acceptance: a long show, run in real time against the silent pacer.
 *
 * The offline suite proves samples and frames; this proves *time*. Hours of hundreds
 * of overlapping voices, fades, loops, seeks and routing changes, driven over the same
 * socket protocol the app uses, on a backend that consumes frames in real time the way
 * a device does. The questions it answers are the ones a rehearsal cannot: does the
 * sample clock stay with the wall clock, does every scheduled cue start where it was
 * scheduled, does anything leak, and do the engine's own health counters stay at zero
 * over eight hours rather than eight minutes.
 *
 *   node native/audio/tests/soak.mjs [--minutes 60] [--seed 1234] [--shard 2 --shards 8]
 *                                  [--voices 24] [--channels 2] [--report soak.json]
 *
 * A shard is just a seed: `--shard i --shards n` runs the i-th of n independent shows,
 * so a nightly job can cover eight hours as eight one-hour jobs that fail separately.
 * The report is JSON and is written whatever the outcome, including on a crash.
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function argValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

const BINARY =
  argValue('binary', process.env.WINSLAB_AUDIO_BIN ?? join(repoRoot, 'native', 'audio', 'build', `winslab-audio${process.platform === 'win32' ? '.exe' : ''}`))
const MINUTES = Number(argValue('minutes', 2))
const SHARDS = Number(argValue('shards', 1))
const SHARD = Number(argValue('shard', 0))
const SEED = Number(argValue('seed', 0)) || (0x9e3779b1 * (SHARD + 1)) >>> 0
const VOICES = Number(argValue('voices', 24))
const CHANNELS = Number(argValue('channels', 2))
const SAMPLE_RATE = 48000
const BLOCK_FRAMES = Number(argValue('block-frames', 512))
const SAMPLE_SECONDS = Number(argValue('sample-seconds', 5))
const XRUN_BUDGET = Number(argValue('xrun-budget', 0))
const REPORT_PATH = typeof argValue('report', '') === 'string' ? argValue('report', '') : ''
const VERBOSE = process.argv.includes('--verbose')

/** Stated tolerances. Both are in the report, so a claim about them can be checked. */
const CLOCK_TOLERANCE_PCT = 0.5 // |engine clock − wall clock| over the whole run
const START_TOLERANCE_MS = (1000 * BLOCK_FRAMES) / SAMPLE_RATE + 5 // block quantisation + slack

const SHOW_MS = Math.round(MINUTES * 60_000)
const BLOCK_MS = (1000 * BLOCK_FRAMES) / SAMPLE_RATE
// What the engine is allowed to hold: decoded media (the cache) and decoded-but-unplayed
// streamed audio. Both are asserted against the peaks, so a leak over a long show is a
// finding rather than a slow machine.
const CACHE_MAX_BYTES = 192 * 1024 * 1024
const STREAM_MAX_TOTAL_BYTES = 64 * 1024 * 1024

// ── Determinism ─────────────────────────────────────────────────────────────
// mulberry32: two runs with the same seed make the same show, so a failure can be
// replayed with the same shapes and a different machine.
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(SEED)
const between = (low, high) => low + rng() * (high - low)
const pick = (list) => list[Math.floor(rng() * list.length)]
const intBetween = (low, high) => Math.floor(between(low, high + 1))

// ── Media ───────────────────────────────────────────────────────────────────
const workDir = mkdtempSync(join(tmpdir(), 'winslab-soak-'))

function writeFloatWav(path, channels, sampleRate, frames, sampleAt) {
  const dataBytes = frames * channels * 4
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(3, 20) // IEEE float
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

// Four sources, chosen so the show covers the engine's paths: a stereo file that fits
// the cache, a mono file at 44.1 kHz (so every voice resamples), a four-channel file
// (so explicit matrices have something to route), and a long file that streams.
const tone = (hz, rate) => (channel, frame) =>
  0.4 * Math.sin((2 * Math.PI * (hz + channel * 37) * frame) / rate)

const sources = [
  { name: 'stereo', path: join(workDir, 'stereo-48k.wav'), channels: 2, rate: SAMPLE_RATE, seconds: 2.5, weight: 3 },
  { name: 'mono', path: join(workDir, 'mono-44k.wav'), channels: 1, rate: 44100, seconds: 2, weight: 2 },
  { name: 'quad', path: join(workDir, 'quad-48k.wav'), channels: 4, rate: SAMPLE_RATE, seconds: 1.5, weight: 2 },
  { name: 'long', path: join(workDir, 'long-48k.wav'), channels: 2, rate: SAMPLE_RATE, seconds: 90, weight: 2, streamed: true }
]
for (const source of sources) {
  writeFloatWav(source.path, source.channels, source.rate, Math.round(source.rate * source.seconds), tone(220, source.rate))
}
const weightedSources = sources.flatMap((source) => Array(source.weight).fill(source))
const streamedSources = sources.filter((source) => source.streamed)

// ── The show ────────────────────────────────────────────────────────────────
/**
 * A show as a list of timed actions, decided up front from the seed. The driver then
 * only has to issue each action while the engine clock is at the right place, which
 * keeps the show itself out of the timing measurement.
 */
function planShow() {
  const actions = []
  const cues = []
  const stats = { prepares: 0, starts: 0, fades: 0, seeks: 0, routings: 0, stops: 0, stopAlls: 0, skippedStart: 0, skippedStreamed: 0 }
  const endedAt = new Map()
  let cueSeq = 0

  const liveAt = (atMs) =>
    cues.filter((cue) => {
      const ended = endedAt.get(cue.cueId)
      if (ended !== undefined && ended <= atMs) return false
      if (cue.startMs > atMs) return false
      return cue.endMs === null || cue.endMs > atMs
    })

  const sourceOptions = (source) => {
    const options = {
      startTime: 0,
      endTime: null,
      loopCount: 0,
      rate: 1,
      trim: 1,
      volume: between(0.3, 1),
      pan: between(-1, 1),
      fadeInDuration: rng() < 0.3 ? intBetween(20, 400) : 0,
      outputs: null
    }
    const rate = rng() < 0.2 ? pick([0.5, 0.75, 1.25, 1.5, 2]) : 1
    options.rate = rate
    if (source.streamed) {
      // A long file: start somewhere inside it, and usually play a defined part of it.
      options.startTime = intBetween(0, Math.round((source.seconds - 20) * 1000))
      if (rng() < 0.8) options.endTime = options.startTime + intBetween(4000, 15000)
    } else if (rng() < 0.7) {
      // Most cues run long enough that a dozen overlap on stage at once, which is the
      // shape the engine has to hold together: short cues alone never test the mixer.
      options.loopCount = rng() < 0.3 ? -1 : intBetween(2, 6)
    }
    if (rng() < 0.2) {
      // An explicit matrix: the operator's own statement of destinations and levels.
      const outputs = []
      const taps = intBetween(1, Math.max(1, Math.min(4, CHANNELS)))
      for (let tap = 0; tap < taps; tap++) {
        outputs.push({
          inputChannel: intBetween(0, source.channels - 1),
          outputChannel: intBetween(0, CHANNELS - 1),
          gain: Number(between(0.4, 1).toFixed(3))
        })
      }
      options.outputs = outputs
    }
    return options
  }

  /** How long a planned cue will run, in ms, or null for one that needs a stop. */
  const plannedDuration = (source, options) => {
    if (options.loopCount < 0) return null
    const segmentStart = options.startTime
    const segmentEnd = options.endTime === null ? source.seconds * 1000 : options.endTime
    const length = Math.max(0, segmentEnd - segmentStart)
    return (length * (options.loopCount + 1)) / options.rate
  }

  let at = 250
  while (at < SHOW_MS) {
    at += intBetween(120, 440)
    const roll = rng()
    if (roll < 0.5) {
      const live = liveAt(at)
      const streamedLive = live.filter((cue) => cue.streamed).length
      let source = pick(weightedSources)
      if (source.streamed && streamedLive >= 10) {
        source = sources.find((candidate) => !candidate.streamed)
      }
      if (live.length >= VOICES) {
        stats.skippedStart++
      } else if (source.streamed && streamedLive >= 10) {
        stats.skippedStreamed++
      } else {
        const cueId = `s${++cueSeq}`
        const options = sourceOptions(source)
        const whenMs = at + intBetween(150, 500)
        const duration = plannedDuration(source, options)
        cues.push({
          cueId,
          source,
          options,
          startMs: whenMs,
          endMs: duration === null ? null : whenMs + duration,
          streamed: source.streamed === true
        })
        actions.push({ atMs: Math.max(50, at - 900), kind: 'prepare', cueId, source })
        actions.push({ atMs: at, leadMs: 250, kind: 'start', cueId, source, whenMs, options })
        stats.prepares++
        stats.starts++
      }
    } else {
      const live = liveAt(at)
      if (live.length === 0) continue
      const cue = pick(live)
      if (roll < 0.58) {
        actions.push({
          atMs: at,
          leadMs: 60,
          kind: 'fade',
          cueId: cue.cueId,
          param: pick(['volume', 'pan', 'trim', 'rate']),
          value: Number(between(0.1, 1).toFixed(3)),
          durationMs: intBetween(100, 2500),
          curve: pick(['linear', 'sCurve', 'logarithmic'])
        })
        stats.fades++
      } else if (roll < 0.7) {
        // Only cues with a stated length can be seeked into meaningfully; for the
        // streamed ones this is the path that repositions a live decoder.
        actions.push({ atMs: at, leadMs: 60, kind: 'seek', cueId: cue.cueId, positionMs: cue.source.seconds > 10 ? intBetween(500, 20000) : intBetween(0, 800) })
        stats.seeks++
      } else if (roll < 0.78) {
        // An explicit matrix: the operator's own statement of destinations and levels.
        const taps = intBetween(1, Math.max(1, Math.min(4, CHANNELS)))
        const outputs = []
        for (let tap = 0; tap < taps; tap++) {
          outputs.push({
            inputChannel: intBetween(0, cue.source.channels - 1),
            outputChannel: intBetween(0, CHANNELS - 1),
            gain: Number(between(0.4, 1).toFixed(3))
          })
        }
        actions.push({ atMs: at, leadMs: 60, kind: 'routing', cueId: cue.cueId, outputs })
        stats.routings++
      } else if (roll < 0.985) {
        actions.push({ atMs: at, leadMs: 60, kind: 'stop', cueId: cue.cueId, fadeMs: rng() < 0.5 ? 0 : intBetween(50, 1500) })
        endedAt.set(cue.cueId, at)
        stats.stops++
      } else {
        for (const target of live) endedAt.set(target.cueId, at)
        actions.push({ atMs: at, leadMs: 60, kind: 'stopAll', fadeMs: intBetween(0, 600) })
        stats.stopAlls++
      }
    }
  }

  actions.sort((a, b) => (a.atMs === b.atMs ? 0 : a.atMs - b.atMs))
  return { actions, cues, stats }
}

// ── Engine client ───────────────────────────────────────────────────────────
class EngineClient {
  constructor(socketPath) {
    this.socketPath = socketPath
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
    this.onEvent = () => {}
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
    if (message.event) this.onEvent(message.event)
  }

  request(verb, params = {}, timeoutMs = 10_000) {
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

// ── Measurement ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const wallNow = () => Number(process.hrtime.bigint() / 1000n) / 1000

const failures = []
function fail(name, detail = '') {
  failures.push(detail === '' ? name : `${name} — ${detail}`)
  console.log(`  FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
}
// The health counters only ever grow, and the poll that reads them runs every few
// seconds: a finding has to be reported on what is new about it, or a single seven-frame
// underrun becomes a hundred and sixty-eight identical lines in the night's report.
// Returns whether this reading was new, which is also when the detail is worth dumping.
const counted = new Map()
function failCount(key, name, total, unit) {
  const previous = counted.get(key) ?? 0
  if (total <= previous) return false
  counted.set(key, total)
  fail(name, `${total - previous}${unit}`)
  return true
}
function ok(name, detail = '') {
  console.log(`  ok   ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const show = planShow()
const plannedCue = new Map(show.cues.map((cue) => [cue.cueId, cue]))
const startedAt = new Date().toISOString()
console.log(
  `soak — ${MINUTES} min, seed ${SEED}${SHARDS > 1 ? ` (shard ${SHARD}/${SHARDS})` : ''}, ` +
    `${CHANNELS} channels, up to ${VOICES} voices, binary ${BINARY}`
)
console.log(
  `  planned ${show.stats.starts} starts, ${show.stats.stops} stops, ${show.stats.fades} fades, ` +
    `${show.stats.seeks} seeks, ${show.stats.routings} routings, ${show.stats.stopAlls} stop-alls` +
    (show.stats.skippedStart > 0 ? ` (${show.stats.skippedStart} starts skipped at the voice ceiling)` : '')
)

const socketPath = join(workDir, 'engine.sock')
const child = spawn(BINARY, [
  '--socket', socketPath,
  '--backend', 'silent',
  '--sample-rate', String(SAMPLE_RATE),
  '--channels', String(CHANNELS),
  '--buffer-frames', String(BLOCK_FRAMES),
  // Media sizes are chosen against these: the three short files stay resident, the
  // long one streams.
  '--cache-max-bytes', String(CACHE_MAX_BYTES),
  '--cache-max-files', '64',
  '--cache-max-file-bytes', String(2 * 1024 * 1024),
  '--stream-preroll-ms', '750',
  '--stream-max-voice-bytes', String(4 * 1024 * 1024),
  '--stream-max-total-bytes', String(STREAM_MAX_TOTAL_BYTES),
  '--schedule-horizon-ms', '10000'
], { stdio: ['ignore', 'pipe', 'pipe'] })

let engineStderr = ''
let engineExit = null
let teardownStarted = false
child.stderr.on('data', (chunk) => {
  engineStderr += chunk.toString()
  if (engineStderr.length > 64 * 1024) engineStderr = engineStderr.slice(-32 * 1024)
  // The engine's own diagnostics ride stderr; `--verbose` puts them on this one too.
  if (VERBOSE) process.stderr.write(chunk)
})
child.on('exit', (code, signal) => {
  engineExit = `${code ?? signal}`
})

const client = new EngineClient(socketPath)
{
  const deadline = Date.now() + 15_000
  for (;;) {
    try {
      await client.connect()
      break
    } catch (error) {
      client.socket?.destroy()
      if (Date.now() > deadline) {
        console.error(`the engine never accepted a connection: ${error.message}\n${engineStderr}`)
        child.kill('SIGKILL')
        rmSync(workDir, { recursive: true, force: true })
        process.exit(1)
      }
      await sleep(100)
    }
  }
}

// ── Live state ──────────────────────────────────────────────────────────────
const expectedRuns = new Map() // runId -> { cueId, whenMs, began, ended, reason }
const cueRuns = new Map() // cueId -> runId (the engine replaces a cue's run on restart)
const completedRuns = [] // { runId, reason, loopsCompleted }
const liveProgress = new Map() // cueId -> { runId, elapsedMs }
const errorEvents = []
const panicEvents = []
let stateEvents = 0
let namedRuns = 0 // runs whose timing was measured
let outOfTolerance = 0
let maxStartDelayMs = 0
let totalStartDelayMs = 0
let staleProgressSamples = 0
let progressSamples = 0
let progressObserved = 0
let missingProgress = 0
/** cueId -> how many commands the show has sent it; a seek explains a smaller position. */
const commandsPerCue = new Map()

client.onEvent = (event) => {
  switch (event.type) {
    case 'error': {
      errorEvents.push(event)
      if (VERBOSE) console.log(`  [error] ${event.code}: ${event.message}`)
      break
    }
    case 'panic':
      panicEvents.push(event)
      break
    case 'ended': {
      const expected = expectedRuns.get(event.runId)
      if (expected !== undefined) {
        expected.ended = true
        expected.reason = event.reason
      }
      completedRuns.push({ runId: event.runId, cueId: event.cueId, reason: event.reason, loopsCompleted: event.loopsCompleted })
      if (cueRuns.get(event.cueId) === event.runId) cueRuns.delete(event.cueId)
      liveProgress.delete(event.cueId)
      break
    }
    case 'state': {
      stateEvents++
      if (event.cueId !== null && event.runId !== null && event.playing === true && event.state === 'playing') {
        const expected = expectedRuns.get(event.runId)
        if (expected !== undefined && expected.began === false) {
          expected.began = true
          const delay = event.at - expected.whenMs
          namedRuns++
          totalStartDelayMs += Math.abs(delay)
          if (Math.abs(delay) > maxStartDelayMs) maxStartDelayMs = Math.abs(delay)
          if (Math.abs(delay) > START_TOLERANCE_MS) {
            outOfTolerance++
            if (outOfTolerance <= 5) {
              console.log(`  [timing] ${event.cueId} began at ${event.at.toFixed(1)} ms, scheduled for ${expected.whenMs} (${delay.toFixed(1)} ms)`)
            }
          }
        }
      }
      break
    }
    default:
      break
  }
}

// ── The run ─────────────────────────────────────────────────────────────────
const metrics = {
  peakActiveVoices: 0,
  peakStreamingVoices: 0,
  peakResidentBytes: 0,
  peakStreamBufferBytes: 0,
  peakCacheEntries: 0,
  samples: 0,
  finalResidentBytes: 0,
  finalStreamBufferBytes: 0,
  xruns: 0,
  decodeUnderruns: 0,
  droppedFileChunks: 0
}

const commandFailures = []
let dispatched = 0
let t0 = null
let clockStart = null
let wallStart = null
let clockEnd = null
let wallEnd = null
let reportEngineExitDuringShow = null

try {
  const boot = await client.request('clock')
  t0 = boot.clockMs
  clockStart = t0
  wallStart = wallNow()

  let actionIndex = 0
  let nextSampleAt = 0

  for (;;) {
    const reading = await client.request('clock')
    const clock = reading.clockMs
    const elapsed = clock - t0
    if (elapsed >= SHOW_MS) {
      clockEnd = clock
      wallEnd = wallNow()
      break
    }

    while (actionIndex < show.actions.length) {
      const action = show.actions[actionIndex]
      const lead = action.leadMs ?? 0
      if (action.atMs - lead > elapsed) break
      actionIndex++
      dispatched++
      try {
        if (action.cueId !== undefined) {
          commandsPerCue.set(action.cueId, (commandsPerCue.get(action.cueId) ?? 0) + 1)
        }
        await dispatch(action, t0)
      } catch (error) {
        // A refusal the plan did not expect is a finding, not a retry: the plan only
        // asks for things that exist.
        commandFailures.push(`${action.kind} ${action.cueId}: ${error.message}`)
        if (action.kind === 'start') {
          const expected = expectedRuns.get(action.expectedRunId)
          if (expected !== undefined) expected.ended = true
        }
      }
    }

    if (elapsed >= nextSampleAt) {
      nextSampleAt += SAMPLE_SECONDS * 1000
      await sampleHealth()
    }

    await sleep(10)
  }

  async function dispatch(action, base) {
    switch (action.kind) {
      case 'prepare': {
        await client.request('prepare', { cueId: action.cueId, filePath: action.source.path })
        return
      }
      case 'start': {
        if (VERBOSE) {
          const { startTime, endTime, loopCount, rate, fadeInDuration, outputs } = action.options
          console.log(
            `  [start] ${action.cueId} ${action.source.name} at ${action.whenMs.toFixed(0)} ` +
              `(start ${startTime}, end ${endTime}, loops ${loopCount}, rate ${rate}, fadeIn ${fadeInDuration}, ` +
              `${outputs === null ? 'automatic' : `${outputs.length} taps`})`
          )
        }
        const result = await client.request('start', {
          cueId: action.cueId,
          whenMs: base + action.whenMs,
          options: action.options
        })
        const runId = result.runId
        expectedRuns.set(runId, { cueId: action.cueId, whenMs: base + action.whenMs, began: false, ended: false, reason: null })
        cueRuns.set(action.cueId, runId)
        action.expectedRunId = runId
        return
      }
      case 'fade':
        await client.request('fade', {
          cueId: action.cueId,
          param: action.param,
          value: action.value,
          durationMs: action.durationMs,
          curve: action.curve,
          whenMs: base + action.atMs
        })
        return
      case 'seek':
        await client.request('seek', { cueId: action.cueId, positionMs: action.positionMs, whenMs: base + action.atMs })
        return
      case 'routing':
        await client.request('routing', { cueId: action.cueId, outputs: action.outputs })
        return
      case 'stop':
        await client.request('stop', { cueId: action.cueId, fadeMs: action.fadeMs, whenMs: base + action.atMs })
        return
      case 'stopAll':
        await client.request('stopAll', { fadeMs: action.fadeMs })
        return
      default:
        return
    }
  }

  async function sampleHealth() {
    const info = await client.request('info')
    const media = info.media
    metrics.samples++
    metrics.xruns = media.xruns
    metrics.decodeUnderruns = media.decodeUnderruns
    metrics.droppedFileChunks = media.droppedFileChunks
    metrics.peakActiveVoices = Math.max(metrics.peakActiveVoices, info.activeVoices)
    metrics.peakStreamingVoices = Math.max(metrics.peakStreamingVoices, media.streamingVoices)
    metrics.peakResidentBytes = Math.max(metrics.peakResidentBytes, media.residentBytes)
    metrics.peakStreamBufferBytes = Math.max(metrics.peakStreamBufferBytes, media.streamBufferBytes)
    metrics.peakCacheEntries = Math.max(metrics.peakCacheEntries, info.cache.entries)

    if (media.xruns > XRUN_BUDGET) failCount('xruns', 'device callbacks missed their deadline', media.xruns, ' xruns')
    if (media.decodeUnderruns > 0) {
      const reported = failCount('decodeUnderruns', 'stream underruns', media.decodeUnderruns, ' frames of silence waiting for media')
      if (reported && VERBOSE) {
        for (const voice of info.activeCues ?? []) {
          const planned = plannedCue.get(voice.cueId)
          console.log(
            `  [active] ${voice.cueId} ${voice.state}${voice.streaming ? ' streaming' : ''} ` +
              `(${planned?.source.name ?? '?'}${planned?.streamed ? ', planned streamed' : ''})`
          )
        }
      }
    }
    if (media.droppedFileChunks > 0) {
      failCount('droppedFileChunks', 'dropped media chunks', media.droppedFileChunks, ' chunks')
    }
    if (info.activeVoices > VOICES + 4) fail('more voices active than the show asked for', `${info.activeVoices}`)

    // Every started cue must really be moving: a voice that is active but frozen is the
    // silent failure this whole exercise exists to catch.
    let observed = 0
    for (const [cueId, runId] of cueRuns) {
      const progress = await client.request('progress', { cueId })
      if (progress === null || progress === undefined) {
        missingProgress++
        continue
      }
      if (progress.runId !== runId) continue
      if (progress.state !== 'playing' && progress.state !== 'fading') continue
      observed++
      const previous = liveProgress.get(cueId)
      if (previous !== undefined && previous.runId === progress.runId) {
        progressSamples++
        // A looping voice wraps back to the top of its segment, and a seek lands wherever
        // it was asked to — so a smaller position is not evidence of anything on its own.
        // What is evidence is a voice the show has not touched at all in the interval that
        // has neither moved nor completed a loop: a voice that is active but frozen is the
        // silent failure this whole exercise exists to catch.
        const touched = previous.commands !== (commandsPerCue.get(cueId) ?? 0)
        const advanced = progress.elapsedMs > previous.elapsedMs || progress.loopsCompleted > previous.loopsCompleted
        if (!advanced && !touched) {
          staleProgressSamples++
          if (staleProgressSamples <= 5) {
            const planned = plannedCue.get(cueId)
            console.log(
              `  [stuck] ${cueId} still at ${progress.elapsedMs.toFixed(0)} ms after ${progress.loopsCompleted} loops ` +
                `(state ${progress.state}; ${planned?.source.name ?? '?'}${planned?.streamed ? ', streamed' : ''}, ` +
                `rate ${planned?.options?.rate ?? '?'}, loops ${planned?.options?.loopCount ?? '?'})`
            )
          }
        }
      }
      liveProgress.set(cueId, {
        runId: progress.runId,
        elapsedMs: progress.elapsedMs,
        loopsCompleted: progress.loopsCompleted,
        commands: commandsPerCue.get(cueId) ?? 0
      })
    }
    progressObserved += observed
    if (VERBOSE) console.log(`  [sample] ${cueRuns.size} live cues, ${observed} playing, ${missingProgress} without a snapshot`)
  }
} catch (error) {
  fail('the soak could not run to the end', error.message)
} finally {
  const exitedDuringShow = teardownStarted ? null : engineExit
  reportEngineExitDuringShow = exitedDuringShow
  // Settle: silence everything, then read the engine's own final word.
  try {
    await client.request('stopAll', { fadeMs: 300 })
    const deadline = Date.now() + 20_000
    for (;;) {
      await sleep(100)
      const info = await client.request('info')
      metrics.finalResidentBytes = info.media.residentBytes
      metrics.finalStreamBufferBytes = info.media.streamBufferBytes
      if (!info.active) break
      if (Date.now() > deadline) {
        fail('the engine was still playing after stop-All', `${info.activeVoices} voices`)
        break
      }
    }
  } catch (error) {
    fail('the engine did not settle after stop-All', error.message)
  }
  client.close()
  teardownStarted = true
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve))
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await Promise.race([exited, sleep(2000)])
  rmSync(workDir, { recursive: true, force: true })
}

// ── Verdict ─────────────────────────────────────────────────────────────────
const renderedMs = (clockEnd ?? 0) - (clockStart ?? 0)
const wallMs = (wallEnd ?? 0) - (wallStart ?? 0)
const clockDriftPct = wallMs > 0 ? ((renderedMs - wallMs) / wallMs) * 100 : 0

if (reportEngineExitDuringShow !== null) fail('the engine exited during the show', `exit ${engineExit}${engineStderr ? `: ${engineStderr.trim().split('\n').slice(-3).join(' | ')}` : ''}`)
if (commandFailures.length > 0) fail('commands the plan expected to succeed were refused', `${commandFailures.length}: ${commandFailures.slice(0, 3).join('; ')}`)
if (errorEvents.length > 0) fail('the engine reported errors', `${errorEvents.length}: ${errorEvents.slice(0, 3).map((event) => `${event.code}: ${event.message}`).join('; ')}`)
if (panicEvents.length > 0) fail('the engine panicked', `${panicEvents.length}`)

const neverBegan = [...expectedRuns.values()].filter((run) => run.began === false && run.ended === false)
if (neverBegan.length > 0) {
  fail('scheduled cues never began', `${neverBegan.length}, e.g. ${neverBegan.slice(0, 3).map((run) => `${run.cueId}@${run.whenMs}`).join(', ')}`)
}
const neverEnded = [...expectedRuns.values()].filter((run) => run.began === true && run.ended === false)
if (neverEnded.length > 0) {
  fail('cues that began never ended, even after stop-All', `${neverEnded.length}`)
}
if (namedRuns < show.stats.starts * 0.5) {
  fail('too few scheduled starts were observed to judge timing', `${namedRuns}/${show.stats.starts}`)
}
if (outOfTolerance > 0) fail('cue starts landed outside the stated tolerance', `${outOfTolerance}/${namedRuns} beyond ${START_TOLERANCE_MS.toFixed(1)} ms`)
if (progressSamples > 0 && staleProgressSamples > 0) fail('active voices stopped advancing', `${staleProgressSamples}/${progressSamples} samples`)
if (Math.abs(clockDriftPct) > CLOCK_TOLERANCE_PCT) fail('the show clock drifted from the wall clock', `${clockDriftPct.toFixed(3)}% against ${CLOCK_TOLERANCE_PCT}%`)
if (metrics.peakStreamingVoices === 0) fail('the streamed path was never exercised', 'no streaming voices were active')
if (metrics.peakCacheEntries === 0) fail('the cached path was never exercised', 'no media was ever resident')
if (metrics.peakActiveVoices === 0) fail('no voices ever played', '')
if (metrics.peakResidentBytes > CACHE_MAX_BYTES + STREAM_MAX_TOTAL_BYTES) {
  fail('resident memory exceeded the configured budgets', `${(metrics.peakResidentBytes / (1024 * 1024)).toFixed(1)} MiB`)
}
if (metrics.finalResidentBytes > CACHE_MAX_BYTES) fail('decoded media grew past the cache budget', `${(metrics.finalResidentBytes / (1024 * 1024)).toFixed(1)} MiB`)
if (metrics.finalStreamBufferBytes > 0) fail('stream buffers were still held after the show', `${(metrics.finalStreamBufferBytes / 1024).toFixed(0)} KiB`)

const report = {
  tool: 'soak',
  version: 1,
  seed: SEED,
  shard: SHARD,
  shards: SHARDS,
  minutes: MINUTES,
  channels: CHANNELS,
  voices: VOICES,
  sampleRate: SAMPLE_RATE,
  blockFrames: BLOCK_FRAMES,
  startedAt,
  finishedAt: new Date().toISOString(),
  tolerances: {
    startDelayMs: Number(START_TOLERANCE_MS.toFixed(2)),
    clockDriftPct: CLOCK_TOLERANCE_PCT,
    xrunBudget: XRUN_BUDGET
  },
  show: {
    ...show.stats,
    dispatched,
    scheduledRuns: expectedRuns.size,
    observedStarts: namedRuns,
    completedRuns: completedRuns.filter((run) => run.reason === 'complete').length,
    stoppedRuns: completedRuns.filter((run) => run.reason === 'stopped').length,
    cancelledRuns: completedRuns.filter((run) => run.reason === 'cancelled' || run.reason === 'replaced').length,
    stateEvents
  },
  timing: {
    maxStartDelayMs: Number(maxStartDelayMs.toFixed(2)),
    meanStartDelayMs: namedRuns > 0 ? Number((totalStartDelayMs / namedRuns).toFixed(2)) : 0,
    outOfTolerance,
    staleProgressSamples,
    progressSamples,
    progressObserved,
    missingProgress
  },
  clock: {
    renderedMs: Math.round(renderedMs),
    wallMs: Math.round(wallMs),
    driftPct: Number(clockDriftPct.toFixed(4))
  },
  health: {
    xruns: metrics.xruns,
    decodeUnderruns: metrics.decodeUnderruns,
    droppedFileChunks: metrics.droppedFileChunks,
    errorEvents: errorEvents.length,
    peakActiveVoices: metrics.peakActiveVoices,
    peakStreamingVoices: metrics.peakStreamingVoices,
    peakResidentBytes: metrics.peakResidentBytes,
    peakStreamBufferBytes: metrics.peakStreamBufferBytes,
    peakCacheEntries: metrics.peakCacheEntries,
    finalResidentBytes: metrics.finalResidentBytes,
    finalStreamBufferBytes: metrics.finalStreamBufferBytes,
    samples: metrics.samples
  },
  passed: failures.length === 0,
  failures
}

if (REPORT_PATH !== '') {
  try {
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`\nreport written to ${REPORT_PATH}`)
  } catch (error) {
    console.error(`could not write the report: ${error.message}`)
  }
}

console.log(
  `\n${(report.clock.renderedMs / 1000).toFixed(1)}s rendered in ${(report.clock.wallMs / 1000).toFixed(1)}s wall ` +
    `(drift ${report.clock.driftPct.toFixed(3)}%)`
)
console.log(
  `${report.show.observedStarts} starts observed, max delay ${report.timing.maxStartDelayMs} ms ` +
    `(tolerance ${report.tolerances.startDelayMs} ms), mean ${report.timing.meanStartDelayMs} ms`
)
console.log(
  `${report.health.xruns} xruns, ${report.health.decodeUnderruns} stream underruns, ` +
    `${report.health.droppedFileChunks} dropped chunks, peak ${report.health.peakActiveVoices} voices ` +
    `(${report.health.peakStreamingVoices} streaming), peak resident ${(report.health.peakResidentBytes / (1024 * 1024)).toFixed(1)} MiB`
)
if (failures.length === 0) {
  console.log('\nsoak passed')
  process.exit(0)
}
console.log(`\nsoak failed — ${failures.length} finding${failures.length === 1 ? '' : 's'}`)
process.exit(1)
