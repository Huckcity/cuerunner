#!/usr/bin/env node
/**
 * Output patches and the mixer's faders, read off the engine's real output in offline mode:
 * a voice played through a patch lands on the device outputs the patch maps its channels to,
 * at the patch's fader; each output has a fader of its own; the meters read each patch and
 * each output after their faders; and a patch taken away under a playing voice leaves it on
 * the device's own outputs rather than silent.
 *
 *   node native/audio/tests/patches.mjs [--binary path]
 */
import { join } from 'node:path'
import { checker, render, reply, START, writeFloatWav } from './offline-kit.mjs'

const { workDir, check, finish } = checker('patches')
const RATE = 48000
// Left 0.5, right 0.25: which channel went where is read off the level.
const dcPath = join(workDir, 'dc.wav')
writeFloatWav(dcPath, 2, RATE, RATE * 4, channel => (channel === 0 ? 0.5 : 0.25))

const near = (a, b, tolerance = 1e-5) => Math.abs(a - b) <= tolerance
const level = (wav, ms, channel) => wav.samples[Math.round(ms * RATE / 1000) * wav.channels + channel]
const outputs = (wav, ms) => Array.from({ length: wav.channels }, (_, c) => Number(level(wav, ms, c).toFixed(5)))

{
  console.log('\na voice through a patch lands where the patch maps it, at the patch\'s level')
  const { summary, wav } = render(workDir, {
    channels: 4,
    frames: RATE * 2,
    commands: [
      { atMs: 0, verb: 'patch', slot: 0, outputs: [2, 3], gain: 1 },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, patch: 0 } },
      { atMs: 500, verb: 'patch', slot: 0, outputs: [2, 3], gain: 0.5 },
      { atMs: 800, verb: 'meters' },
      { atMs: 1000, verb: 'outputGains', gains: [1, 1, 0, 1] },
      { atMs: 1300, verb: 'meters' }
    ]
  })
  check('the patch is defined', reply(summary, 0).ok === true && reply(summary, 0).result.applied === true, JSON.stringify(reply(summary, 0)))
  check('patch channel 1 is device output 3, channel 2 output 4; outputs 1 and 2 hear nothing',
    JSON.stringify(outputs(wav, 300)) === JSON.stringify([0, 0, 0.5, 0.25]), JSON.stringify(outputs(wav, 300)))
  check('the patch\'s fader halves it', JSON.stringify(outputs(wav, 700)) === JSON.stringify([0, 0, 0.25, 0.125]),
    JSON.stringify(outputs(wav, 700)))
  const meters = reply(summary, 4).result
  const bus = meters.buses.find(entry => entry.slot === 0)
  check('the patch\'s meter reads its channels after its fader', bus && near(bus.peaks[0], 0.25) && near(bus.peaks[1], 0.125),
    JSON.stringify(meters.buses))
  check('the output meters read the outputs', near(meters.peaks[2], 0.25) && near(meters.peaks[3], 0.125) && meters.peaks[0] === 0)
  check('an output\'s own fader takes it down', JSON.stringify(outputs(wav, 1200)) === JSON.stringify([0, 0, 0, 0.125]),
    JSON.stringify(outputs(wav, 1200)))
  const after = reply(summary, 6).result
  check('and its meter with it, while the patch still reads what it sends', after.peaks[2] === 0 &&
    near(after.buses.find(entry => entry.slot === 0).peaks[0], 0.25), JSON.stringify(after))
}

{
  console.log('\na matrix through a patch addresses the patch\'s channels; two patches on one output add up')
  const { wav } = render(workDir, {
    channels: 4,
    frames: RATE,
    commands: [
      { atMs: 0, verb: 'patch', slot: 3, outputs: [0, 1], gain: 1 },
      { atMs: 0, verb: 'patch', slot: 4, outputs: [1], gain: 1 },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'prepare', cueId: 'b', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, patch: 3, outputs: [{ inputChannel: 0, outputChannel: 1, gain: 1 }] } },
      { atMs: 0, verb: 'start', cueId: 'b', options: { ...START, patch: 4, outputs: [{ inputChannel: 1, outputChannel: 0, gain: 1 }] } }
    ]
  })
  check('patch 3\'s second channel is output 2, and patch 4\'s only channel is output 2 too: they sum',
    JSON.stringify(outputs(wav, 300)) === JSON.stringify([0, 0.75, 0, 0]), JSON.stringify(outputs(wav, 300)))
}

{
  console.log('\na patch taken away under a playing voice leaves it on the device\'s own outputs')
  const { wav } = render(workDir, {
    channels: 4,
    frames: RATE,
    commands: [
      { atMs: 0, verb: 'patch', slot: 1, outputs: [2, 3], gain: 1 },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, patch: 1 } },
      { atMs: 400, verb: 'patch', slot: 1, outputs: null }
    ]
  })
  check('on the patch first', JSON.stringify(outputs(wav, 200)) === JSON.stringify([0, 0, 0.5, 0.25]))
  check('then on outputs 1 and 2, still heard', JSON.stringify(outputs(wav, 600)) === JSON.stringify([0.5, 0.25, 0, 0]),
    JSON.stringify(outputs(wav, 600)))
}

{
  console.log('\na show with no patches plays as it always has')
  const { wav } = render(workDir, {
    channels: 2,
    frames: RATE / 2,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: START }
    ]
  })
  check('the voice is on outputs 1 and 2', JSON.stringify(outputs(wav, 100)) === JSON.stringify([0.5, 0.25]))
}

{
  console.log('\nwhat a patch refuses')
  const { summary } = render(workDir, {
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'patch', slot: 16, outputs: [0] },
      { atMs: 0, verb: 'patch', slot: 0, outputs: [0], gain: -1 },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, patch: 99 } },
      { atMs: 0, verb: 'outputGains', gains: [1, 'loud'] }
    ]
  })
  check('a slot past the last', reply(summary, 0).ok === false && /patch slot/.test(reply(summary, 0).error.message))
  check('a negative level', reply(summary, 1).ok === false)
  check('a start through a patch that cannot exist', reply(summary, 3).ok === false && /no output patch/.test(reply(summary, 3).error.message),
    JSON.stringify(reply(summary, 3)))
  check('an output level that is not a number', reply(summary, 4).ok === false)
}

finish()
