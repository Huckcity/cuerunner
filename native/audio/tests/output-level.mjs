#!/usr/bin/env node
/**
 * The engine's master level and its meter, read off the real output in offline mode: the level
 * scales everything that leaves the engine, a change is ramped across a block rather than
 * stepped, and the meter reports each channel's peak after it.
 *
 *   node native/audio/tests/output-level.mjs [--binary path]
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
const BLOCK = 512
const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-parity-sweep-output-level-'))
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

function writeFloatWav(path, frames, left, right) {
  const channels = 2
  const dataBytes = frames * channels * 4
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(3, 20); buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(SAMPLE_RATE, 24); buffer.writeUInt32LE(SAMPLE_RATE * channels * 4, 28)
  buffer.writeUInt16LE(channels * 4, 32); buffer.writeUInt16LE(32, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  let offset = 44
  for (let frame = 0; frame < frames; frame++) {
    buffer.writeFloatLE(left, offset); offset += 4
    buffer.writeFloatLE(right, offset); offset += 4
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
  writeFileSync(scriptPath, JSON.stringify({ sampleRate: SAMPLE_RATE, channels: 2, blockFrames: BLOCK, stopWhenIdle: false, ...script }))
  const stdout = execFileSync(binary, ['--offline-render', scriptPath, '--out', outPath, '--backend', 'offline'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return { summary: JSON.parse(stdout.trim().split('\n').pop()), wav: readFloatWav(outPath) }
}

const at = (wav, frame, channel = 0) => wav.samples[frame * wav.channels + channel]
const near = (a, b, tolerance = 1e-5) => Math.abs(a - b) <= tolerance
const reply = (summary, index) => summary.results[index].reply

const START = { startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null }
const dcPath = join(workDir, 'dc.wav')
writeFloatWav(dcPath, SAMPLE_RATE * 2, 0.5, -0.25)

console.log(`cuerunner-audio output level — binary ${binary}`)

{
  console.log('\nthe master level scales everything that leaves the engine, ramped over a block')
  const { summary, wav } = runEngine({
    frames: 20000,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', whenMs: 0, options: START },
      { atMs: 100, verb: 'master', gain: 0.5 },
      { atMs: 200, verb: 'meters' },
      { atMs: 250, verb: 'master', gain: 9 },
      { atMs: 300, verb: 'meters' }
    ]
  })
  check('the level is applied', reply(summary, 2).ok === true && reply(summary, 2).result.applied === true, JSON.stringify(reply(summary, 2)))
  check('full level before it', near(at(wav, 4000), 0.5))
  // Applied at the block boundary the command lands in, and ramped across that block.
  const blockStart = Math.floor(4800 / BLOCK) * BLOCK
  check('ramped rather than stepped: half-way across its block it is half-way down',
    near(at(wav, blockStart + BLOCK / 2 - 1), 0.5 * (1 - 0.5 * (BLOCK / 2) / BLOCK), 1e-3), `${at(wav, blockStart + BLOCK / 2 - 1)}`)
  check('at half level once the block is over', near(at(wav, blockStart + BLOCK + 10), 0.25) && near(at(wav, 9000, 1), -0.125))
  const meters = reply(summary, 3).result
  check('the meter reads each channel after the master', meters.peaks.length === 2 && near(meters.peaks[0], 0.25) && near(meters.peaks[1], 0.125),
    JSON.stringify(meters))
  check('and says the level it is at', near(meters.master, 0.5))
  check('a level past +6 dB is held at +6 dB', near(reply(summary, 5).result.master, 2) && near(at(wav, 14000), 1.0), `${at(wav, 14000)}`)
}

{
  console.log('\nthe meter reads silence as silence')
  const { summary } = runEngine({ frames: 6000, commands: [{ atMs: 50, verb: 'meters' }] })
  const meters = reply(summary, 0).result
  check('every channel at zero with nothing playing', meters.peaks.every(peak => peak === 0), JSON.stringify(meters))
  check('at unity before anything sets it', near(meters.master, 1))
}

{
  console.log('\na level the engine cannot take is refused')
  const { summary } = runEngine({ frames: 2000, commands: [{ atMs: 0, verb: 'master', gain: -1 }] })
  check('a negative level is refused with a reason', reply(summary, 0).ok === false, JSON.stringify(reply(summary, 0)))
}

rmSync(workDir, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
