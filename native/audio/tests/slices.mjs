#!/usr/bin/env node
/**
 * Slices, read off the engine's real output in offline mode: a file cut into regions that
 * each play a number of times — or until released, a vamp — in order, with every boundary
 * landing on its sample. The file's every sample says which frame of it it is, so the output
 * says exactly which part of the file was playing at each frame.
 *
 *   node native/audio/tests/slices.mjs [--binary path]
 */
import { join } from 'node:path'
import { checker, render, reply, START, writeFloatWav } from './offline-kit.mjs'

const { workDir, check, finish } = checker('slices')
const RATE = 48000
const rampPath = join(workDir, 'ramp.wav')
writeFloatWav(rampPath, 2, RATE, RATE * 4, (_, frame) => frame / 480000)

/** The source frame each output frame played, read back from the ramp. */
const sourceAt = (wav, frame) => Math.round(wav.samples[frame * wav.channels] * 480000)
/** Whether every output frame in [from, to) played `source(t)`. */
function plays(wav, from, to, source) {
  for (let t = from; t < to; t++) {
    if (sourceAt(wav, t) !== source(t)) return `frame ${t} played ${sourceAt(wav, t)}, not ${source(t)}`
  }
  return ''
}

const SLICES = [
  { startTime: 0, endTime: 500, playCount: 2 },
  { startTime: 500, endTime: 1000, playCount: -1 },
  { startTime: 1000, endTime: 1500, playCount: 1 }
]
const HALF = RATE / 2 // one slice: 500 ms

{
  console.log('\nslices play in order, each its count of times; a release moves the vamp on at its boundary')
  const { summary, wav } = render(workDir, {
    frames: RATE * 4,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, slices: SLICES } },
      { atMs: 2300, verb: 'release', cueId: 'a' }
    ]
  })
  check('the start is taken', reply(summary, 1).ok === true, JSON.stringify(reply(summary, 1)))
  let detail = plays(wav, 0, HALF, t => t)
  check('slice 1, first pass', detail === '', detail)
  detail = plays(wav, HALF, 2 * HALF, t => t - HALF)
  check('slice 1 again: its count is two', detail === '', detail)
  detail = plays(wav, 2 * HALF, 5 * HALF, t => HALF + ((t - 2 * HALF) % HALF))
  check('slice 2 vamps: three passes before the release', detail === '', detail)
  check('the release is applied', reply(summary, 2).ok === true && reply(summary, 2).result.applied === true)
  // Released at 2.3 s, in the pass that runs [96000, 120000): that pass finishes.
  detail = plays(wav, 4 * HALF, 5 * HALF, t => HALF + (t - 4 * HALF))
  check('the pass the release landed in plays to its end', detail === '', detail)
  detail = plays(wav, 5 * HALF, 6 * HALF, t => 2 * HALF + (t - 5 * HALF))
  check('then slice 3, from its first sample: the boundary is sample-accurate', detail === '', detail)
  const ended = summary.events.find(event => event.type === 'ended' && event.cueId === 'a')
  check('the cue ends complete at the end of the last slice', ended?.reason === 'complete' && Math.abs(ended.at - 3000) < 0.05,
    JSON.stringify(ended))
  check('silent after it', Math.abs(wav.samples[(6 * HALF + 10) * 2]) === 0)
}

{
  console.log('\na release that stops at the end of the slice')
  const { summary, wav } = render(workDir, {
    frames: RATE * 4,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, slices: SLICES } },
      { atMs: 2300, verb: 'release', cueId: 'a', stopAtSliceEnd: true }
    ]
  })
  const ended = summary.events.find(event => event.type === 'ended' && event.cueId === 'a')
  check('ends where the pass ends, at 2.5 s', ended?.reason === 'complete' && Math.abs(ended.at - 2500) < 0.05, JSON.stringify(ended))
  const detail = plays(wav, 4 * HALF, 5 * HALF, t => HALF + (t - 4 * HALF))
  check('the pass plays to its end first', detail === '', detail)
  check('nothing of slice 3 is heard', wav.samples[(5 * HALF + 10) * 2] === 0)
  void reply
}

{
  console.log('\na start inside a later slice starts there')
  const { wav } = render(workDir, {
    frames: RATE * 2,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, startTime: 750, slices: SLICES } }
    ]
  })
  const detail = plays(wav, 0, HALF / 2, t => 36000 + t)
  check('it plays from 750 ms', detail === '', detail)
  const wrap = plays(wav, HALF / 2, HALF / 2 + 100, t => HALF + (t - HALF / 2))
  check('and wraps to the start of the slice it is in, which vamps', wrap === '', wrap)
}

{
  console.log('\na seek into a later slice plays on from that slice — a Control cue\'s load')
  const { wav } = render(workDir, {
    frames: RATE * 3,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, slices: SLICES } },
      // Into slice 3 (1000–1500 ms) from the first pass of slice 1.
      { atMs: 200, verb: 'seek', cueId: 'a', positionMs: 1200 }
    ]
  })
  // A seek lands at the top of the block it arrives in: find where the file jumped to 1.2 s.
  let seekFrame = -1
  for (let t = 0; t < 0.3 * RATE; t++) if (sourceAt(wav, t) === 1.2 * RATE) { seekFrame = t; break }
  check('the seek lands within a block of when it was sent', seekFrame > 0.2 * RATE - 512 && seekFrame <= 0.2 * RATE,
    `at frame ${seekFrame}`)
  const detail = plays(wav, seekFrame, seekFrame + 0.3 * RATE, t => 1.2 * RATE + (t - seekFrame))
  check('it plays from 1.2 s in slice 3, not held to slice 1', detail === '', detail)
}

{
  console.log('\na plain loop asked to stop at the end of its pass')
  const { summary } = render(workDir, {
    frames: RATE * 4,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, endTime: 500, loopCount: -1 } },
      { atMs: 1200, verb: 'release', cueId: 'a', stopAtSliceEnd: true }
    ]
  })
  const ended = summary.events.find(event => event.type === 'ended' && event.cueId === 'a')
  check('it ends at the end of the pass it was in (1.5 s)', ended?.reason === 'complete' && Math.abs(ended.at - 1500) < 0.05,
    JSON.stringify(ended))
}

{
  console.log('\na vamp without slices still releases the way it always has')
  const { wav } = render(workDir, {
    frames: RATE * 3,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, startTime: 0, endTime: 500, loopCount: -1 } },
      { atMs: 1200, verb: 'release', cueId: 'a' }
    ]
  })
  // Released at 1.2 s — 9600 frames into the third pass — and played straight on past the loop.
  const detail = plays(wav, 2 * HALF, 3 * HALF + 2000, t => t - 2 * HALF)
  check('the release plays on from where the loop was, past its end', detail === '', detail)
}

{
  console.log('\nwhat slices refuse')
  const { summary } = render(workDir, {
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, slices: [{ startTime: 500, endTime: 400, playCount: 1 }] } },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, slices: [{ startTime: 0, endTime: 400, playCount: 0 }] } },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, slices: [{ startTime: 400, endTime: 500 }, { startTime: 0, endTime: 100 }] } }
    ]
  })
  check('a slice that ends before it starts', reply(summary, 1).ok === false && /must end after it starts/.test(reply(summary, 1).error.message),
    JSON.stringify(reply(summary, 1)))
  check('a slice that plays no times', reply(summary, 2).ok === false && /plays once or more/.test(reply(summary, 2).error.message))
  check('slices out of order', reply(summary, 3).ok === false && /order/.test(reply(summary, 3).error.message))
}

finish()
