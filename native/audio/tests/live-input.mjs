#!/usr/bin/env node
/**
 * A live input through the engine, read off its real output in offline mode.
 *
 * The drift half: a synthetic source whose every sample is a count of the input's own frames
 * (`test:ramp`) runs on a clock that is off its stated rate — and at a different rate from the
 * output, in periods of its own size, each delivered late by a random amount — and is played
 * out through a live voice for minutes. Every output sample says which input frame it played,
 * so the latency is read back from the samples rather than taken from the engine's word: the
 * age of what is heard, at every frame. The run has to lock, never underrun, overrun or jump,
 * and hold the latency inside a band.
 *
 * The voice half: a live voice is a mixer voice, so its level, its fade-in, a fade to silence,
 * a stop, a pause and a panic all reach it.
 *
 *   node native/audio/tests/live-input.mjs [--binary path] [--minutes n]
 */
import { checker, render, reply, START } from './offline-kit.mjs'

const { workDir, check, finish } = checker('live-input')
const minutesIndex = process.argv.indexOf('--minutes')
const MINUTES = minutesIndex >= 0 ? Number(process.argv[minutesIndex + 1]) : 5
const OUT_RATE = 48000
const RAMP_PERIOD = 65536

/**
 * Which input frame each output frame played, and how old it was when heard. Samples near the
 * ramp's wrap are skipped (the interpolator straddles the step there); every other sample is
 * unwrapped against the one before it, so a jump of more than a frame anywhere is a jump.
 */
function readLatency(samples, trueRate, settleFrame) {
  let previous = null
  let previousFrame = 0
  let jumps = 0
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let count = 0
  let firstHeard = -1
  let firstSum = 0
  let firstCount = 0
  let lastSum = 0
  let lastCount = 0
  const expectedStep = trueRate / OUT_RATE
  for (let t = 0; t < samples.length; t++) {
    const value = samples[t]
    if (value === 0 && previous === null) continue
    const code = (value + 0.5) * RAMP_PERIOD
    if (code < 64 || code > RAMP_PERIOD - 64) continue
    let index
    if (previous === null) {
      // The newest frame of this residue the source can have delivered by now.
      const delivered = Math.floor((t / OUT_RATE) * trueRate)
      index = Math.floor((delivered - code) / RAMP_PERIOD) * RAMP_PERIOD + code
      firstHeard = t
    } else {
      const predicted = previous + (t - previousFrame) * expectedStep
      // The interpolator reads four frames around where it is: within that of the ramp's
      // step, what it plays is the step smoothed, which says nothing about where it is.
      const residue = ((predicted % RAMP_PERIOD) + RAMP_PERIOD) % RAMP_PERIOD
      if (residue < 4 || residue > RAMP_PERIOD - 4) continue
      index = predicted + ((((code - predicted) % RAMP_PERIOD) + RAMP_PERIOD * 1.5) % RAMP_PERIOD) - RAMP_PERIOD / 2
      if (Math.abs(index - predicted) > 1) jumps++
    }
    previous = index
    previousFrame = t
    if (t < settleFrame) continue
    const latencyMs = (t / OUT_RATE - index / trueRate) * 1000
    if (latencyMs < min) min = latencyMs
    if (latencyMs > max) max = latencyMs
    sum += latencyMs
    count++
    if (t < settleFrame + 60 * OUT_RATE) { firstSum += latencyMs; firstCount++ }
    if (t >= samples.length - 60 * OUT_RATE) { lastSum += latencyMs; lastCount++ }
  }
  return {
    jumps, min, max, mean: sum / Math.max(1, count), count, firstHeard,
    firstMinute: firstSum / Math.max(1, firstCount), lastMinute: lastSum / Math.max(1, lastCount)
  }
}

