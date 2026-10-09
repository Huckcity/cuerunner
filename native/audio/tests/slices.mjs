#!/usr/bin/env node
/**
 * Slices, read off the engine's real output in offline mode: a file cut into regions that
 * each play a number of times — none, skipped, or until released, a vamp — in order, with
 * every boundary landing on its sample. The file's every sample says which frame of it it is, so the output
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
/** The ramp's sample for a source frame, as the file holds it. */
const rampAt = (frame) => Math.fround(frame / 480000)
/** A join's crossfade (spine AD-29, `kJoinCrossfadeMs` in plan.h): 3 ms. */
const XFADE = Math.round((3 * RATE) / 1000)
/**
 * Whether every output frame in [from, to) played `source(t)`. Where the file jumps — a wrap, a
 * skip, a seek — the landing still starts on its own frame, and the ramp's step there is made
 * over an equal-power crossfade: for its first `XFADE` frames the output is the landing under
 * the frames the file would have gone on with, from the one after the frame played before it.
 * Those frames are checked against exactly that.
 */
function plays(wav, from, to, source) {
  let fade = null
  for (let t = from; t < to; t++) {
    const want = source(t)
    if (fade === null && t > 0 && want !== sourceAt(wav, t - 1) + 1) fade = { at: t, from: sourceAt(wav, t - 1) + 1 }
    if (fade !== null && t - fade.at >= XFADE) fade = null
    if (fade === null) {
      if (sourceAt(wav, t) !== want) return `frame ${t} played ${sourceAt(wav, t)}, not ${want}`
      continue
    }
    const k = t - fade.at
    const theta = ((k + 0.5) / XFADE) * (Math.PI / 2)
    const blended = rampAt(want) * Math.sin(theta) + rampAt(fade.from + k) * Math.cos(theta)
    if (Math.abs(wav.samples[t * wav.channels] - blended) > 1e-6) {
      return `frame ${t}, ${k} into the crossfade onto ${want}, played ${wav.samples[t * wav.channels]}, not ${blended}`
    }
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
  // A seek lands at the top of the block it arrives in: find where the file stopped running on
  // from the top of slice 1 (it lands on 1.2 s there, under its crossfade).
  let seekFrame = -1
  for (let t = 0; t < 0.3 * RATE; t++) if (sourceAt(wav, t) !== t) { seekFrame = t; break }
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

/** Slices in 500 ms pieces from the top of the file, one count each. */
const pieces = (...counts) => counts.map((playCount, i) => ({ startTime: i * 500, endTime: (i + 1) * 500, playCount }))
/** One cue started at 0 with these slices (and whatever else), rendered for `seconds`. */
function sliced(slices, { seconds = 3, extra = [], options = {} } = {}) {
  return render(workDir, {
    frames: RATE * seconds,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, ...options, slices } },
      ...extra
    ]
  })
}
const endedOf = summary => summary.events.find(event => event.type === 'ended' && event.cueId === 'a')

{
  console.log('\na slice that plays no times is skipped: the one before runs into the one after, to the sample')
  const { summary, wav } = sliced(pieces(1, 0, 1))
  check('the start is taken', reply(summary, 1).ok === true, JSON.stringify(reply(summary, 1)))
  let detail = plays(wav, 0, HALF, t => t)
  check('slice 1 plays', detail === '', detail)
  detail = plays(wav, HALF, 2 * HALF, t => 2 * HALF + (t - HALF))
  check('then slice 3 from its first sample, slice 2 never heard', detail === '', detail)
  const ended = endedOf(summary)
  check('the cue ends complete after the two slices it plays (1 s)', ended?.reason === 'complete' && Math.abs(ended.at - 1000) < 0.05,
    JSON.stringify(ended))
}

{
  console.log('\nskipped slices in a row are all passed over')
  const { summary, wav } = sliced(pieces(1, 0, 0, 1))
  const detail = plays(wav, HALF, 2 * HALF, t => 3 * HALF + (t - HALF))
  check('slice 1 runs straight into slice 4', detail === '', detail)
  const ended = endedOf(summary)
  check('and the cue ends at 1 s', ended?.reason === 'complete' && Math.abs(ended.at - 1000) < 0.05, JSON.stringify(ended))
}

