#!/usr/bin/env node
/**
 * Native acceptance suite: drives the real engine in offline mode and asserts actual
 * output samples, exact start/stop/fade frames, matrix routing, streaming and the cache
 * rules. Everything here runs the same mixer, scheduler, decoders and cache the device
 * path uses — only the clock is owned by the caller.
 *
 *   node native/audio/tests/offline.mjs [--binary path]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const defaultBinary = join(repoRoot, 'native', 'audio', 'build', `cuerunner-audio${process.platform === 'win32' ? '.exe' : ''}`)
const binaryIndex = process.argv.indexOf('--binary')
const binary = binaryIndex >= 0 ? process.argv[binaryIndex + 1] : process.env.CUERUNNER_AUDIO_BIN ?? defaultBinary

const SAMPLE_RATE = 48000
const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-audio-tests-'))
let failures = 0
let checks = 0

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

function readFloatWav(path) {
  const buffer = readFileSync(path)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a WAV file`)
  }
  let offset = 12
  let channels = 0
  let sampleRate = 0
  let format = 0
  let dataOffset = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      format = buffer.readUInt16LE(offset + 8)
      channels = buffer.readUInt16LE(offset + 10)
      sampleRate = buffer.readUInt32LE(offset + 12)
    } else if (id === 'data') {
      dataOffset = offset + 8
      dataBytes = Math.min(size, buffer.length - dataOffset)
    }
    offset += 8 + size + (size % 2)
  }
  if (format !== 3) throw new Error(`expected float WAV, got format ${format}`)
  const frames = Math.floor(dataBytes / (channels * 4))
  const samples = new Float32Array(frames * channels)
  for (let i = 0; i < samples.length; i++) samples[i] = buffer.readFloatLE(dataOffset + i * 4)
  return { channels, sampleRate, frames, samples }
}

function runEngine(script, extraArgs = []) {
  const scriptPath = join(workDir, `script-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`)
  const outPath = join(workDir, `out-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wav`)
  writeFileSync(scriptPath, JSON.stringify(script))
  const stdout = execFileSync(
    binary,
    ['--offline-render', scriptPath, '--out', outPath, '--backend', 'offline', ...extraArgs],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  )
  const summary = JSON.parse(stdout.trim().split('\n').pop())
  return { summary, wav: readFloatWav(outPath) }
}

function check(name, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

function near(actual, expected, tolerance = 1e-4) {
  return Math.abs(actual - expected) <= tolerance
}

function sampleAt(wav, frame, channel = 0) {
  return wav.samples[frame * wav.channels + channel]
}

function firstNonZeroFrame(wav, channel = 0) {
  for (let frame = 0; frame < wav.frames; frame++) {
    if (Math.abs(sampleAt(wav, frame, channel)) > 1e-6) return frame
  }
  return -1
}

function events(summary, type) {
  return summary.events.filter((event) => event.type === type)
}

function replyFor(summary, index) {
  const result = summary.results[index]
  if (result === undefined) throw new Error(`no result at index ${index}`)
  return result.reply
}

// --- fixtures --------------------------------------------------------------
const dc4Path = join(workDir, 'dc4.wav')
const dc2Path = join(workDir, 'dc2.wav')
const monoPath = join(workDir, 'mono.wav')
const longPath = join(workDir, 'long.wav')
writeFloatWav(dc4Path, 4, SAMPLE_RATE, SAMPLE_RATE / 2, (channel) => [0.1, 0.2, 0.3, 0.4][channel])
writeFloatWav(dc2Path, 2, SAMPLE_RATE, SAMPLE_RATE / 2, (channel) => (channel === 0 ? 0.5 : -0.25))
writeFloatWav(monoPath, 1, SAMPLE_RATE, SAMPLE_RATE / 2, () => 0.5)
// Three seconds of stereo at 0.25 — big enough to force the streaming path when the
// cache's per-file limit is lowered.
writeFloatWav(longPath, 2, SAMPLE_RATE, SAMPLE_RATE * 3, () => 0.25)
// Four seconds whose every sample says where in the file it came from: frame/480000.
// A streamed voice that starts, seeks or loops to the wrong place cannot produce these
// values, so where playback really resumed is readable off the output.
const rampPath = join(workDir, 'ramp.wav')
writeFloatWav(rampPath, 2, SAMPLE_RATE, SAMPLE_RATE * 4, (channel, frame) => frame / 480000)

console.log(`cuerunner-audio acceptance — binary ${binary}`)

// --- 1. exact start, stop and fade frames ---------------------------------
{
  console.log('\nexact start / stop / fade sample indices')
  const { summary, wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 24000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      {
        atMs: 0,
        verb: 'start',
        cueId: 'a',
        whenMs: 0,
        options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null }
      },
      { atMs: 100, verb: 'stop', cueId: 'a', fadeMs: 50 }
    ]
  })
  check('start is audible at frame 0', firstNonZeroFrame(wav) === 0, `first non-zero ${firstNonZeroFrame(wav)}`)
  check('level before the fade is exact', near(sampleAt(wav, 4799), 0.5))
  check('fade begins exactly at frame 4800', near(sampleAt(wav, 4800), 0.5))
  check('fade midpoint is half way down', near(sampleAt(wav, 6000), 0.5 * (1 - (6000 - 4800) / 2400)))
  check('fade ends at frame 7200', Math.abs(sampleAt(wav, 7200)) < 1e-6)
  check('silence after the fade', Math.abs(sampleAt(wav, 12000)) < 1e-6)
  check('right channel faded with the left', near(sampleAt(wav, 6000, 1), -0.25 * (1 - (6000 - 4800) / 2400)))
  const started = events(summary, 'state').filter((event) => event.state === 'playing')
  check('a playing state event was emitted', started.length >= 1)
  const ended = events(summary, 'ended')
  check('ended carries the run identity', ended.length === 1 && ended[0].cueId === 'a' && /^run-/.test(ended[0].runId))
  check('ended reason is stopped', ended.length === 1 && ended[0].reason === 'stopped')
}

// --- 2. a scheduled future start lands on its exact frame ------------------
{
  console.log('\nfuture-dated start')
  const { wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 12000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 100, options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } }
    ]
  })
  check('silent before the scheduled frame', Math.abs(sampleAt(wav, 4799)) < 1e-6)
  check('audible exactly at frame 4800', near(sampleAt(wav, 4800), 0.5))
}

// --- 3. N-input to M-output matrix routing --------------------------------
{
  console.log('\n4-channel matrix routing')
  const { summary, wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 4,
    blockFrames: 256,
    stopWhenIdle: false,
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc4Path },
      {
        atMs: 0,
        verb: 'start',
        cueId: 'a',
        whenMs: 0,
        options: {
          startTime: 0,
          endTime: null,
          loopCount: 0,
          rate: 1,
          trim: 1,
          volume: 1,
          pan: 0,
          fadeInDuration: 0,
          outputs: [
            { inputChannel: 1, outputChannel: 3, gain: 0.5 },
            { inputChannel: 0, outputChannel: 2, gain: 1 }
          ]
        }
      }
    ]
  })
  check('unrouted outputs stay silent', Math.abs(sampleAt(wav, 100, 0)) < 1e-6 && Math.abs(sampleAt(wav, 100, 1)) < 1e-6)
  check('input 0 reaches output 2', near(sampleAt(wav, 100, 2), 0.1))
  check('input 1 reaches output 3 at gain 0.5', near(sampleAt(wav, 100, 3), 0.1))
  check('the engine reports 4 output channels', summary.info.channels === 4, `channels ${summary.info.channels}`)
}

// --- 4. empty routing is deliberate silence --------------------------------
{
  console.log('\nempty routing = silent voice that still completes')
  const { summary, wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 26000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: [] } }
    ]
  })
  let loudest = 0
  for (let i = 0; i < wav.samples.length; i++) loudest = Math.max(loudest, Math.abs(wav.samples[i]))
  check('output is silent', loudest < 1e-6, `peak ${loudest}`)
  const ended = events(summary, 'ended')
  check('the run still reports completion', ended.length === 1 && ended[0].reason === 'complete')
}

// --- 5. finite loops -------------------------------------------------------
{
  console.log('\nfinite loops repeat the segment, then end')
  const { summary, wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 24000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: { startTime: 0, endTime: 100, loopCount: 1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } }
    ]
  })
  check('first pass is audible', near(sampleAt(wav, 4799), 0.5))
  check('second pass is audible (loop wrap)', near(sampleAt(wav, 4800), 0.5))
  check('run ends after two passes', Math.abs(sampleAt(wav, 9600)) < 1e-6 && Math.abs(sampleAt(wav, 9500)) > 0.4)
  const ended = events(summary, 'ended')
  check('ended reason complete with one loop', ended.length === 1 && ended[0].reason === 'complete' && ended[0].loopsCompleted === 1)
}

// --- 6. infinite loop stopped on command ----------------------------------
{
  console.log('\ninfinite loop with a scheduled stop')
  const { summary, wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 24000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: { startTime: 0, endTime: 100, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
      { atMs: 250, verb: 'stop', cueId: 'a', fadeMs: 0 }
    ]
  })
  check('loops keep playing past the first segment', near(sampleAt(wav, 11000), 0.5))
  check('stop lands on its exact frame', Math.abs(sampleAt(wav, 12000)) < 1e-6 && near(sampleAt(wav, 11999), 0.5))
  const ended = events(summary, 'ended')
  check('ended reason stopped', ended.length === 1 && ended[0].reason === 'stopped')
}

// --- 7. seek keeps the envelope (no fade retrigger) -----------------------
{
  console.log('\nseek does not retrigger the fade-in')
  const { wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 24000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 100, outputs: null } },
      { atMs: 150, verb: 'seek', cueId: 'a', positionMs: 200 }
    ]
  })
  check('fade-in reaches full level', near(sampleAt(wav, 4900), 0.5))
  let dip = false
  for (let frame = 7200; frame < 9600; frame++) {
    if (sampleAt(wav, frame) < 0.5 - 1e-4) dip = true
  }
  check('no dip after the seek', !dip)
  check('audio continues at full level', near(sampleAt(wav, 9000), 0.5))
}

// --- 8. cache: hits, oversized bypass, survival, eviction -----------------
{
  console.log('\ncache: hit promotion, oversized bypass, LRU bounds')
  const { summary } = runEngine(
    {
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: 9600,
      commands: [
        { atMs: 0, verb: 'prepare', cueId: 'small', filePath: dc2Path },
        { atMs: 0, verb: 'prepare', cueId: 'small-again', filePath: dc2Path },
        { atMs: 0, verb: 'prepare', cueId: 'big', filePath: longPath },
        { atMs: 0, verb: 'prepare', cueId: 'small-third', filePath: dc2Path },
        { atMs: 0, verb: 'info' }
      ]
    },
    ['--cache-max-file-bytes', '300000', '--cache-max-bytes', '4000000', '--cache-max-files', '8']
  )
  const first = replyFor(summary, 0).result
  const second = replyFor(summary, 1).result
  const big = replyFor(summary, 2).result
  const third = replyFor(summary, 3).result
  const info = replyFor(summary, 4).result
  check('first prepare is a cold load', first.cacheHit === false && first.streaming === false)
  check('second prepare is a genuine hit', second.cacheHit === true)
  check('oversized file streams and is not cached', big.streaming === true && big.cacheHit === false)
  check('small file survives the oversized prepare', third.cacheHit === true, JSON.stringify(third))
  check('bypass is counted', info.cache.bypassed >= 1, JSON.stringify(info.cache))
  check('cache stays within its file-count bound', info.cache.entries <= info.cache.maxFiles)
}
{
  const { summary } = runEngine(
    {
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: 9600,
      commands: [
        { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
        { atMs: 0, verb: 'prepare', cueId: 'b', filePath: dc4Path },
        { atMs: 0, verb: 'info' }
      ]
    },
    ['--cache-max-files', '1']
  )
  const info = replyFor(summary, 2).result
  check('eviction respects the file bound', info.cache.entries === 1 && info.cache.evictions >= 1, JSON.stringify(info.cache))
}

// --- 9. streaming a long file stays bounded and correct --------------------
{
  console.log('\nstreaming: bounded pre-roll, correct output')
  const { summary, wav } = runEngine(
    {
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: 96000,
      commands: [
        { atMs: 0, verb: 'prepare', cueId: 'long', filePath: longPath },
        { atMs: 0, verb: 'start', cueId: 'long', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
        { atMs: 20, verb: 'info' }
      ]
    },
    ['--cache-max-file-bytes', '300000', '--stream-preroll-ms', '200']
  )
  const prepared = replyFor(summary, 0).result
  const info = replyFor(summary, 2).result
  check('oversized prepare reports streaming', prepared.streaming === true)
  check('one streaming voice is active', info.media.streamingVoices === 1, JSON.stringify(info.media))
  check('pre-roll stays inside its byte budget', info.media.streamBufferBytes > 0 && info.media.streamBufferBytes <= 4 * 1024 * 1024, JSON.stringify(info.media))
  check('streamed audio is correct', near(sampleAt(wav, 40000), 0.25))
  check('no underruns on a local file', events(summary, 'error').length === 0, JSON.stringify(events(summary, 'error')))

  // A streaming decoder fills forward from wherever it was opened, so every jump the
  // voice makes — a start offset, a seek, a loop back to the segment start — has to
  // move the ring window with it. It used to stay parked: the voice asked for frames
  // the ring could never reach and played silence, with an underrun for every frame,
  // for the rest of the run. `rampPath` says on each sample where it came from, so the
  // tests below read the position off the audio.
  const streamArgs = ['--cache-max-file-bytes', '300000', '--stream-preroll-ms', '200']
  const rampOptions = (extra) => ({
    startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null, ...extra
  })

  const offsetStart = runEngine(
    {
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: 24000,
      commands: [
        { atMs: 0, verb: 'prepare', cueId: 'ramp', filePath: rampPath },
        { atMs: 0, verb: 'start', cueId: 'ramp', whenMs: 0, options: rampOptions({ startTime: 1500 }) },
        { atMs: 100, verb: 'info' }
      ]
    },
    streamArgs
  )
  check('the ramp fixture streams', offsetStart.summary.results[0].reply.result.streaming === true)
  check(
    'a streamed start at an offset plays from that frame',
    near(sampleAt(offsetStart.wav, 0), 72000 / 480000),
    `${sampleAt(offsetStart.wav, 0)} at frame 0 (expected ${72000 / 480000})`
  )
  check(
    'and keeps advancing from there',
    near(sampleAt(offsetStart.wav, 4800), 76800 / 480000),
    `${sampleAt(offsetStart.wav, 4800)} at frame 4800 (expected ${76800 / 480000})`
  )
  check(
    'the repositioning is not counted as an underrun',
    replyFor(offsetStart.summary, 2).result.media.decodeUnderruns === 0,
    JSON.stringify(replyFor(offsetStart.summary, 2).result.media)
  )

  const looped = runEngine(
    {
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: true,
      frames: SAMPLE_RATE * 9,
      commands: [
        { atMs: 0, verb: 'prepare', cueId: 'ramp', filePath: rampPath },
        { atMs: 0, verb: 'start', cueId: 'ramp', whenMs: 0, options: rampOptions({ loopCount: 1 }) }
      ]
    },
    streamArgs
  )
  const loopEnded = events(looped.summary, 'ended')
  check(
    'a streamed voice plays its second pass through the loop',
    loopEnded.length === 1 && loopEnded[0].reason === 'complete' && loopEnded[0].loopsCompleted === 1,
    JSON.stringify(loopEnded)
  )
  let secondPassPeak = 0
  for (let frame = SAMPLE_RATE * 6; frame < SAMPLE_RATE * 7; frame++) {
    secondPassPeak = Math.max(secondPassPeak, Math.abs(sampleAt(looped.wav, frame)))
  }
  check('the second pass is audible, not silence', secondPassPeak > 0.15, `peak ${secondPassPeak}`)

  // Below rate 1 the same source frame serves several output frames, so the ring must
  // not release a frame until the voice has finished with it. It used to release one
  // frame past the one being played, and every slower-than-real-time voice on a long
  // file then asked for a frame the window had already dropped: silence, an underrun
  // per output frame, for the rest of the run.
  const slowed = runEngine(
    {
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: SAMPLE_RATE,
      commands: [
        { atMs: 0, verb: 'prepare', cueId: 'ramp', filePath: rampPath },
        { atMs: 0, verb: 'start', cueId: 'ramp', whenMs: 0, options: rampOptions({ rate: 0.5 }) },
        { atMs: 100, verb: 'info' }
      ]
    },
    streamArgs
  )
  check(
    'a streamed voice at half rate plays, not silence',
    near(sampleAt(slowed.wav, 4800), 2400 / 480000, 1e-4),
    `${sampleAt(slowed.wav, 4800)} at frame 4800 (expected ${2400 / 480000})`
  )
  check(
    'a slower-than-real-time voice is not reported as starved',
    replyFor(slowed.summary, 2).result.media.decodeUnderruns === 0,
    JSON.stringify(replyFor(slowed.summary, 2).result.media)
  )

  const seeked = runEngine(
    {
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: SAMPLE_RATE * 2,
      commands: [
        { atMs: 0, verb: 'prepare', cueId: 'ramp', filePath: rampPath },
        { atMs: 0, verb: 'start', cueId: 'ramp', whenMs: 0, options: rampOptions({}) },
        { atMs: 1000, verb: 'seek', cueId: 'ramp', positionMs: 200 },
        { atMs: 1500, verb: 'info' }
      ]
    },
    streamArgs
  )
  // The seek command carries no frame of its own (it lands where it is applied), so the
  // absolute level is asserted where the ramp is unmistakable rather than sample-exact:
  // a voice still playing from before the seek cannot be near 0.02 a second later.
  const afterSeek = sampleAt(seeked.wav, SAMPLE_RATE + 480)
  check('a streamed seek lands near the requested position', Math.abs(afterSeek - 10080 / 480000) < 0.005, `${afterSeek}`)
  check(
    'the seek did not silence the voice',
    secondPassPeak > 0 && Math.abs(sampleAt(seeked.wav, SAMPLE_RATE + 1000) - sampleAt(seeked.wav, SAMPLE_RATE + 480)) > 0.0005,
    `${sampleAt(seeked.wav, SAMPLE_RATE + 480)} then ${sampleAt(seeked.wav, SAMPLE_RATE + 1000)}`
  )
  check(
    'the seek is not counted as an underrun',
    replyFor(seeked.summary, 3).result.media.decodeUnderruns === 0,
    JSON.stringify(replyFor(seeked.summary, 3).result.media)
  )
}

// --- 10. waveform is bounded and truthful ---------------------------------
{
  console.log('\nwaveform scan')
  const { summary } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 512,
    commands: [
      { atMs: 0, verb: 'waveform', filePath: dc4Path, points: 64 },
      { atMs: 0, verb: 'waveform', filePath: dc4Path, points: 100000 }
    ]
  })
  const small = replyFor(summary, 0).result
  const clamped = replyFor(summary, 1).result
  check('bounded points return min/max pairs', small.buckets === 64 && small.values.length === 128)
  // The panel folds the first two channels into one min/max pair per bucket: the
  // fixture is 0.1 and 0.2 there, so the pair is exactly that.
  check('peaks report the real signal', near(small.values[0], 0.1) && near(small.values[1], 0.2), JSON.stringify(small.values.slice(0, 4)))
  check('duration and channels are reported', near(small.durationMs, 500, 1) && small.sampleRate === SAMPLE_RATE && small.channels === 4)
  check('oversized point counts are clamped and flagged', clamped.buckets === 4096 && clamped.truncated === true)
}

// --- 11. panic stops everything and says so -------------------------------
{
  console.log('\npanic')
  const { summary, wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 24000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      { atMs: 0, verb: 'prepare', cueId: 'b', filePath: dc4Path },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
      { atMs: 0, verb: 'start', cueId: 'b', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
      { atMs: 100, verb: 'panic', fadeMs: 0 }
    ]
  })
  check('panic reports the voices it silenced', replyFor(summary, 4).result.stoppedVoices === 2, JSON.stringify(replyFor(summary, 4).result))
  check('there is a panic event', events(summary, 'panic').length === 1)
  check('audio is silent after the panic', Math.abs(sampleAt(wav, 6000)) < 1e-6)
  check('both runs ended', events(summary, 'ended').length === 2)
  // The reason belongs to the panic's caller: the device-failure panic ends its voices
  // `device-lost`, and everything else that panics — the verb here, the watchdog, the
  // menu — still stops them.
  check('an operator panic ends what it silenced stopped', events(summary, 'ended').every((event) => event.reason === 'stopped'), JSON.stringify(events(summary, 'ended')))
}

// --- 12. zero-length edge -------------------------------------------------
{
  console.log('\nzero-length segment')
  const { summary, wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: { startTime: 100, endTime: 100, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } }
    ]
  })
  let loudest = 0
  for (let i = 0; i < wav.samples.length; i++) loudest = Math.max(loudest, Math.abs(wav.samples[i]))
  const ended = events(summary, 'ended')
  check('no output for an empty segment', loudest < 1e-6)
  check('an ended(complete) event is still emitted', ended.length === 1 && ended[0].reason === 'complete')
}

// --- 13. M4A/AAC decoding (packaged LGPL helper on Linux, OS codec elsewhere) ---
{
  console.log('\nM4A/AAC decoding')
  const fixture = join(repoRoot, 'native', 'audio', 'tests', 'fixtures', 'aac-tone.m4a')
  if (!existsSync(fixture)) {
    check('the M4A fixture is present', false, fixture)
  } else {
    const { summary, wav } = runEngine({
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: 24000,
      commands: [
        { atMs: 0, verb: 'prepare', cueId: 'm4a', filePath: fixture },
        { atMs: 0, verb: 'start', cueId: 'm4a', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } }
      ]
    })
    const prepared = replyFor(summary, 0).result
    check('M4A metadata comes from the container', prepared.format === 'm4a' && prepared.sampleRate === SAMPLE_RATE && prepared.channels === 2, JSON.stringify(prepared))
    let peak = 0
    for (let i = 0; i < wav.samples.length; i++) peak = Math.max(peak, Math.abs(wav.samples[i]))
    check('decoded AAC is audible', peak > 0.2, `peak ${peak.toFixed(4)}`)
    // The fixture is a 440 Hz tone: a decoder that produced noise or silence would not
    // show this many zero crossings with this spacing.
    let crossings = 0
    for (let frame = 1; frame < Math.min(wav.frames, SAMPLE_RATE / 2); frame++) {
      if (sampleAt(wav, frame - 1) <= 0 && sampleAt(wav, frame) > 0) crossings++
    }
    check('decoded AAC is the tone that was encoded', Math.abs(crossings - 220) <= 12, `${crossings} rising crossings`)
    check('no decode errors', events(summary, 'error').length === 0, JSON.stringify(events(summary, 'error')))
  }
}

// --- 14. device notifications: a deliberate stop is not a loss ------------
{
  console.log('\ndevice notification classification')
  // A reconfigure or shutdown makes the backend post a `stopped` notification; that is
  // the engine's own doing and must not be reported as a lost device or silence a show.
  const { summary } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'simulateDeviceNotification', type: 'stopped', deliberate: true },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
      { atMs: 0, verb: 'simulateDeviceNotification', type: 'stopped', deliberate: true },
      { atMs: 0, verb: 'simulateDeviceNotification', type: 'interruption_began', deliberate: true },
      // Asked for later so it reflects rendered state, not the moment before the first block.
      { atMs: 50, verb: 'info' }
    ]
  })
  const info = replyFor(summary, 5).result
  check('a deliberate stop raises no error', events(summary, 'error').length === 0, JSON.stringify(events(summary, 'error')))
  check('a deliberate stop does not silence playback', info.active === true && info.activeVoices === 1, JSON.stringify({ active: info.active, voices: info.activeVoices }))
  check('no panic is broadcast for a deliberate stop', events(summary, 'panic').length === 0)
}
{
  const { summary, wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 9600,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
      // A second voice two seconds out, so it is scheduled and not started when the
      // device goes: a loss ends what it lost `device-lost` and cancels the rest.
      { atMs: 0, verb: 'prepare', cueId: 'b', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'b', whenMs: 2000, options: { startTime: 0, endTime: null, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
      // A third whose start frame is the frame the loss lands on: applied, never rendered.
      // It cannot have been lost with the device — no block ever made a sound from it — so
      // it ends `cancelled` rather than `device-lost`.
      { atMs: 60, verb: 'prepare', cueId: 'c', filePath: dc2Path },
      { atMs: 60, verb: 'start', cueId: 'c', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
      { atMs: 60, verb: 'simulateDeviceNotification', type: 'stopped', deliberate: false },
      { atMs: 90, verb: 'info' }
    ]
  })
  const info = replyFor(summary, 7).result
  const errors = events(summary, 'error')
  check('an unexpected stop is reported as a device error', errors.length === 1 && errors[0].code === 'device', JSON.stringify(errors))
  check('the message names the failure', errors.length === 1 && /stopped unexpectedly/.test(errors[0].message), JSON.stringify(errors[0] ?? {}))
  check('the active indicator clears when the device is lost', info.active === false, JSON.stringify({ active: info.active }))
  // The loss must silence the show, not leave it playing into a dead device.
  const tailIsSilent = Math.abs(sampleAt(wav, 9000)) < 1e-6
  check('a lost device silences the mixer', tailIsSilent)
  // Which end each voice got, through the applied-queue path this lane has instead of a
  // render thread: the failure's panic is applied by the pump, so the ended lines leave
  // from there, in queue order, before the panic that follows them.
  const ended = events(summary, 'ended')
  const endedFor = (cueId) => ended.find((event) => event.cueId === cueId) ?? null
  check('the voice that was sounding ends device-lost', endedFor('a')?.reason === 'device-lost', JSON.stringify(ended))
  check('the voice that never started ends cancelled', endedFor('b')?.reason === 'cancelled', JSON.stringify(ended))
  check('the voice whose start frame arrived but never rendered ends cancelled too', endedFor('c')?.reason === 'cancelled', JSON.stringify(ended))
  const panicAt = summary.events.findIndex((event) => event.type === 'panic')
  check('the ends leave before the panic the pump applies',
    ['a', 'b', 'c'].every((cueId) => panicAt > ended.indexOf(endedFor(cueId))),
    JSON.stringify({ events: summary.events.map((event) => `${event.type}:${event.cueId ?? '-'}:${event.reason ?? ''}`) }))
}

// --- 15. probe: metadata only, no cache side effects ----------------------
{
  console.log('\nprobe reads headers without decoding')
  const { summary } = runEngine(
    {
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: 512,
      commands: [
        { atMs: 0, verb: 'probe', filePath: dc2Path },
        { atMs: 0, verb: 'info' },
        { atMs: 0, verb: 'probe', filePath: longPath },
        { atMs: 0, verb: 'info' },
        { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
        { atMs: 0, verb: 'probe', filePath: dc2Path },
        { atMs: 0, verb: 'info' }
      ]
    },
    ['--cache-max-file-bytes', '300000']
  )
  const small = replyFor(summary, 0).result
  const afterProbes = replyFor(summary, 3).result
  const prepared = replyFor(summary, 4).result
  const resident = replyFor(summary, 5).result
  const afterEverything = replyFor(summary, 6).result

  check('probe reports the real metadata', small.format === 'wav' && small.sampleRate === SAMPLE_RATE && small.channels === 2 && small.frames === 24000 && near(small.durationMs, 500, 1), JSON.stringify(small))
  check('probe sizes the decoded footprint', small.decodedBytes === 24000 * 2 * 4 && small.streaming === false, JSON.stringify({ decodedBytes: small.decodedBytes, streaming: small.streaming }))
  check('a cold probe is not resident', small.resident === false)
  check('probing decodes nothing and caches nothing', afterProbes.cache.entries === 0 && afterProbes.cache.bytes === 0 && afterProbes.cache.misses === 0 && afterProbes.cache.bypassed === 0, JSON.stringify(afterProbes.cache))
  check('probing leaves resident bytes at zero for the UI', afterProbes.media.residentBytes === 0, JSON.stringify(afterProbes.media))
  const big = replyFor(summary, 2).result
  check('probe predicts streaming from the decoded size', big.streaming === true && big.decodedBytes === 144000 * 2 * 4, JSON.stringify({ streaming: big.streaming, decodedBytes: big.decodedBytes }))

  // The prediction must be exactly what playback does: prepare takes the same decision.
  check('prepare agrees with the probe decision', prepared.streaming === false && prepared.cacheHit === false)
  check('a probe after prepare sees the resident copy without promoting it', resident.resident === true)
  check('probing after a prepare still changes no counter', afterEverything.cache.hits === 0 && afterEverything.cache.entries === 1, JSON.stringify(afterEverything.cache))
}

// --- 16. rejection paths are honest ---------------------------------------
{
  console.log('\nrejections')
  const { summary } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 512,
    commands: [
      { atMs: 0, verb: 'start', cueId: 'never-prepared', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: join(workDir, 'missing.wav') },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 60000, options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
      // The horizon covers every verb carrying a `whenMs`, not the start alone: this
      // stop is placed on the same clock and refused the same way, by the declaration.
      { atMs: 0, verb: 'stop', cueId: 'a', whenMs: 60000 },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: 0, rate: 0, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } }
    ]
  })
  check('start without prepare is refused', replyFor(summary, 0).ok === false && replyFor(summary, 0).error.code === 'not-prepared')
  check('a missing file is refused', replyFor(summary, 1).ok === false && replyFor(summary, 1).error.code === 'decode')
  check('a start beyond the horizon is refused', replyFor(summary, 3).ok === false && replyFor(summary, 3).error.code === 'limit')
  check('a stop beyond the horizon is refused, naming the horizon', replyFor(summary, 4).ok === false && replyFor(summary, 4).error.code === 'limit' && /horizon/.test(replyFor(summary, 4).error.message), JSON.stringify(replyFor(summary, 4)))
  check('a zero rate is refused', replyFor(summary, 5).ok === false && replyFor(summary, 5).error.code === 'invalid')
}

// --- 17. pan belongs to automatic routing only ----------------------------
{
  console.log('\nexplicit routing is not panned')
  // A mono voice routed explicitly to all four outputs at unity must play at unity on
  // all four whatever the pan knob says; an operator's matrix is the whole statement.
  const unityMatrix = [
    { inputChannel: 0, outputChannel: 0, gain: 1 },
    { inputChannel: 0, outputChannel: 1, gain: 1 },
    { inputChannel: 0, outputChannel: 2, gain: 1 },
    { inputChannel: 0, outputChannel: 3, gain: 1 }
  ]
  const script = (pan, outputs) => ({
    sampleRate: SAMPLE_RATE,
    channels: 4,
    blockFrames: 256,
    stopWhenIdle: false,
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: monoPath },
      {
        atMs: 0,
        verb: 'start',
        cueId: 'a',
        whenMs: 0,
        options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan, fadeInDuration: 0, outputs }
      }
    ]
  })
  const rms = (wav, channel, frames = 4800) => {
    let sum = 0
    for (let frame = 0; frame < frames; frame++) {
      const value = sampleAt(wav, frame, channel)
      sum += value * value
    }
    return Math.sqrt(sum / frames)
  }
  for (const pan of [-1, -0.5, 0, 0.5, 1]) {
    const levels = [0, 1, 2, 3].map((channel) => rms(runEngine(script(pan, unityMatrix)).wav, channel))
    check(
      `unity matrix is flat on four outputs at pan ${pan}`,
      levels.every((level) => near(level, levels[0])),
      JSON.stringify(levels)
    )
    // The pan law leaves exactly one side at unity, and only at the extremes; anywhere
    // else the automatic route is deliberately quieter, so there is no level to match.
    if (pan === -1 || pan === 1) {
      const channel = pan < 0 ? 0 : 1
      const automatic = rms(runEngine(script(pan, null)).wav, channel)
      check(
        `pan ${pan} matches automatic routing on output ${channel}`,
        near(levels[channel], automatic),
        `${levels[channel]} vs ${automatic}`
      )
    }
  }
}

// --- 18. malformed media is refused, not fatal ----------------------------
{
  console.log('\nmalformed media')
  // A container that cannot be parsed is a refusal, never a crash. It used to be a
  // crash: dr_wav and dr_mp3 free their own state when init fails, and the source
  // destructors then uninitialized the failed decoder, freeing it a second time
  // (glibc aborts the process). A corrupted file, or one still being copied onto the
  // show machine, took the whole engine — and whatever was playing — down with it.
  const wavHeader = (channels) => {
    const bytes = Buffer.alloc(44)
    bytes.write('RIFF', 0); bytes.writeUInt32LE(36, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12)
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(channels, 22)
    bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(48000 * 8, 28); bytes.writeUInt16LE(8, 32)
    bytes.writeUInt16LE(32, 34); bytes.write('data', 36); bytes.writeUInt32LE(0, 40)
    return bytes
  }
  const malformed = {
    // Valid magic, so the sniffer dispatches to the decoder, then nothing usable.
    'truncated-wav': Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt '),
    'half-fmt-wav': Buffer.concat([wavHeader(2).subarray(0, 28), Buffer.alloc(8)]),
    'zero-channel-wav': wavHeader(0),
    'id3-garbage-mp3': Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20, 0x41)]),
    'frame-sync-garbage-mp3': Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(40, 0x11)]),
    'flac-garbage': Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(40, 0x11)]),
    'ogg-garbage': Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40, 0x11)]),
    'aiff-garbage': Buffer.concat([Buffer.from('FORM'), Buffer.alloc(4, 0x20), Buffer.from('AIFF'), Buffer.alloc(20, 0x11)]),
    'm4a-garbage': Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(30, 0x11)])
  }
  const names = Object.keys(malformed)
  const files = {}
  for (const name of names) {
    files[name] = join(workDir, `${name}.bin`)
    writeFileSync(files[name], malformed[name])
  }

  // The show is already playing when the bad files are offered; it must still be
  // playing after, and the same engine must still be able to play a new cue.
  const { summary, wav } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 48000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'show', filePath: dc2Path },
      { atMs: 0, verb: 'start', cueId: 'show', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
      ...names.map((name, index) => ({ atMs: 100 + index, verb: 'prepare', cueId: name, filePath: files[name] })),
      { atMs: 400, verb: 'info' },
      { atMs: 500, verb: 'prepare', cueId: 'after', filePath: dc2Path },
      { atMs: 600, verb: 'start', cueId: 'after', whenMs: 700, options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } }
    ]
  })

  for (let index = 0; index < names.length; index++) {
    const reply = replyFor(summary, 2 + index)
    check(
      `${names[index]} is refused as unreadable`,
      reply.ok === false && (reply.error.code === 'decode' || reply.error.code === 'format-unavailable'),
      JSON.stringify(reply)
    )
  }
  const info = replyFor(summary, 2 + names.length).result
  check('the cue that was playing is untouched', info.active === true && info.activeVoices === 1, JSON.stringify({ active: info.active, voices: info.activeVoices }))
  check('the engine still prepares media after the refusals', replyFor(summary, 3 + names.length).ok === true)
  check('a cue started after the refusals really plays', Math.abs(sampleAt(wav, 24000)) > 0.1, `sample ${sampleAt(wav, 24000)}`)
}

// --- 19. release ends a loop and plays the rest of the file ----------------
//
// The vamp's second verb. A cue looping a section is a vamp; a devamp releases it, and
// the music continues from wherever the loop had reached rather than restarting at the
// seam. The ramp fixture says on every sample where it came from, so a release that
// jumped, restarted or spliced is readable off the output.
{
  console.log('\nrelease plays the tail out of a loop')
  const released = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: true,
    frames: SAMPLE_RATE * 6,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'ramp', filePath: rampPath },
      // Loops 2s-3s of the four-second file, forever: a vamp.
      {
        atMs: 0, verb: 'start', cueId: 'ramp', whenMs: 0,
        options: { startTime: 2000, endTime: 3000, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null }
      },
      { atMs: 2500, verb: 'release', cueId: 'ramp' }
    ]
  })

  const reply = replyFor(released.summary, 2)
  check('the release is applied', reply.ok === true && reply.result.applied === true, JSON.stringify(reply))

  // Where the loop was when it was released: 0.5s into a section that started at 2s.
  check(
    'the sample at the release is the one the loop had reached',
    near(sampleAt(released.wav, 120000), 120000 / 480000, 2e-4),
    `${sampleAt(released.wav, 120000)} at frame 120000`
  )
  // An eighth of a second later the position has advanced through the file. A voice that
  // had gone on looping would be back at 2s (0.20833) here; one that restarted would be
  // at 0.033.
  check(
    'the released voice keeps advancing through the file',
    near(sampleAt(released.wav, 126000), 126000 / 480000, 2e-4),
    `${sampleAt(released.wav, 126000)} at frame 126000`
  )
  check(
    'the voice plays past the end of the section it was looping',
    near(sampleAt(released.wav, 168000), 168000 / 480000, 2e-4),
    `${sampleAt(released.wav, 168000)} at frame 168000 (3.5s into the file)`
  )
  // The file is four seconds, so the last sample is frame 191999: a voice that stopped
  // at the section end would be silent a quarter of a second before this.
  check(
    'and it plays right up to the last sample of the file',
    near(sampleAt(released.wav, 191999), 191999 / 480000, 2e-4) && Math.abs(sampleAt(released.wav, 192001)) < 1e-6,
    `${sampleAt(released.wav, 191999)} at frame 191999`
  )
  const ended = events(released.summary, 'ended')
  check(
    'the released voice ends complete',
    ended.length === 1 && ended[0].reason === 'complete',
    JSON.stringify(ended)
  )

  // A voice that is not looping is not vamping: a release would be a verb that silently
  // did nothing, so it says so instead of reporting a change that did not happen.
  const straight = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 24000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'ramp', filePath: rampPath },
      {
        atMs: 0, verb: 'start', cueId: 'ramp', whenMs: 0,
        options: { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null }
      },
      { atMs: 100, verb: 'release', cueId: 'ramp' }
    ]
  })
  const straightReply = replyFor(straight.summary, 2)
  check(
    'releasing a voice that is not looping changes nothing',
    straightReply.ok === true && straightReply.result.applied === false,
    JSON.stringify(straightReply)
  )
}

// --- 20. onsets: where a note or a hit begins ------------------------------
//
// The slicer's scan. Four 1kHz bursts separated by digital silence are the positive
// control — all four come back, and nothing in the gaps — while a steady tone and a
// silent file are the negative controls: a detector that fires on those is detecting
// frames, not hits. A file whose channels cancel when they are averaged proves the
// scan folds them the way the engine says it does.
{
  console.log('\nonset detection')
  const burstStartsMs = [250, 750, 1250, 1750]
  // 60ms of 1kHz, 2ms of attack and 6ms of release: the envelope a sampled hit has,
  // rather than a rectangle, whose corner would be a click in its own right.
  const burstFrames = Math.round(0.06 * SAMPLE_RATE)
  const attackFrames = Math.round(0.002 * SAMPLE_RATE)
  const releaseFrames = Math.round(0.006 * SAMPLE_RATE)
  const burstEnvelope = (within) => {
    if (within < 0 || within >= burstFrames) return 0
    if (within < attackFrames) return 0.5 * (1 - Math.cos((Math.PI * within) / attackFrames))
    if (within >= burstFrames - releaseFrames) {
      return 0.5 * (1 - Math.cos((Math.PI * (burstFrames - within)) / releaseFrames))
    }
    return 1
  }
  const burstStarts = burstStartsMs.map((ms) => Math.round((ms / 1000) * SAMPLE_RATE))
  const burstSample = (frame) => {
    let envelope = 0
    for (const start of burstStarts) envelope += burstEnvelope(frame - start)
    return 0.6 * envelope * Math.sin((2 * Math.PI * 1000 * frame) / SAMPLE_RATE)
  }
  const burstPath = join(workDir, 'bursts.wav')
  writeFloatWav(burstPath, 2, SAMPLE_RATE, SAMPLE_RATE * 2, (channel, frame) => burstSample(frame))
  const tonePath = join(workDir, 'steady-tone.wav')
  writeFloatWav(tonePath, 2, SAMPLE_RATE, SAMPLE_RATE, (channel, frame) =>
    0.6 * Math.sin((2 * Math.PI * 1000 * frame) / SAMPLE_RATE)
  )
  const silentPath = join(workDir, 'digital-silence.wav')
  writeFloatWav(silentPath, 2, SAMPLE_RATE, SAMPLE_RATE, () => 0)
  const cancellingPath = join(workDir, 'cancelling.wav')
  writeFloatWav(cancellingPath, 2, SAMPLE_RATE, SAMPLE_RATE, (channel, frame) =>
    channel === 0 ? burstSample(frame) : -burstSample(frame)
  )
  // A bed of noise with three louder stretches in it. The bed is what makes sensitivity
  // observable: with no noise the median flux is zero and every setting finds the same
  // hits, however strict it is. xorshift keeps the fixture identical on every run and
  // every platform, so the only thing that decides whether a step is found is the
  // threshold it is measured against.
  const steppedPath = join(workDir, 'noise-bed.wav')
  const stepStarts = [400, 900, 1400].map((ms) => Math.round((ms * SAMPLE_RATE) / 1000))
  const stepFrames = Math.round(0.08 * SAMPLE_RATE)
  const bedFrames = SAMPLE_RATE * 2
  const bed = new Float32Array(bedFrames)
  let noiseState = 0x9e3779b9
  for (let frame = 0; frame < bedFrames; frame++) {
    noiseState ^= noiseState << 13
    noiseState ^= noiseState >>> 17
    noiseState ^= noiseState << 5
    const inStep = stepStarts.some((start) => frame >= start && frame < start + stepFrames)
    bed[frame] = (inStep ? 0.4 : 0.1) * (((noiseState >>> 0) / 4294967295) * 2 - 1)
  }
  writeFloatWav(steppedPath, 2, SAMPLE_RATE, bedFrames, (channel, frame) => bed[frame])
  const absentPath = join(workDir, 'no-such-file.wav')

  const { summary } = runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames: 512,
    commands: [
      { atMs: 0, verb: 'onsets', filePath: burstPath },
      // The same file again, warm in the decoded cache this time: the answer must not
      // depend on which side of the cache the file happened to fall.
      { atMs: 0, verb: 'prepare', cueId: 'warm', filePath: burstPath },
      { atMs: 0, verb: 'onsets', filePath: burstPath },
      { atMs: 0, verb: 'onsets', filePath: burstPath, sensitivity: 5.0 },
      { atMs: 0, verb: 'onsets', filePath: burstPath, maxOnsets: 2 },
      { atMs: 0, verb: 'onsets', filePath: tonePath },
      { atMs: 0, verb: 'onsets', filePath: silentPath },
      { atMs: 0, verb: 'onsets', filePath: cancellingPath },
      { atMs: 0, verb: 'onsets', filePath: absentPath },
      { atMs: 0, verb: 'onsets', filePath: steppedPath },
      { atMs: 0, verb: 'onsets', filePath: steppedPath, sensitivity: 0.5 },
      { atMs: 0, verb: 'onsets', filePath: steppedPath, sensitivity: 5.0 }
    ]
  })

  const cold = replyFor(summary, 0).result
  const warm = replyFor(summary, 2).result
  const stricter = replyFor(summary, 3).result
  const capped = replyFor(summary, 4).result
  const tone = replyFor(summary, 5).result
  const silent = replyFor(summary, 6).result
  const cancelling = replyFor(summary, 7).result
  const absent = replyFor(summary, 8)
  const bedDefault = replyFor(summary, 9).result
  const bedLooser = replyFor(summary, 10).result
  const bedStricter = replyFor(summary, 11).result

  check('every burst is found and nothing else in the file', cold.onsetsMs.length === 4, JSON.stringify(cold.onsetsMs))
  check(
    'each onset lands within 10ms of its burst',
    cold.onsetsMs.every((ms, index) => Math.abs(ms - burstStartsMs[index]) <= 10),
    JSON.stringify(cold.onsetsMs)
  )
  check(
    'the scan describes the file it scanned',
    near(cold.durationMs, 2000, 1) && cold.sampleRate === SAMPLE_RATE && cold.channels === 2 && cold.truncated === false,
    JSON.stringify({ durationMs: cold.durationMs, sampleRate: cold.sampleRate, channels: cold.channels, truncated: cold.truncated })
  )
  check(
    'a warm file scans exactly like a cold one',
    JSON.stringify(warm.onsetsMs) === JSON.stringify(cold.onsetsMs),
    JSON.stringify(warm.onsetsMs)
  )
  check(
    'a stricter sensitivity finds no onsets the default did not',
    stricter.onsetsMs.length <= cold.onsetsMs.length,
    `${stricter.onsetsMs.length} at 5.0 vs ${cold.onsetsMs.length} at 1.0`
  )
  check(
    'the cap is honoured and the truncation is admitted',
    capped.onsetsMs.length === 2 && capped.truncated === true,
    JSON.stringify({ onsetsMs: capped.onsetsMs, truncated: capped.truncated })
  )
  check('a steady tone has no onsets', tone.onsetsMs.length === 0, JSON.stringify(tone.onsetsMs))
  check('digital silence has no onsets', silent.onsetsMs.length === 0, JSON.stringify(silent.onsetsMs))
  check(
    'the scan averages the first two channels',
    cancelling.onsetsMs.length === 0,
    JSON.stringify(cancelling.onsetsMs)
  )
  check(
    'a missing file is refused as undecodable',
    absent.ok === false && absent.error.code === 'decode',
    JSON.stringify(absent)
  )
  // Sensitivity has to move the threshold the way the parameter says it does. With a
  // noise bed present the median flux is no longer zero, so the three steps in it are
  // only as findable as the setting they are measured against allows.
  check(
    'the three steps over a noise bed are found, and its noise is not',
    bedDefault.onsetsMs.length === 3 && [400, 900, 1400].every((ms, index) => Math.abs(bedDefault.onsetsMs[index] - ms) <= 10),
    JSON.stringify(bedDefault.onsetsMs)
  )
  check(
    'a looser setting finds at least as many as the default',
    bedLooser.onsetsMs.length >= bedDefault.onsetsMs.length,
    `${bedLooser.onsetsMs.length} at 0.5 vs ${bedDefault.onsetsMs.length} at 1.0`
  )
  check(
    'a stricter setting gives up onsets rather than inventing them',
    bedStricter.onsetsMs.length < bedDefault.onsetsMs.length,
    `${bedStricter.onsetsMs.length} at 5.0 vs ${bedDefault.onsetsMs.length} at 1.0`
  )
}

// --- 21. panic and stopAll act where the script issues them --------------
//
// The runner stamps a script's `atMs` onto the verbs whose declaration carries a
// `whenMs`; panic and stopAll do not carry one, so they act in the block that issues
// them — which is what they did before the declaration decided it, and what this pins.
{
  console.log('\nscheduled panic and stopAll')
  for (const verb of ['panic', 'stopAll']) {
    const { summary, wav } = runEngine({
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: 24000,
      commands: [
        { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dc2Path },
        { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: { startTime: 0, endTime: null, loopCount: -1, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null } },
        { atMs: 200, verb }
      ]
    })
    const reply = replyFor(summary, 2)
    check(`${verb} with an atMs and no whenMs still stops the show`, reply.ok === true, JSON.stringify(reply))
    // 200 ms of a 512-frame block is inside the block rendered from frame 9088: the file
    // is still what was rendered before it, and the block itself is silence. A runner
    // that started stamping a `whenMs` these verbs do not read would move neither.
    check(`${verb} plays up to the block its atMs falls in`, near(sampleAt(wav, 4800), 0.5, 1e-3), `${sampleAt(wav, 4800)}`)
    check(`${verb} is silent from that block on`, Math.abs(sampleAt(wav, 12000)) < 1e-6, `${sampleAt(wav, 12000)}`)
    check(
      `${verb} reports acting within a block of its atMs`,
      reply.ok === true && reply.result.at > 150 && reply.result.at <= 200,
      JSON.stringify(reply.result)
    )
  }
}

rmSync(workDir, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