function driftRun({ label, inRate, skewPpm, periodFrames, jitterMs, blockFrames, minutes }) {
  console.log(`\n${label}: ${inRate} Hz in, ${OUT_RATE} Hz out, ${skewPpm} ppm, ${periodFrames}-frame periods, ` +
    `${jitterMs} ms jitter, ${blockFrames}-frame blocks, ${minutes} min`)
  const frames = Math.round(minutes * 60 * OUT_RATE)
  const { summary, wav } = render(workDir, {
    channels: 1,
    blockFrames,
    frames,
    commands: [
      { atMs: 0, verb: 'inputOpen', device: 'test:ramp', sampleRate: inRate, channels: 1, skewPpm, periodFrames, jitterMs },
      {
        atMs: 0, verb: 'startInput', cueId: 'mic', device: 'test:ramp', channels: [0],
        options: { ...START, outputs: [{ inputChannel: 0, outputChannel: 0, gain: 1 }] }
      },
      { atMs: frames / OUT_RATE * 1000 - 50, verb: 'inputStatus' }
    ]
  })
  check('the input opens', reply(summary, 0).ok === true, JSON.stringify(reply(summary, 0)))
  check('the live voice starts', reply(summary, 1).ok === true, JSON.stringify(reply(summary, 1)))
  const feed = reply(summary, 2).result.feeds[0]
  const trueRate = inRate * (1 + skewPpm * 1e-6)
  // The controller is given half a minute to lock; the band is read after that.
  const settle = 30 * OUT_RATE
  const latency = readLatency(wav.samples, trueRate, settle)
  check('sound is heard within the first 100 ms', latency.firstHeard >= 0 && latency.firstHeard < OUT_RATE / 10,
    `first heard at frame ${latency.firstHeard}`)
  check(`no underruns over ${minutes} minutes`, feed.underruns === 0, `${feed.underruns}`)
  check('no overruns', feed.overruns === 0, `${feed.overruns}`)
  check('no resyncs', feed.resyncs === 0, `${feed.resyncs}`)
  check('the input is heard as one unbroken stream: no frame skipped or repeated', latency.jumps === 0,
    `${latency.jumps} jumps`)
  // What the latency can be at most: the buffer the controller holds, a period the device has
  // not handed over yet, the lateness a delivery may have, and a millisecond of the
  // controller's own movement.
  const periodMs = periodFrames / inRate * 1000
  const bound = feed.targetMs + periodMs + jitterMs + 1
  check('latency stays inside a band of a period plus the jitter once locked',
    latency.max - latency.min < periodMs + jitterMs + 1,
    `${latency.min.toFixed(3)}..${latency.max.toFixed(3)} ms`)
  check(`latency never exceeds the buffer, a period and the jitter (${bound.toFixed(1)} ms)`, latency.max < bound,
    `${latency.max.toFixed(3)} ms`)
  // The engine cannot see how late a delivery was, only how full its buffer is.
  check('the engine reports the latency the samples show, within the jitter it cannot see',
    Math.abs(feed.latencyMs - latency.mean) < jitterMs + 0.5,
    `engine ${feed.latencyMs.toFixed(3)} ms, samples ${latency.mean.toFixed(3)} ms`)
  // A clock error the controller had not absorbed would show as latency that keeps growing
  // or shrinking: the last minute is where the first minute after lock was.
  check('the clock error is absorbed: the latency does not wander', Math.abs(latency.lastMinute - latency.firstMinute) < 1,
    `first minute after lock ${latency.firstMinute.toFixed(3)} ms, last ${latency.lastMinute.toFixed(3)} ms`)
  console.log(`  measured latency ${latency.mean.toFixed(2)} ms (min ${latency.min.toFixed(2)}, max ${latency.max.toFixed(2)}) ` +
    `over ${(latency.count / OUT_RATE / 60).toFixed(1)} min after lock; target ${feed.targetMs.toFixed(2)} ms`)
  return latency
}

const results = []
results.push(['44.1 kHz input, +250 ppm, 10 ms periods, 512-frame blocks',
  driftRun({ label: 'skewed and resampled', inRate: 44100, skewPpm: 250, periodFrames: 441, jitterMs: 0, blockFrames: 512, minutes: MINUTES })])
results.push(['48 kHz input, -300 ppm, 256-frame periods, 1.5 ms jitter, 256-frame blocks',
  driftRun({ label: 'slow clock, late callbacks', inRate: 48000, skewPpm: -300, periodFrames: 256, jitterMs: 1.5, blockFrames: 256, minutes: Math.min(MINUTES, 3) })])
results.push(['96 kHz input, +1000 ppm, 1024-frame periods, 2 ms jitter, 512-frame blocks',
  driftRun({ label: 'a far-off clock at twice the rate', inRate: 96000, skewPpm: 1000, periodFrames: 1024, jitterMs: 2, blockFrames: 512, minutes: Math.min(MINUTES, 3) })])
