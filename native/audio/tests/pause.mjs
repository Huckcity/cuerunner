#!/usr/bin/env node
/**
 * Pause and resume, read off the engine's real output in offline mode: a held voice is
 * silent and does not move through its file, it comes back where it stopped, and every
 * frame-stamped thing about it — a fade under way, a stop scheduled for later, a start not
 * yet reached — waits with it. A stop of a held voice ends it at once.
 *
 *   node native/audio/tests/pause.mjs [--binary path]
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

const SAMPLE_RATE = 48000
/** The hold edge the mixer takes a voice down and back up over: 8 ms. */
const EDGE = 384
const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-parity-sweep-pause-'))
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

function writeFloatWav(path, channels, frames, sampleAt) {
  const dataBytes = frames * channels * 4
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(3, 20); buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(SAMPLE_RATE, 24); buffer.writeUInt32LE(SAMPLE_RATE * channels * 4, 28)
  buffer.writeUInt16LE(channels * 4, 32); buffer.writeUInt16LE(32, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
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
  let offset = 12
  let channels = 0
  let dataOffset = 0
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'fmt ') channels = buffer.readUInt16LE(offset + 10)
    else if (id === 'data') { dataOffset = offset + 8; dataBytes = Math.min(size, buffer.length - dataOffset) }
    offset += 8 + size + (size % 2)
  }
  const frames = Math.floor(dataBytes / (channels * 4))
  const samples = new Float32Array(frames * channels)
  for (let i = 0; i < samples.length; i++) samples[i] = buffer.readFloatLE(dataOffset + i * 4)
  return { channels, frames, samples }
}

function runEngine(script) {
  const scriptPath = join(workDir, `script-${Math.floor(Math.random() * 1e9)}.json`)
  const outPath = join(workDir, `out-${Math.floor(Math.random() * 1e9)}.wav`)
  writeFileSync(scriptPath, JSON.stringify({ sampleRate: SAMPLE_RATE, channels: 2, blockFrames: 512, stopWhenIdle: false, ...script }))
  const stdout = execFileSync(binary, ['--offline-render', scriptPath, '--out', outPath, '--backend', 'offline'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return { summary: JSON.parse(stdout.trim().split('\n').pop()), wav: readFloatWav(outPath) }
}

const at = (wav, frame) => wav.samples[frame * wav.channels]
const near = (a, b, tolerance = 2e-5) => Math.abs(a - b) <= tolerance
const reply = (summary, index) => summary.results[index].reply

const START = { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null }

// Four seconds whose every sample says where in the file it came from: frame / 480000.
const rampPath = join(workDir, 'ramp.wav')
writeFloatWav(rampPath, 2, SAMPLE_RATE * 4, (_, frame) => frame / 480000)
const dcPath = join(workDir, 'dc.wav')
writeFloatWav(dcPath, 2, SAMPLE_RATE * 2, () => 0.5)

console.log(`cuerunner-audio pause — binary ${binary}`)

{
  console.log('\na held voice is silent, does not move, and comes back where it stopped')
  const { summary, wav } = runEngine({
    frames: 30000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: START },
      { atMs: 100, verb: 'pause', cueId: 'a' },
      { atMs: 300, verb: 'resume', cueId: 'a' }
    ]
  })
  check('the pause is applied', reply(summary, 2).ok === true && reply(summary, 2).result.applied === true, JSON.stringify(reply(summary, 2)))
  check('the resume is applied', reply(summary, 3).ok === true && reply(summary, 3).result.applied === true)
  check('plays its file up to the pause', near(at(wav, 4799), 4799 / 480000))
  check('half-way down the hold edge it is half as loud', near(at(wav, 4800 + EDGE / 2), (4800 + EDGE / 2) / 480000 * 0.5, 1e-4),
    `${at(wav, 4800 + EDGE / 2)}`)
  check('silent once held', Math.abs(at(wav, 5184)) < 1e-7 && Math.abs(at(wav, 10000)) < 1e-7 && Math.abs(at(wav, 14399)) < 1e-7)
  // Held from frame 5184; let go at 14400, back to full over the edge by 14784. The file
  // picks up at the frame it was held on, not 9216 frames further on.
  const back = 14784 + 100
  const expected = (5184 + (back - 14400)) / 480000
  check('after the resume the file goes on from where it was held', near(at(wav, back), expected), `${at(wav, back)} vs ${expected}`)
  check('no ended event: a held voice is still playing', summary.events.every(event => event.type !== 'ended'))
}

