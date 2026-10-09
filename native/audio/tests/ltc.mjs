#!/usr/bin/env node
/**
 * Linear timecode, round trip: the engine writes LTC into an output channel in offline mode,
 * and its reader gets the same frames back out of the WAV — at every rate the show offers,
 * and then again after the signal has been put through what a cable and a desk do to it:
 * hiss, a DC offset, a level that swells and fades, a tape that runs fast, a tape that runs
 * backwards. A plain reader written here from the SMPTE bit layout checks the words too, so
 * an encoder and decoder that agreed with each other on the wrong layout would still fail.
 *
 *   node native/audio/tests/ltc.mjs [--binary path]
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const defaultBinary = join(repoRoot, 'native', 'audio', 'build', `cuerunner-audio${process.platform === 'win32' ? '.exe' : ''}`)
const binaryIndex = process.argv.indexOf('--binary')
const binary = binaryIndex >= 0 ? process.argv[binaryIndex + 1] : process.env.CUERUNNER_AUDIO_BIN ?? defaultBinary

const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-feat-timecode-ltc-'))
let failures = 0
let checks = 0

function check(name, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── The label arithmetic, written again here so the test does not lean on the engine's ──

const RATES = {
  '24': { nominal: 24, fps: 24, df: false },
  '25': { nominal: 25, fps: 25, df: false },
  '29.97df': { nominal: 30, fps: 30000 / 1001, df: true },
  '29.97': { nominal: 30, fps: 30000 / 1001, df: false },
  '30': { nominal: 30, fps: 30, df: false }
}

function toFrames(label, rate) {
  const [h, m, s, f] = label.split(/[:;]/).map(Number)
  const { nominal, df } = RATES[rate]
  const labelled = ((h * 60 + m) * 60 + s) * nominal + f
  if (!df) return labelled
  const minutes = h * 60 + m
  return labelled - 2 * (minutes - Math.floor(minutes / 10))
}

function toLabel(frames, rate) {
  const { nominal, df } = RATES[rate]
  let n = frames
  if (df) {
    const tens = Math.floor(n / 17982)
    const rest = n % 17982
    n += 18 * tens + (rest < 2 ? 0 : 2 * Math.floor((rest - 2) / 1798))
  }
  const pad = v => String(v).padStart(2, '0')
  return `${pad(Math.floor(n / (nominal * 3600)))}:${pad(Math.floor(n / (nominal * 60)) % 60)}:${pad(Math.floor(n / nominal) % 60)}:${pad(n % nominal)}`
}

const labelOf = d => [d.hours, d.minutes, d.seconds, d.frames].map(v => String(v).padStart(2, '0')).join(':')

// ── WAV in and out ──────────────────────────────────────────────────────────

function readFloatWav(path) {
  const buffer = readFileSync(path)
  let offset = 12
  let channels = 0
  let sampleRate = 0
  let dataOffset = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10)
      sampleRate = buffer.readUInt32LE(offset + 12)
    } else if (id === 'data') {
      dataOffset = offset + 8
      dataBytes = Math.min(size, buffer.length - dataOffset)
    }
    offset += 8 + size + (size % 2)
  }
  const frames = Math.floor(dataBytes / (channels * 4))
  const samples = new Float32Array(frames * channels)
  for (let i = 0; i < samples.length; i++) samples[i] = buffer.readFloatLE(dataOffset + i * 4)
  return { channels, sampleRate, frames, samples }
}

function writeMonoWav(path, sampleRate, samples) {
  const dataBytes = samples.length * 4
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(3, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 4, 28)
  buffer.writeUInt16LE(4, 32)
  buffer.writeUInt16LE(32, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < samples.length; i++) buffer.writeFloatLE(samples[i], 44 + i * 4)
  writeFileSync(path, buffer)
}

function channelOf(wav, channel) {
  const out = new Float32Array(wav.frames)
  for (let i = 0; i < wav.frames; i++) out[i] = wav.samples[i * wav.channels + channel]
  return out
}

let serial = 0
function render(script) {
  const scriptPath = join(workDir, `script-${++serial}.json`)
  const outPath = join(workDir, `out-${serial}.wav`)
  writeFileSync(scriptPath, JSON.stringify(script))
  const stdout = execFileSync(binary, ['--offline-render', scriptPath, '--out', outPath, '--backend', 'offline'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  })
  return { summary: JSON.parse(stdout.trim().split('\n').pop()), path: outPath, wav: readFloatWav(outPath) }
}

function decode(path, channel = 0) {
  const stdout = execFileSync(binary, ['--ltc-decode', path, '--channel', String(channel)], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  })
  return JSON.parse(stdout)
}

function decodeSamples(sampleRate, samples) {
  const path = join(workDir, `mangled-${++serial}.wav`)
  writeMonoWav(path, sampleRate, samples)
  return decode(path)
}

/** Whether every decoded frame is the frame after the one before it, at `rate`. */
function consecutive(frames, rate, step = 1) {
  for (let i = 1; i < frames.length; i++) {
    if (toFrames(labelOf(frames[i]), rate) !== toFrames(labelOf(frames[i - 1]), rate) + step) return i
  }
  return -1
}

