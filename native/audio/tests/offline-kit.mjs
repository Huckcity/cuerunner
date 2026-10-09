/**
 * What the offline-render tests of live inputs, slices, fade shapes, patches and loudness
 * share: the binary, a checker that counts, float WAV in and out, and one call that renders
 * a script and hands back the summary and the samples. Not a test of its own.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const defaultBinary = join(repoRoot, 'native', 'audio', 'build', `cuerunner-audio${process.platform === 'win32' ? '.exe' : ''}`)
const binaryIndex = process.argv.indexOf('--binary')
export const binary = binaryIndex >= 0 ? process.argv[binaryIndex + 1] : process.env.CUERUNNER_AUDIO_BIN ?? defaultBinary

/** A checker for one script: `check` counts, `finish` prints the tally and sets the exit code. */
export function checker(title) {
  let failures = 0
  let checks = 0
  // Named for the branch, so a sibling's run on the same machine never shares a directory.
  const workDir = mkdtempSync(join(tmpdir(), `cuerunner-audio-io-${title}-`))
  console.log(`cuerunner-audio ${title} — binary ${binary}`)
  return {
    workDir,
    check(name, condition, detail = '') {
      checks++
      if (condition) {
        console.log(`  ok   ${name}`)
        return
      }
      failures++
      console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    },
    finish() {
      rmSync(workDir, { recursive: true, force: true })
      console.log(`\n${checks - failures}/${checks} checks passed`)
      process.exitCode = failures === 0 ? 0 : 1
    }
  }
}

export function writeFloatWav(path, channels, sampleRate, frames, sampleAt) {
  const dataBytes = frames * channels * 4
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(3, 20); buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * channels * 4, 28)
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

export function readFloatWav(path) {
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
  const samples = new Float32Array(buffer.buffer.slice(buffer.byteOffset + dataOffset, buffer.byteOffset + dataOffset + frames * channels * 4))
  return { channels, frames, samples }
}

/**
 * Renders `script` offline; the summary the engine printed and the output's samples — and,
 * for each test output device named in `devices`, what that device played (its tee, written
 * beside the render's own WAV).
 */
export function render(workDir, script, { keepWav = true, devices = [] } = {}) {
  const tag = Math.floor(Math.random() * 1e9)
  const scriptPath = join(workDir, `script-${tag}.json`)
  const outPath = join(workDir, `out-${tag}.wav`)
  writeFileSync(scriptPath, JSON.stringify({ sampleRate: 48000, channels: 2, blockFrames: 512, stopWhenIdle: false, ...script }))
  const stdout = execFileSync(binary, ['--offline-render', scriptPath, '--out', outPath, '--backend', 'offline'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const summary = JSON.parse(stdout.trim().split('\n').pop())
  const wav = keepWav ? readFloatWav(outPath) : null
  rmSync(outPath, { force: true })
  rmSync(scriptPath, { force: true })
  const played = {}
  for (const device of devices) {
    const teePath = join(workDir, `out-${tag}.${device.replace(/[^A-Za-z0-9]/g, '-')}.wav`)
    try {
      played[device] = readFloatWav(teePath)
    } catch {
      played[device] = null
    }
    rmSync(teePath, { force: true })
  }
  return { summary, wav, devices: played }
}

/** The reply to the command at `index` in the script, as the offline runner kept it. */
export const reply = (summary, index) => summary.results[index].reply

/** A start's options with nothing asked for. */
export const START = {
  startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null
}