{
  console.log('\na fade under way waits with the voice')
  const { wav } = runEngine({
    frames: 40000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: START },
      // A 200 ms fade to silence, from 100 ms; the voice is held at 200 ms, half way down.
      { atMs: 100, verb: 'fade', cueId: 'a', param: 'volume', value: 0, durationMs: 200, curve: 'linear' },
      { atMs: 200, verb: 'pause', cueId: 'a' },
      { atMs: 500, verb: 'resume', cueId: 'a' }
    ]
  })
  check('half way down when held', near(at(wav, 9599), 0.5 * (1 - (9599 - 4800) / 9600), 1e-4))
  // Held at 9984 (200 ms + the edge), let go at 24000: the fade's remaining 92 ms are after
  // that, shifted by the 14016 frames it was held for.
  const levelAt = (frame) => 0.5 * (1 - (frame - 14016 - 4800) / 9600)
  check('the fade goes on from its half-way point after the resume', near(at(wav, 26000), levelAt(26000), 1e-4),
    `${at(wav, 26000)} vs ${levelAt(26000)}`)
  check('and reaches silence the held time later', Math.abs(at(wav, 14400 + 14016 + 200)) < 1e-6)
}

{
  console.log('\na start not yet reached waits with the hold')
  const { wav } = runEngine({
    frames: 30000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 200, options: START },
      { atMs: 100, verb: 'pause', cueId: 'a' },
      { atMs: 300, verb: 'resume', cueId: 'a' }
    ]
  })
  check('silent where it would have started', Math.abs(at(wav, 9700)) < 1e-7)
  check('starts the held time later', Math.abs(at(wav, 19199)) < 1e-7 && near(at(wav, 19300), 0.5, 1e-3), `${at(wav, 19300)}`)
}

{
  console.log('\na stop of a held voice ends it at once')
  const { summary, wav } = runEngine({
    frames: 20000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: START },
      { atMs: 100, verb: 'pause', cueId: 'a' },
      { atMs: 200, verb: 'stop', cueId: 'a', fadeMs: 500 },
      { atMs: 250, verb: 'resume', cueId: 'a' }
    ]
  })
  const ended = summary.events.filter(event => event.type === 'ended')
  check('it ended as stopped', ended.length === 1 && ended[0].reason === 'stopped', JSON.stringify(ended))
  check('it ended at the stop, not after a fade that could not move', ended.length === 1 && ended[0].at >= 180 && ended[0].at <= 201, JSON.stringify(ended))
  check('the resume after it finds nothing to let go', reply(summary, 4).result.applied === false)
  check('and nothing sounds again', Math.abs(at(wav, 15000)) < 1e-7)
}

{
  console.log('\nwhat there is nothing to do for')
  const { summary } = runEngine({
    frames: 12000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: START },
      { atMs: 50, verb: 'resume', cueId: 'a' },
      { atMs: 60, verb: 'pause', cueId: 'a' },
      { atMs: 70, verb: 'pause', cueId: 'a' },
      { atMs: 80, verb: 'pause', cueId: 'nobody' }
    ]
  })
  check('a resume of a voice that is not held changes nothing', reply(summary, 2).result.applied === false)
  check('the first pause applies', reply(summary, 3).result.applied === true)
  check('a second pause of a held voice changes nothing', reply(summary, 4).result.applied === false)
  check('a pause of a cue with nothing playing changes nothing', reply(summary, 5).result.applied === false)
}

rmSync(workDir, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