// A deterministic noise source: the same hiss every run.
function noise(seed) {
  let state = seed >>> 0
  return () => {
    // Two uniforms summed is close enough to a bell for hiss.
    state = (state * 1664525 + 1013904223) >>> 0
    const a = state / 2 ** 32
    state = (state * 1664525 + 1013904223) >>> 0
    const b = state / 2 ** 32
    return a + b - 1
  }
}

// ── An independent reader for a clean signal: transitions → bits → SMPTE fields ──

function plainRead(samples, sampleRate, fps) {
  const cell = sampleRate / (fps * 80)
  const edges = []
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] > 0) !== (samples[i - 1] > 0) && samples[i] !== 0 && samples[i - 1] !== 0) edges.push(i)
  }
  const bits = []
  for (let i = 1; i < edges.length; i++) {
    const interval = edges[i] - edges[i - 1]
    if (interval > cell * 0.75) bits.push(0)
    else {
      bits.push(1)
      i++
    }
  }
  const sync = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1]
  const words = []
  for (let end = 80; end <= bits.length; end++) {
    if (sync.every((bit, k) => bits[end - 16 + k] === bit)) words.push(bits.slice(end - 80, end))
  }
  const num = (word, first, count) => word.slice(first, first + count).reduce((v, b, k) => v | (b << k), 0)
  return words.map(word => ({
    frames: num(word, 8, 2) * 10 + num(word, 0, 4),
    seconds: num(word, 24, 3) * 10 + num(word, 16, 4),
    minutes: num(word, 40, 3) * 10 + num(word, 32, 4),
    hours: num(word, 56, 2) * 10 + num(word, 48, 4),
    dropFrame: word[10] === 1,
    ones: word.reduce((a, b) => a + b, 0)
  }))
}

// ── The cases ───────────────────────────────────────────────────────────────

const SAMPLE_RATE = 48000

function ltcScript(rate, startLabel, ms, extra = [], sampleRate = SAMPLE_RATE) {
  return {
    sampleRate,
    channels: 4,
    blockFrames: 256,
    frames: Math.round((ms * sampleRate) / 1000),
    stopWhenIdle: false,
    commands: [
      { atMs: 0, verb: 'ltcStart', voiceId: `tc-${rate}`, channel: 2, rate, frame: toFrames(startLabel, rate), levelDb: -12 },
      ...extra
    ]
  }
}

// Start a little before a minute boundary, so drop-frame has to skip its two labels.
const START = '00:00:58:20'

