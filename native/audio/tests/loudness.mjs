#!/usr/bin/env node
/**
 * The engine's loudness meter against reference signals whose answers are known, the way
 * EBU Tech 3341 checks a meter: a 1 kHz sine at −23 dBFS in both channels reads −23.0 LUFS;
 * the same sine in one channel of two reads 3 LU less; silence after it changes nothing (the
 * absolute gate); a quiet passage more than 10 LU under the programme is left out (the
 * relative gate); and a sine whose samples all miss its crests reads its true peak, not its
 * sample peak.
 *
 *   node native/audio/tests/loudness.mjs [--binary path]
 */
import { join } from 'node:path'
import { checker, render, reply, writeFloatWav } from './offline-kit.mjs'

const { workDir, check, finish } = checker('loudness')
const dbfs = db => Math.pow(10, db / 20)

/** A sine of `hz` at `levelDb` peak, for `seconds`, on the channels `on` says. */
function sineFile(name, { rate = 48000, channels = 2, hz = 1000, levelDb, seconds = 20, phase = 0, on = () => true, levelAt }) {
  const path = join(workDir, name)
  writeFloatWav(path, channels, rate, Math.round(rate * seconds), (channel, frame) => {
    const level = levelAt ? levelAt(frame / rate) : levelDb
    if (level === null || !on(channel)) return 0
    return dbfs(level) * Math.sin(2 * Math.PI * hz * frame / rate + phase)
  })
  return path
}

function measure(paths) {
  const { summary } = render(workDir, {
    frames: 512,
    commands: paths.map(filePath => ({ atMs: 0, verb: 'loudness', filePath }))
  }, { keepWav: false })
  return paths.map((_, index) => reply(summary, index))
}

const files = [
  sineFile('stereo-23.wav', { levelDb: -23 }),
  sineFile('left-only-23.wav', { levelDb: -23, on: channel => channel === 0 }),
  sineFile('stereo-23-44k.wav', { levelDb: -23, rate: 44100 }),
  sineFile('then-silence.wav', { levelAt: t => (t < 10 ? -23 : null) }),
  sineFile('then-quiet.wav', { levelAt: t => (t < 10 ? -23 : -45) }),
  // A quarter of the sample rate at 45°: every sample lands half way up a crest.
  sineFile('fs4-half.wav', { hz: 12000, levelDb: -6.0206, phase: Math.PI / 4, seconds: 2 }),
  sineFile('fs4-full.wav', { hz: 12000, levelDb: 0, phase: Math.PI / 4, seconds: 2 }),
  sineFile('silent.wav', { levelDb: null, seconds: 2 }),
  join(workDir, 'not-there.wav')
]
const [stereo, leftOnly, at44, thenSilence, thenQuiet, fs4Half, fs4Full, silent, missing] = measure(files)

console.log('\nintegrated loudness')
const lufs = answer => answer.result.integratedLufs
check('a 1 kHz sine at −23 dBFS in both channels reads −23.0 LUFS (±0.1)', stereo.ok && Math.abs(lufs(stereo) + 23) <= 0.1,
  JSON.stringify(stereo))
check('the same sine in one channel reads −26.0 LUFS (±0.1)', Math.abs(lufs(leftOnly) + 26.01) <= 0.1, `${lufs(leftOnly)}`)
check('the same at 44.1 kHz reads the same', Math.abs(lufs(at44) + 23) <= 0.1, `${lufs(at44)}`)
check('ten seconds of silence after it change nothing: the absolute gate', Math.abs(lufs(thenSilence) + 23) <= 0.1,
  `${lufs(thenSilence)}`)
check('ten seconds 22 LU quieter are left out: the relative gate', Math.abs(lufs(thenQuiet) + 23) <= 0.15, `${lufs(thenQuiet)}`)
check('a silent file says it is silent', silent.ok && silent.result.silent === true, JSON.stringify(silent))
check('a loud file does not', stereo.result.silent === false)

console.log('\npeaks')
check('the sample peak of a −23 dBFS sine is −23 dBFS', Math.abs(stereo.result.samplePeakDb + 23) < 0.01, `${stereo.result.samplePeakDb}`)
check('a quarter-rate sine at −6 dBFS whose samples miss its crests: samples read −9 dBFS',
  Math.abs(fs4Half.result.samplePeakDb + 9.03) < 0.05, `${fs4Half.result.samplePeakDb}`)
check('and its true peak reads −6 dBTP (±0.2)', Math.abs(fs4Half.result.truePeakDb + 6.02) <= 0.2, `${fs4Half.result.truePeakDb}`)
check('a full-scale one whose samples never pass −3 dBFS reads 0 dBTP (±0.2): an inter-sample over',
  Math.abs(fs4Full.result.truePeakDb) <= 0.2 && fs4Full.result.samplePeakDb < -2.9, JSON.stringify(fs4Full.result))
check('the measurement says what it measured', stereo.result.sampleRate === 48000 && stereo.result.channels === 2 &&
  Math.abs(stereo.result.durationMs - 20000) < 1)

console.log('\nwhat it refuses')
check('a file that is not there', missing.ok === false && missing.error.code === 'decode', JSON.stringify(missing))

finish()