{
  console.log('\na skipped last slice ends the cue where it begins')
  const { summary, wav } = sliced(pieces(2, 0))
  const detail = plays(wav, 0, 2 * HALF, t => t % HALF)
  check('slice 1 plays its two passes', detail === '', detail)
  const ended = endedOf(summary)
  check('the cue ends complete at 1 s, not after the skipped slice', ended?.reason === 'complete' && Math.abs(ended.at - 1000) < 0.05,
    JSON.stringify(ended))
  check('silent after it', wav.samples[(2 * HALF + 10) * 2] === 0)
}

{
  console.log('\na devamp out of a vamp goes past the skipped slice after it')
  // Slice 2 vamps; released at 1.8 s, in the pass that runs 1.5–2 s of output.
  const { summary, wav } = sliced(pieces(1, -1, 0, 1), { seconds: 4, extra: [{ atMs: 1800, verb: 'release', cueId: 'a' }] })
  let detail = plays(wav, 3 * HALF, 4 * HALF, t => HALF + (t - 3 * HALF))
  check('the pass the release landed in plays to its end', detail === '', detail)
  detail = plays(wav, 4 * HALF, 5 * HALF, t => 3 * HALF + (t - 4 * HALF))
  check('then slice 4 from its first sample: slice 3 is skipped', detail === '', detail)
  const ended = endedOf(summary)
  check('the cue ends at 2.5 s', ended?.reason === 'complete' && Math.abs(ended.at - 2500) < 0.05, JSON.stringify(ended))
}

{
  console.log('\na skipped first slice: the cue starts in the one after it')
  const { summary, wav } = sliced(pieces(0, 1))
  const detail = plays(wav, 0, HALF, t => HALF + t)
  check('the first frame out is the first frame of slice 2', detail === '', detail)
  const ended = endedOf(summary)
  check('and the cue ends after it, at 0.5 s', ended?.reason === 'complete' && Math.abs(ended.at - 500) < 0.05, JSON.stringify(ended))
}

{
  console.log('\na start inside a skipped slice starts at the next one played')
  const { wav } = sliced(pieces(1, 0, 1), { seconds: 1, options: { startTime: 700 } })
  const detail = plays(wav, 0, HALF, t => 2 * HALF + t)
  check('it plays from 1 s, where slice 3 begins', detail === '', detail)
}

{
  console.log('\na cue whose every slice is skipped plays nothing and ends')
  const { summary, wav } = sliced(pieces(0, 0), { seconds: 1 })
  check('the start is taken', reply(summary, 1).ok === true, JSON.stringify(reply(summary, 1)))
  const ended = endedOf(summary)
  check('it ends complete at once', ended?.reason === 'complete' && ended.at < 20, JSON.stringify(ended))
  check('silent', Math.max(...Array.from(wav.samples.slice(0, HALF * 2), Math.abs)) === 0)
}

{
  console.log('\nhow many slices a start may carry')
  const many = count => Array.from({ length: count }, (_, i) => ({ startTime: i * 10, endTime: (i + 1) * 10, playCount: 1 }))
  const { summary } = render(workDir, {
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, slices: many(128) } },
      { atMs: 0, verb: 'start', cueId: 'b', options: { ...START, slices: many(129) } }
    ]
  })
  check('128 slices are taken', reply(summary, 1).ok === true, JSON.stringify(reply(summary, 1)))
  check('129 are refused, by name', reply(summary, 2).ok === false && /at most 128 slices/.test(reply(summary, 2).error.message),
    JSON.stringify(reply(summary, 2)))
}

{
  console.log('\nwhat slices refuse')
  const { summary } = render(workDir, {
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: rampPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, slices: [{ startTime: 500, endTime: 400, playCount: 1 }] } },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, slices: [{ startTime: 0, endTime: 400, playCount: -2 }] } },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, slices: [{ startTime: 400, endTime: 500 }, { startTime: 0, endTime: 100 }] } }
    ]
  })
  check('a slice that ends before it starts', reply(summary, 1).ok === false && /must end after it starts/.test(reply(summary, 1).error.message),
    JSON.stringify(reply(summary, 1)))
  check('a count below -1', reply(summary, 2).ok === false && /0 times \(skipped\) or more/.test(reply(summary, 2).error.message),
    JSON.stringify(reply(summary, 2)))
  check('slices out of order', reply(summary, 3).ok === false && /order/.test(reply(summary, 3).error.message))
}

finish()