try {
  console.log('LTC: every rate, clean')
  const rendered = {}
  for (const rate of Object.keys(RATES)) {
    const { wav, path, summary } = render(ltcScript(rate, START, 3000))
    rendered[rate] = { wav, path }
    check(`${rate}: ltcStart accepted`, summary.results[0]?.reply?.ok === true, JSON.stringify(summary.results[0]))
    const decoded = decode(path, 2)
    const frames = decoded.frames
    const expected = Math.floor(3 * RATES[rate].fps)
    check(`${rate}: decodes about three seconds of frames`, frames.length >= expected - 2 && frames.length <= expected,
      `${frames.length} of ${expected}`)
    // A reader learns the cell from the first word's edges, so the first word may be the
    // one it learned on; the second is never missed.
    const firstAt = frames.length > 0 ? toFrames(labelOf(frames[0]), rate) - toFrames(START, rate) : -1
    check(`${rate}: the first frame read is the start or the one after it`, firstAt === 0 || firstAt === 1,
      frames.length > 0 ? labelOf(frames[0]) : 'none')
    const broken = consecutive(frames, rate)
    check(`${rate}: every frame follows the one before`, broken < 0, broken < 0 ? '' : `${labelOf(frames[broken - 1])} → ${labelOf(frames[broken])}`)
    check(`${rate}: the drop-frame flag is ${RATES[rate].df ? 'set' : 'clear'}`, frames.every(f => f.dropFrame === RATES[rate].df))
    if (RATES[rate].df) {
      check(`${rate}: the minute boundary skips 00 and 01`, frames.some(f => labelOf(f) === '00:00:59:29') &&
        frames.some(f => labelOf(f) === '00:01:00:02') && !frames.some(f => labelOf(f) === '00:01:00:00'))
    }
    // The channel next to it, and the music channels, are untouched.
    check(`${rate}: nothing leaks into the other channels`, decode(path, 0).frames.length === 0 &&
      channelOf(wav, 3).every(sample => sample === 0))
    // A frame ends where its 80 cells say it should.
    const period = SAMPLE_RATE / RATES[rate].fps
    const spacing = frames.length > 2 ? (frames[frames.length - 1].endSample - frames[0].endSample) / (frames.length - 1) : 0
    check(`${rate}: frames are ${period.toFixed(2)} samples apart`, Math.abs(spacing - period) < 0.5, spacing.toFixed(3))

    const plain = plainRead(channelOf(wav, 2), SAMPLE_RATE, RATES[rate].fps)
    check(`${rate}: the SMPTE layout reads the same frames`, plain.length >= frames.length - 1 &&
      plain.slice(0, 10).every((word, i) => labelOf(word) === labelOf(frames[i])),
      plain.slice(0, 3).map(labelOf).join(' '))
    check(`${rate}: every word carries an even number of ones`, plain.every(word => word.ones % 2 === 0))
  }

  console.log('LTC: through hiss, a DC offset and a level that moves')
  for (const rate of Object.keys(RATES)) {
    const clean = channelOf(rendered[rate].wav, 2)
    const hiss = noise(0x5eed + rate.length)
    const mangled = new Float32Array(clean.length)
    for (let i = 0; i < clean.length; i++) {
      const t = i / clean.length
      // A fade to −20 dB over the first half, a step back up, and a swell at the end.
      const level = t < 0.5 ? 1 - 0.9 * (t / 0.5) : t < 0.75 ? 0.5 : 0.5 + 1.5 * (t - 0.75)
      mangled[i] = clean[i] * level + 0.004 * hiss() + 0.02
    }
    const frames = decodeSamples(SAMPLE_RATE, mangled).frames
    const expected = Math.floor(3 * RATES[rate].fps)
    check(`${rate}: reads at least 95% of the frames`, frames.length >= expected * 0.95, `${frames.length} of ${expected}`)
    const truth = new Set()
    for (let n = 0; n < expected + 2; n++) truth.add(toLabel(toFrames(START, rate) + n, rate))
    check(`${rate}: reads no frame that was never sent`, frames.every(f => truth.has(labelOf(f))))
  }

  console.log('LTC: off speed, backwards, and at 44.1 kHz')
  {
    const rate = '25'
    const clean = channelOf(rendered[rate].wav, 2)
    for (const speed of [0.9, 1.1]) {
      const length = Math.floor(clean.length / speed)
      const shifted = new Float32Array(length)
      for (let i = 0; i < length; i++) {
        const at = i * speed
        const a = Math.floor(at)
        const frac = at - a
        shifted[i] = (clean[a] ?? 0) * (1 - frac) + (clean[a + 1] ?? 0) * frac
      }
      const frames = decodeSamples(SAMPLE_RATE, shifted).frames
      check(`a tape at ${speed}x is followed`, frames.length >= 70 && consecutive(frames, rate) < 0, `${frames.length} frames`)
    }
    const backwards = Float32Array.from(clean).reverse()
    const reverse = decodeSamples(SAMPLE_RATE, backwards).frames
    check('a tape running backwards is read, and says so', reverse.length >= 70 && reverse.every(f => f.reverse) &&
      consecutive(reverse, rate, -1) < 0, `${reverse.length} frames`)

    const { path } = render(ltcScript('29.97df', START, 2000, [], 44100))
    const frames = decode(path, 2).frames
    check('44.1 kHz carries drop-frame too', frames.length >= 57 && consecutive(frames, '29.97df') < 0, `${frames.length} frames`)
  }

  console.log('LTC: the voice is driven')
  {
    const rate = '25'
    const { path, summary } = render(ltcScript(rate, '01:00:00:00', 3000, [
      { atMs: 1000, verb: 'ltcControl', voiceId: `tc-${rate}`, action: 'locate', frame: toFrames('02:00:00:00', rate) },
      { atMs: 1500, verb: 'ltcStatus' },
      { atMs: 2000, verb: 'ltcControl', voiceId: `tc-${rate}`, action: 'pause' },
      { atMs: 2500, verb: 'ltcControl', voiceId: `tc-${rate}`, action: 'resume' },
      { atMs: 2900, verb: 'ltcControl', voiceId: `tc-${rate}`, action: 'stop' },
      { atMs: 2950, verb: 'ltcStatus' }
    ]))
    const frames = decode(path, 2).frames
    const at = label => frames.findIndex(f => labelOf(f) === label)
    check('a locate lands on the frame asked for', at('02:00:00:00') > 0 && labelOf(frames[at('02:00:00:00') - 1]).startsWith('01:00:00'))
    const status = summary.results.find(r => r.atMs === 1500)?.reply?.result?.voices?.[0]
    check('the status reports the voice where it is', status?.running === true && status.frame >= toFrames('02:00:00:10', rate) &&
      status.frame <= toFrames('02:00:00:14', rate), JSON.stringify(status))
    const before = frames.filter(f => f.endSample < 2000 * 48).length
    const during = frames.filter(f => f.endSample > 2050 * 48 && f.endSample < 2500 * 48).length
    const lastBefore = frames.filter(f => f.endSample < 2050 * 48).pop()
    const firstAfter = frames.find(f => f.endSample > 2500 * 48)
    const resumedBy = firstAfter && lastBefore ? toFrames(labelOf(firstAfter), rate) - toFrames(labelOf(lastBefore), rate) : -1
    check('a paused voice falls silent', during === 0 && frames.length > before)
    check('a paused voice resumes where it paused', resumedBy === 1 || resumedBy === 2,
      `${lastBefore && labelOf(lastBefore)} then ${firstAfter && labelOf(firstAfter)}`)
    check('every frame after the resume follows the one before',
      consecutive(frames.filter(f => f.endSample > 2500 * 48), rate) < 0)
    const after = summary.results.find(r => r.atMs === 2950)?.reply?.result?.voices ?? []
    check('a stopped voice is gone from the status', after.length === 0, JSON.stringify(after))
    check('no frame is written after the stop', frames.every(f => f.endSample <= 2910 * 48))
  }

  console.log('LTC: refusals')
  {
    const { summary } = render({
      sampleRate: SAMPLE_RATE, channels: 2, frames: 4800, stopWhenIdle: false,
      commands: [
        { atMs: 0, verb: 'ltcStart', voiceId: 'a', rate: '23.976' },
        { atMs: 0, verb: 'ltcStart', voiceId: '', rate: '25' },
        { atMs: 0, verb: 'ltcControl', voiceId: 'a', action: 'rewind' },
        ...['v1', 'v2', 'v3', 'v4', 'v5'].map(voiceId => ({ atMs: 0, verb: 'ltcStart', voiceId, rate: '25' })),
        { atMs: 0, verb: 'ltcRead' },
        { atMs: 0, verb: 'ltcListen', device: 'cuerunner-feat-timecode-no-such-input', channel: 0 }
      ]
    })
    const replies = summary.results.map(r => r.reply)
    check('an unknown rate is refused', replies[0].ok === false && /rate/.test(replies[0].error?.message))
    check('an empty voice id is refused', replies[1].ok === false)
    check('an unknown action is refused', replies[2].ok === false)
    check('four voices run at once and a fifth is refused', replies.slice(3, 7).every(r => r.ok) && replies[7].ok === false &&
      replies[7].error?.code === 'limit')
    const read = replies[8]?.result
    check('a reader that is not listening reads nothing, and says so', replies[8]?.ok === true && read.listening === false &&
      Array.isArray(read.frames) && read.frames.length === 0 && typeof read.nowMs === 'number', JSON.stringify(replies[8]))
    check('listening on an input that is not there is refused, naming it', replies[9]?.ok === false &&
      replies[9].error?.code === 'device' && /cuerunner-feat-timecode-no-such-input|no audio system/.test(replies[9].error?.message),
      JSON.stringify(replies[9]))
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