results.push(['48 kHz input, +50 ppm, 64-frame periods, 0.3 ms jitter, 64-frame blocks',
  driftRun({ label: 'small buffers', inRate: 48000, skewPpm: 50, periodFrames: 64, jitterMs: 0.3, blockFrames: 64, minutes: Math.min(MINUTES, 2) })])

{
  console.log('\na live voice is a voice: level, fade-in, fade, pause, stop and panic reach it')
  const { summary, wav } = render(workDir, {
    channels: 2,
    frames: 48000 * 3,
    commands: [
      { atMs: 0, verb: 'inputOpen', device: 'test:tone', channels: 2 },
      { atMs: 100, verb: 'startInput', cueId: 'mic', device: 'test:tone', channels: [0, 1], options: { ...START, volume: 0.5, fadeInDuration: 200 } },
      { atMs: 1000, verb: 'pause', cueId: 'mic' },
      { atMs: 1300, verb: 'resume', cueId: 'mic' },
      { atMs: 1800, verb: 'fade', cueId: 'mic', param: 'volume', value: 0, durationMs: 200 },
      { atMs: 2200, verb: 'stop', cueId: 'mic' },
      { atMs: 2300, verb: 'startInput', cueId: 'mic2', device: 'test:tone', channels: [0] },
      { atMs: 2600, verb: 'panic', fadeMs: 0 }
    ]
  })
  const peak = (fromMs, toMs, channel = 0) => {
    let level = 0
    for (let f = Math.round(fromMs * 48); f < Math.round(toMs * 48); f++) level = Math.max(level, Math.abs(wav.samples[f * 2 + channel]))
    return level
  }
  check('the voice starts', reply(summary, 1).ok === true, JSON.stringify(reply(summary, 1)))
  check('silent before it starts', peak(0, 95) === 0)
  check('the fade-in is under way at its middle', peak(195, 205) > 0.03 && peak(195, 205) < 0.1, `${peak(195, 205)}`)
  check('at its level after the fade-in: the tone (0.25) at half volume', Math.abs(peak(400, 900) - 0.125) < 0.005,
    `${peak(400, 900)}`)
  check('both channels carry it', Math.abs(peak(400, 900, 1) - 0.125) < 0.005)
  check('the pause holds it silent', peak(1020, 1290) < 1e-6, `${peak(1020, 1290)}`)
  check('the resume brings it back', Math.abs(peak(1400, 1750) - 0.125) < 0.005)
  check('the fade takes it to silence', peak(2010, 2190) < 1e-6, `${peak(2010, 2190)}`)
  check('the stop ends it', summary.events.some(e => e.type === 'ended' && e.cueId === 'mic' && e.reason === 'stopped'))
  check('a second live voice on the same open input plays', peak(2350, 2590) > 0.1)
  check('the panic ends it', summary.events.some(e => e.type === 'ended' && e.cueId === 'mic2') && peak(2620, 2990) === 0)
}

{
  console.log('\nwhat a live voice refuses')
  const { summary } = render(workDir, {
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'startInput', cueId: 'a', device: 'test:tone', channels: [5] },
      { atMs: 0, verb: 'startInput', cueId: 'b', device: 'test:nothing', channels: [0] },
      { atMs: 0, verb: 'startInput', cueId: 'c', device: 'test:tone', channels: [] },
      { atMs: 0, verb: 'inputClose', device: 'test:tone' },
      { atMs: 0, verb: 'inputs' }
    ]
  })
  check('a channel the input does not have', reply(summary, 0).ok === false && /no channel 6/.test(reply(summary, 0).error.message),
    JSON.stringify(reply(summary, 0)))
  check('an input that does not exist', reply(summary, 1).ok === false && /no test input/.test(reply(summary, 1).error.message))
  check('no channels at all', reply(summary, 2).ok === false)
  check('closing an open input says so', reply(summary, 3).result.closed === true)
  const inputs = reply(summary, 4).result.inputs
  check('the offline engine offers the two test inputs', inputs.some(i => i.id === 'test:tone') && inputs.some(i => i.id === 'test:ramp'))
}

console.log('\nlatency measured from the samples, after lock:')
for (const [label, latency] of results) {
  console.log(`  ${label}: ${latency.mean.toFixed(2)} ms mean, ${latency.min.toFixed(2)}–${latency.max.toFixed(2)} ms`)
}
finish()
