#!/usr/bin/env node
/**
 * The sound of a video cue: what the engine makes of a video file.
 *
 * A video cue's picture is the output window's to decode; its sound is an ordinary voice
 * here, so the engine has to read the audio track out of the containers video comes in. Four
 * things are held:
 *
 *   - an MP4 with an AAC track plays as an M4A does — the same container reader, the same
 *     decoder — and is the tone that was encoded, for as long as the file says;
 *   - a WebM (Matroska) with an Opus track is read from its own headers and decoded, and its
 *     length is the segment's duration;
 *   - a video with no sound track is refused with `no-audio`, not `decode`: a picture with no
 *     sound is ordinary, and the window plays the picture alone on that code;
 *   - a file that only starts like Matroska is refused as unreadable, never decoded into noise.
 *
 * The fixtures are tiny files made with FFmpeg's test sources (a solid colour, a sine):
 *   video-tone.mp4   64×36 H.264, 2 s (1 s red, 1 s green) + AAC 440 Hz stereo, 48 kHz
 *   video-tone.webm  64×36 VP8, 1 s blue + Opus 660 Hz stereo, 48 kHz
 *   video-silent.mp4 64×36 H.264, 1 s yellow, no audio track
 * The same three sit under e2e/fixtures/visual for the window's specs.
 *
 *   node native/audio/tests/video-audio.mjs [--binary path]
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
const fixtures = join(repoRoot, 'native', 'audio', 'tests', 'fixtures')

const SAMPLE_RATE = 48000
const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-video-audio-'))

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

function readFloatWav(path) {
  const buffer = readFileSync(path)
  let offset = 12
  let channels = 0
  let sampleRate = 0
  let data = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10)
      sampleRate = buffer.readUInt32LE(offset + 12)
    } else if (id === 'data') {
      data = buffer.subarray(offset + 8, offset + 8 + size)
    }
    offset += 8 + size + (size % 2)
  }
  const samples = new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length))
  return { channels, sampleRate, frames: samples.length / channels, samples }
}

let runs = 0
function runEngine(script) {
  runs++
  const scriptPath = join(workDir, `script-${runs}.json`)
  const outPath = join(workDir, `out-${runs}.wav`)
  writeFileSync(scriptPath, JSON.stringify(script))
  const stdout = execFileSync(binary, ['--offline-render', scriptPath, '--out', outPath, '--backend', 'offline'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  })
  const summary = JSON.parse(stdout.trim().split('\n').pop())
  return { summary, wav: readFloatWav(outPath) }
}

/** FFmpeg's sine source is an eighth of full scale, and the stereo pair is spread at the pan law. */
const AUDIBLE = 0.05

const START = { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null }

/** Rising zero crossings of channel 0 over the first half second: twice the tone's frequency in Hz / 2. */
function crossingsInHalfSecond(wav) {
  let crossings = 0
  for (let frame = 1; frame < Math.min(wav.frames, SAMPLE_RATE / 2); frame++) {
    if (wav.samples[(frame - 1) * wav.channels] <= 0 && wav.samples[frame * wav.channels] > 0) crossings++
  }
  return crossings
}

function peakOf(wav) {
  let peak = 0
  for (let i = 0; i < wav.samples.length; i++) peak = Math.max(peak, Math.abs(wav.samples[i]))
  return peak
}

function prepareAndPlay(file, frames) {
  return runEngine({
    sampleRate: SAMPLE_RATE,
    channels: 2,
    blockFrames: 512,
    stopWhenIdle: false,
    frames,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'video', filePath: file },
      { atMs: 0, verb: 'start', cueId: 'video', whenMs: 0, options: START }
    ]
  })
}

try {
  console.log('\nan MP4 video\'s AAC track')
  {
    const file = join(fixtures, 'video-tone.mp4')
    check('the MP4 fixture is present', existsSync(file), file)
    const { summary, wav } = prepareAndPlay(file, SAMPLE_RATE)
    const prepared = summary.results[0].reply.result
    check('it is read as the MP4 container it is', prepared?.format === 'm4a' && prepared.sampleRate === SAMPLE_RATE && prepared.channels === 2, JSON.stringify(prepared))
    check('its length is the video\'s', Math.abs((prepared?.durationMs ?? 0) - 2000) < 30, `${prepared?.durationMs} ms`)
    check('its sound is audible', peakOf(wav) > AUDIBLE, `peak ${peakOf(wav).toFixed(4)}`)
    const crossings = crossingsInHalfSecond(wav)
    check('its sound is the 440 Hz tone that was encoded', Math.abs(crossings - 220) <= 12, `${crossings} rising crossings`)
    check('no decode errors', summary.events.filter(event => event.type === 'error').length === 0)
  }

  console.log('\na WebM video\'s Opus track')
  {
    const file = join(fixtures, 'video-tone.webm')
    check('the WebM fixture is present', existsSync(file), file)
    const { summary, wav } = prepareAndPlay(file, SAMPLE_RATE)
    const reply = summary.results[0].reply
    const prepared = reply.result
    check('it is read from its own Matroska headers', prepared?.format === 'matroska' && prepared.sampleRate === SAMPLE_RATE && prepared.channels === 2, JSON.stringify(reply))
    check('its length is the segment\'s duration', Math.abs((prepared?.durationMs ?? 0) - 1008) < 30, `${prepared?.durationMs} ms`)
    check('its sound is audible', peakOf(wav) > AUDIBLE, `peak ${peakOf(wav).toFixed(4)}`)
    const crossings = crossingsInHalfSecond(wav)
    check('its sound is the 660 Hz tone that was encoded', Math.abs(crossings - 330) <= 15, `${crossings} rising crossings`)
  }

  console.log('\na video with no sound')
  {
    const file = join(fixtures, 'video-silent.mp4')
    const { summary } = runEngine({
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: 4800,
      commands: [
        { atMs: 0, verb: 'prepare', cueId: 'silent', filePath: file },
        { atMs: 0, verb: 'probe', filePath: file }
      ]
    })
    const prepare = summary.results[0].reply
    check('prepare refuses it as a video with no sound, not as unreadable', prepare.ok === false && prepare.error?.code === 'no-audio', JSON.stringify(prepare))
    check('and says so in words', /no sound track/.test(prepare.error?.message ?? ''), prepare.error?.message)
    const probe = summary.results[1].reply
    check('a probe says the same', probe.ok === false && probe.error?.code === 'no-audio', JSON.stringify(probe))
  }

  console.log('\na file that only starts like Matroska')
  {
    const file = join(workDir, 'not-really.mkv')
    // The EBML magic, then a header size that runs past the end of the file.
    writeFileSync(file, Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x88, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), Buffer.alloc(24, 0x42)]))
    const { summary } = runEngine({
      sampleRate: SAMPLE_RATE,
      channels: 2,
      blockFrames: 512,
      stopWhenIdle: false,
      frames: 4800,
      commands: [{ atMs: 0, verb: 'prepare', cueId: 'broken', filePath: file }]
    })
    const reply = summary.results[0].reply
    check('it is refused as unreadable', reply.ok === false && reply.error?.code === 'decode', JSON.stringify(reply))
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
