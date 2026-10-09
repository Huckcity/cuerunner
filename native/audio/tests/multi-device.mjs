#!/usr/bin/env node
/**
 * Several output devices at once, read off what each device played, in offline mode.
 *
 * The routing half: a patch that names an extra output device is heard on that device's
 * outputs and nowhere else, beside a patch on the main device; the meters read each device;
 * and the master, a pause of cues on two devices at once, a fade, a drawn fade shape, slices,
 * a live input and a panic all reach a voice on an extra device exactly as they reach one on
 * the main device.
 *
 * The drift half: two devices never share a clock. A test device runs for minutes on a clock
 * that is off its stated rate, taking its periods late by a random amount, while one cue plays
 * on the main device and another, started on the same frame, plays on the test device. Both
 * cues play a file whose every sample counts its own frames, so each device's output says
 * which frame of the show's timeline it is playing at every instant — and the offset between
 * the two devices is read back from the samples, never taken from the engine's word. The lock
 * has to hold the test device at a fixed offset from the main one for the whole run: no
 * underrun, no overrun, no jump, and a wander inside the tolerance this file states.
 *
 * The fault half: a device that is lost ends the cues on its patches `device-lost`, reports
 * itself the way a lost device does, and leaves the main device and the other extra device
 * playing; its patch falls back to the main device until it is reconnected, and comes back.
 *
 *   node native/audio/tests/multi-device.mjs [--binary path] [--minutes n]
 */
import { join } from 'node:path'
import { checker, render, reply, START, writeFloatWav } from './offline-kit.mjs'

const { workDir, check, finish } = checker('multi-device')
const minutesIndex = process.argv.indexOf('--minutes')
const MINUTES = minutesIndex >= 0 ? Number(process.argv[minutesIndex + 1]) : 5
const RATE = 48000
const RAMP_PERIOD = 65536
/**
 * The ramp's wrap is a step, and a looping cue makes a step over a 3 ms crossfade (spine
 * AD-29): for that long after each wrap the output is the two ends of the ramp blended, which
 * says nothing about where on the timeline a device is. Those frames are left out of the
 * timeline readings, with a few frames' margin for the interpolator either side.
 */
const WRAP_FRAMES = Math.round((3 * RATE) / 1000) + 4
/**
 * The stated tolerance: once the lock has settled, the offset between the two devices stays
 * within a tenth of a millisecond either side of where the lock holds it. A tenth of a
 * millisecond is 3.4 cm of sound — closer than two loudspeakers can stand — and a 300 ppm
 * clock left alone moves that far in a third of a second. Before it has settled, from the
 * device's first frame, the offset stays within a millisecond of it.
 */
const WANDER_TOLERANCE_MS = 0.1
const FIRST_FRAME_TOLERANCE_MS = 1

// Left 0.5, right 0.25: which channel went where is read off the level.
const dcPath = join(workDir, 'dc.wav')
writeFloatWav(dcPath, 2, RATE, RATE * 4, channel => (channel === 0 ? 0.5 : 0.25))
// A ramp that counts its own frames, looped: what a device plays says where on the timeline it is.
const rampPath = join(workDir, 'ramp.wav')
writeFloatWav(rampPath, 1, RATE, RAMP_PERIOD, (_, frame) => frame / RAMP_PERIOD - 0.5)
// A tone, for the fades and the slices.
const tonePath = join(workDir, 'tone.wav')
writeFloatWav(tonePath, 1, RATE, RATE * 4, (_, frame) => 0.5 * Math.sin(2 * Math.PI * 440 * frame / RATE))

const near = (a, b, tolerance = 1e-4) => Math.abs(a - b) <= tolerance
const sampleAt = (wav, ms, channel) => wav.samples[Math.round(ms * RATE / 1000) * wav.channels + channel]
const levels = (wav, ms) => Array.from({ length: wav.channels }, (_, c) => Number(sampleAt(wav, ms, c).toFixed(4)))
const peak = (wav, fromMs, toMs, channel = 0) => {
  let level = 0
  for (let f = Math.round(fromMs * RATE / 1000); f < Math.round(toMs * RATE / 1000) && f < wav.frames; f++) {
    level = Math.max(level, Math.abs(wav.samples[f * wav.channels + channel]))
  }
  return level
}
const events = (summary, type) => summary.events.filter(event => event.type === type)

{
  console.log('\na patch on an extra device is heard there and nowhere else; the meters read each device')
  const { summary, wav, devices } = render(workDir, {
    channels: 2,
    frames: RATE * 2,
    commands: [
      { atMs: 0, verb: 'outputOpen', device: 'test:out-a', channels: 2 },
      { atMs: 0, verb: 'outputOpen', device: 'test:out-b', channels: 1 },
      { atMs: 0, verb: 'patch', slot: 0, outputs: [0, 1], gain: 1 },
      { atMs: 0, verb: 'patch', slot: 1, outputs: [0, 1], gain: 1, device: 'test:out-a' },
      { atMs: 0, verb: 'patch', slot: 2, outputs: [0], gain: 0.5, device: 'test:out-b' },
      { atMs: 0, verb: 'prepare', cueId: 'main', filePath: dcPath },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'prepare', cueId: 'b', filePath: dcPath },
      { atMs: 100, verb: 'start', cueId: 'a', options: { ...START, patch: 1 } },
      { atMs: 100, verb: 'start', cueId: 'b', options: { ...START, patch: 2 } },
      { atMs: 300, verb: 'start', cueId: 'main', options: { ...START, patch: 0, volume: 0.5 } },
      { atMs: 600, verb: 'meters' },
      { atMs: 600, verb: 'outputStatus' },
      { atMs: 1000, verb: 'master', gain: 0.5 },
      { atMs: 1400, verb: 'meters' }
    ]
  }, { devices: ['test:out-a', 'test:out-b'] })
  const a = devices['test:out-a']
  const b = devices['test:out-b']
  check('both test devices open and tee what they play', reply(summary, 0).ok && reply(summary, 1).ok && a && b,
    JSON.stringify([reply(summary, 0), reply(summary, 1)]))
  check('the patch on device A says it plays there', reply(summary, 3).result.device === 'test:out-a' &&
    reply(summary, 3).result.fallback === false, JSON.stringify(reply(summary, 3)))
  check('the patch on the main device says so', reply(summary, 2).result.device === null, JSON.stringify(reply(summary, 2)))
  check('the main device hears only its own cue: silent until it starts', JSON.stringify(levels(wav, 250)) === '[0,0]',
    JSON.stringify(levels(wav, 250)))
  check('the main cue is on the main outputs at its level', JSON.stringify(levels(wav, 500)) === '[0.25,0.125]',
    JSON.stringify(levels(wav, 500)))
  // A test device's frame n is heard at its start plus n at its rate; here the rate is the main one.
  check('device A plays its cue on its two outputs', JSON.stringify(levels(a, 500)) === '[0.5,0.25]', JSON.stringify(levels(a, 500)))
  check('device B plays its cue on its one output, at the patch\'s fader', JSON.stringify(levels(b, 500)) === '[0.25]',
    JSON.stringify(levels(b, 500)))
  const meters = reply(summary, 11).result
  const meterA = meters.devices.find(entry => entry.device === 'test:out-a')
  const meterB = meters.devices.find(entry => entry.device === 'test:out-b')
  check('the meters read device A', meterA && near(meterA.peaks[0], 0.5) && near(meterA.peaks[1], 0.25), JSON.stringify(meters.devices))
  check('and device B', meterB && near(meterB.peaks[0], 0.25), JSON.stringify(meters.devices))
  check('and the main device', near(meters.peaks[0], 0.25) && near(meters.peaks[1], 0.125), JSON.stringify(meters.peaks))
  check('each patch reads its own meter', meters.buses.some(bus => bus.slot === 1 && near(bus.peaks[0], 0.5)) &&
    meters.buses.some(bus => bus.slot === 2 && near(bus.peaks[0], 0.25)), JSON.stringify(meters.buses))
  const status = reply(summary, 12).result.outputs
  check('both devices report themselves running', status.length === 2 && status.every(output => output.running && !output.failed),
    JSON.stringify(status))
  check('one master for every device: halved on the main device', JSON.stringify(levels(wav, 1300)) === '[0.125,0.0625]',
    JSON.stringify(levels(wav, 1300)))
  check('and on device A', JSON.stringify(levels(a, 1300)) === '[0.25,0.125]', JSON.stringify(levels(a, 1300)))
  check('and on device B', JSON.stringify(levels(b, 1300)) === '[0.125]', JSON.stringify(levels(b, 1300)))
  const after = reply(summary, 14).result.devices.find(entry => entry.device === 'test:out-a')
  check('and its meter reads after the master', after && near(after.peaks[0], 0.25), JSON.stringify(after))
}

{
  console.log('\npause, fades, a drawn shape, slices, a live input and a panic reach a voice on any device')
  const shape = Array.from({ length: 65 }, (_, i) => (i / 64) ** 3)
  const { summary, wav, devices } = render(workDir, {
    channels: 2,
    frames: RATE * 4,
    commands: [
      { atMs: 0, verb: 'patch', slot: 0, outputs: [0, 1], gain: 1, device: 'test:out-a' },
      { atMs: 0, verb: 'patch', slot: 1, outputs: [0, 1], gain: 1, device: 'test:out-b' },
      { atMs: 0, verb: 'prepare', cueId: 'main', filePath: dcPath },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'prepare', cueId: 'sliced', filePath: tonePath },
      { atMs: 100, verb: 'start', cueId: 'main', options: START },
      { atMs: 100, verb: 'start', cueId: 'a', options: { ...START, patch: 0 } },
      // The show-wide pause: every cue held on the same frame, whichever device it is on.
      { atMs: 500, verb: 'pause', cueId: 'main' },
      { atMs: 500, verb: 'pause', cueId: 'a' },
      { atMs: 800, verb: 'resume', cueId: 'main' },
      { atMs: 800, verb: 'resume', cueId: 'a' },
      { atMs: 1000, verb: 'fade', cueId: 'a', param: 'volume', value: 0, durationMs: 400, curve: 'custom', shape },
      // Slices on device B: the first 100 ms of the tone twice, then 500–600 ms once.
      {
        atMs: 1000, verb: 'start', cueId: 'sliced', options: {
          ...START, patch: 1,
          slices: [{ startTime: 0, endTime: 100, playCount: 2 }, { startTime: 500, endTime: 600, playCount: 1 }]
        }
      },
      { atMs: 1600, verb: 'startInput', cueId: 'mic', device: 'test:tone', channels: [0, 1], options: { ...START, patch: 1 } },
      { atMs: 2300, verb: 'outputStatus' },
      { atMs: 2400, verb: 'panic', fadeMs: 0 }
    ]
  }, { devices: ['test:out-a', 'test:out-b'] })
  check('every verb is taken', summary.results.every(result => result.reply.ok === true),
    JSON.stringify(summary.results.filter(result => result.reply.ok !== true)))
  // A device plays the show's frame t behind it by what its lock holds: read each one at the
  // show's own times, moved on by that.
  const lag = Object.fromEntries(reply(summary, 14).result.outputs.map(output => [output.device, output.latencyMs]))
  const onDevice = (device) => {
    const played = devices[device]
    return {
      at: ms => sampleAt(played, ms + lag[device], 0),
      peak: (fromMs, toMs) => peak(played, fromMs + lag[device], toMs + lag[device])
    }
  }
  const a = onDevice('test:out-a')
  const b = onDevice('test:out-b')
  check('both cues play before the pause', near(sampleAt(wav, 400, 0), 0.5) && near(a.at(400), 0.5))
  check('the pause holds the main cue', peak(wav, 520, 790) === 0, `${peak(wav, 520, 790)}`)
  check('and the cue on device A, on the same frame', a.peak(520, 790) === 0, `${a.peak(520, 790)}`)
  check('both go on together after the resume', near(sampleAt(wav, 900, 0), 0.5) && near(a.at(900), 0.5))
  // The drawn cube: at the fade's middle the shape is an eighth of the way, so the level is 7/8.
  check('the drawn fade shape plays on device A: at its middle the level is 7/8 of where it began',
    near(a.at(1200), 0.5 * (1 - 0.125), 0.003), `${a.at(1200)}`)
  check('and the fade takes it to silence', a.peak(1420, 1590) < 1e-6, `${a.peak(1420, 1590)}`)
  check('the main cue never moved for any of it', near(sampleAt(wav, 1200, 0), 0.5) && near(sampleAt(wav, 1500, 0), 0.5))
  const sliceEnded = events(summary, 'ended').find(event => event.cueId === 'sliced')
  check('the sliced cue on device B plays its three passes and ends', sliceEnded && sliceEnded.reason === 'complete' &&
    near(sliceEnded.at, 1000 + 300, 2), JSON.stringify(sliceEnded))
  // A mono tone on a two-channel patch is panned centre: −3 dB on each side, 0.5 × 0.707.
  check('device B carries the slices while they play, and nothing after', near(b.peak(1010, 1290), 0.3536, 0.002) && b.peak(1310, 1590) === 0,
    `${b.peak(1010, 1290)} then ${b.peak(1310, 1590)}`)
  check('a live input plays on device B: the test tone at −12 dBFS', near(b.peak(1700, 2300), 0.25, 0.01), `${b.peak(1700, 2300)}`)
  check('the main device does not hear the live input', near(peak(wav, 1700, 2300), 0.5), `${peak(wav, 1700, 2300)}`)
  check('the panic ends every voice on every device', ['main', 'a', 'mic'].every(cueId =>
    events(summary, 'ended').some(event => event.cueId === cueId)), JSON.stringify(events(summary, 'ended')))
  check('the main device is silent after the panic', peak(wav, 2420, 3900) === 0, `${peak(wav, 2420, 3900)}`)
  check('device A is silent after it', a.peak(2420, 3800) === 0, `${a.peak(2420, 3800)}`)
  check('device B is silent after it', b.peak(2420, 3800) === 0, `${b.peak(2420, 3800)}`)
}

/**
 * Where on the show's timeline each frame a test device played came from, against when that
 * device played it — the inter-device offset at every frame. `start` is the main frame both
 * cues began on, `startedAtMs` where the device's frame 0 sits on the main timeline, and
 * `trueRate` the device's real rate. Samples near the ramp's wrap are skipped: the interpolator
 * straddles the step there, and what it plays says nothing about where it is.
 */
function readOffsets(samples, { start, startedAtMs, trueRate, settleSeconds }) {
  const startedAt = startedAtMs / 1000
  const startTime = start / RATE
  let previous = null
  let previousFrame = 0
  let jumps = 0
  let all = { min: Infinity, max: -Infinity }
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sumSquares = 0
  let count = 0
  let firstSum = 0
  let firstCount = 0
  let lastSum = 0
  let lastCount = 0
  const step = RATE / trueRate
  const runEnd = startedAt + samples.length / trueRate
  for (let n = 0; n < samples.length; n++) {
    const heardAt = startedAt + n / trueRate
    // From 200 ms after the cues started: the device has primed and its output is the ramp.
    if (heardAt < startTime + 0.2) continue
    const code = (samples[n] + 0.5) * RAMP_PERIOD
    let position
    if (previous === null) {
      if (code < 64 || code > RAMP_PERIOD - 64) continue
      position = code
    } else {
      const predicted = previous + (n - previousFrame) * step
      const residue = ((predicted % RAMP_PERIOD) + RAMP_PERIOD) % RAMP_PERIOD
      if (residue < WRAP_FRAMES || residue > RAMP_PERIOD - 4) continue
      position = predicted + ((((code - predicted) % RAMP_PERIOD) + RAMP_PERIOD * 1.5) % RAMP_PERIOD) - RAMP_PERIOD / 2
      if (Math.abs(position - predicted) > 0.5) jumps++
    }
    previous = position
    previousFrame = n
    const offsetMs = (heardAt - (start + position) / RATE) * 1000
    all.min = Math.min(all.min, offsetMs)
    all.max = Math.max(all.max, offsetMs)
    if (heardAt < startTime + settleSeconds) continue
    min = Math.min(min, offsetMs)
    max = Math.max(max, offsetMs)
    sum += offsetMs
    sumSquares += offsetMs * offsetMs
    count++
    if (heardAt < startTime + settleSeconds + 60) { firstSum += offsetMs; firstCount++ }
    if (heardAt >= runEnd - 60) { lastSum += offsetMs; lastCount++ }
  }
  const mean = sum / Math.max(1, count)
  return {
    jumps, min, max, mean, all, count,
    sd: Math.sqrt(Math.max(0, sumSquares / Math.max(1, count) - mean * mean)),
    firstMinute: firstSum / Math.max(1, firstCount),
    lastMinute: lastSum / Math.max(1, lastCount),
    seconds: count / trueRate
  }
}

/** Every main-device frame from the cue's start is the ramp's frame, exactly: its own timeline. */
function mainIsExact(wav, start) {
  let wrong = 0
  for (let m = start; m < wav.frames; m += 997) {
    if ((m - start) % RAMP_PERIOD < WRAP_FRAMES && m - start >= RAMP_PERIOD) continue
    const expected = Math.fround(((m - start) % RAMP_PERIOD) / RAMP_PERIOD - 0.5)
    if (wav.samples[m] !== expected) wrong++
  }
  return wrong
}

function driftRun({ label, skewPpm, deviceRate, periodFrames, jitterMs, blockFrames, minutes }) {
  console.log(`\n${label}: a ${deviceRate} Hz test device ${skewPpm > 0 ? '+' : ''}${skewPpm} ppm off its rate, ` +
    `${periodFrames}-frame periods, ${jitterMs} ms callback jitter, main ${RATE} Hz in ${blockFrames}-frame blocks, ${minutes} min`)
  const frames = Math.round(minutes * 60 * RATE)
  const startMs = 1000
  const { summary, wav, devices } = render(workDir, {
    channels: 1,
    blockFrames,
    frames,
    commands: [
      { atMs: 0, verb: 'outputOpen', device: 'test:out-a', channels: 1, sampleRate: deviceRate, skewPpm, periodFrames, jitterMs },
      { atMs: 0, verb: 'patch', slot: 0, outputs: [0], gain: 1 },
      { atMs: 0, verb: 'patch', slot: 1, outputs: [0], gain: 1, device: 'test:out-a' },
      { atMs: 0, verb: 'prepare', cueId: 'main', filePath: rampPath },
      { atMs: 0, verb: 'prepare', cueId: 'aux', filePath: rampPath },
      // One cue to each device, on the same frame: the same music, sent to two places.
      { atMs: 0, verb: 'start', cueId: 'main', whenMs: startMs, options: { ...START, loopCount: -1, patch: 0 } },
      { atMs: 0, verb: 'start', cueId: 'aux', whenMs: startMs, options: { ...START, loopCount: -1, patch: 1 } },
      { atMs: frames / RATE * 1000 - 50, verb: 'outputStatus' }
    ]
  }, { devices: ['test:out-a'] })
  check('the device opens and both cues start', [0, 1, 2, 5, 6].every(i => reply(summary, i).ok === true),
    JSON.stringify(summary.results.slice(0, 7)))
  const status = reply(summary, 7).result.outputs[0]
  const played = devices['test:out-a']
  const trueRate = deviceRate * (1 + skewPpm * 1e-6)
  const start = Math.round(startMs * RATE / 1000)
  check('the main device plays the cue on its own timeline, frame for frame', mainIsExact(wav, start) === 0,
    `${mainIsExact(wav, start)} frames off`)
  const settle = 30
  const offsets = readOffsets(played.samples, { start, startedAtMs: status.startedAtMs, trueRate, settleSeconds: settle })
  check(`no underruns over ${minutes} minutes`, status.underruns === 0, `${status.underruns}`)
  check('no overruns', status.overruns === 0, `${status.overruns}`)
  check('no resyncs', status.resyncs === 0, `${status.resyncs}`)
  check('the device plays the show as one unbroken stream: no frame skipped or repeated', offsets.jumps === 0,
    `${offsets.jumps} jumps`)
  check(`after ${settle} s the offset between the devices stays within ±${WANDER_TOLERANCE_MS} ms of its mean`,
    offsets.max - offsets.mean < WANDER_TOLERANCE_MS && offsets.mean - offsets.min < WANDER_TOLERANCE_MS,
    `${offsets.min.toFixed(4)}..${offsets.max.toFixed(4)} ms about ${offsets.mean.toFixed(4)} ms`)
  check('the clock error is absorbed: the last minute sits where the first minute after lock did',
    Math.abs(offsets.lastMinute - offsets.firstMinute) < WANDER_TOLERANCE_MS / 4,
    `first ${offsets.firstMinute.toFixed(4)} ms, last ${offsets.lastMinute.toFixed(4)} ms`)
  check(`from the device's first frame, before the lock had settled, the offset stays within ±${FIRST_FRAME_TOLERANCE_MS} ms of it`,
    offsets.all.max - offsets.mean < FIRST_FRAME_TOLERANCE_MS && offsets.mean - offsets.all.min < FIRST_FRAME_TOLERANCE_MS,
    `${offsets.all.min.toFixed(3)}..${offsets.all.max.toFixed(3)} ms`)
  check('the engine measures the device\'s clock error to within 5 ppm', Math.abs(status.driftPpm - skewPpm) < 5,
    `engine ${status.driftPpm.toFixed(2)} ppm, true ${skewPpm} ppm`)
  check('the engine reports the offset the samples show, within the jitter it cannot see',
    Math.abs(status.latencyMs - offsets.mean) < jitterMs + 0.5,
    `engine ${status.latencyMs.toFixed(3)} ms, samples ${offsets.mean.toFixed(3)} ms`)
  const unlockedMs = Math.abs(skewPpm) * 1e-6 * minutes * 60 * 1000
  console.log(`  measured inter-device offset ${offsets.mean.toFixed(3)} ms (sd ${(offsets.sd * 1000).toFixed(1)} µs, ` +
    `${offsets.min.toFixed(3)}–${offsets.max.toFixed(3)} ms) over ${(offsets.seconds / 60).toFixed(1)} min after lock; ` +
    `${offsets.all.min.toFixed(3)}–${offsets.all.max.toFixed(3)} ms from the first frame; engine drift ${status.driftPpm.toFixed(2)} ppm. ` +
    `Unlocked, ${skewPpm} ppm would have moved the device ${unlockedMs.toFixed(0)} ms over the run.`)
  return offsets
}

const runs = []
runs.push(['+300 ppm, 480-frame periods, 1.5 ms jitter, 512-frame blocks',
  driftRun({ label: 'a fast device', skewPpm: 300, deviceRate: RATE, periodFrames: 480, jitterMs: 1.5, blockFrames: 512, minutes: MINUTES })])
runs.push(['-300 ppm, 256-frame periods, 2 ms jitter, 256-frame blocks',
  driftRun({ label: 'a slow device', skewPpm: -300, deviceRate: RATE, periodFrames: 256, jitterMs: 2, blockFrames: 256, minutes: MINUTES })])
runs.push(['44.1 kHz device, +120 ppm, 441-frame periods, 1 ms jitter, 512-frame blocks',
  driftRun({ label: 'a device at another rate', skewPpm: 120, deviceRate: 44100, periodFrames: 441, jitterMs: 1, blockFrames: 512, minutes: Math.min(MINUTES, 2) })])

{
  console.log('\na device that is lost takes only its own cues with it')
  const { summary, wav, devices } = render(workDir, {
    channels: 2,
    frames: RATE * 3,
    commands: [
      { atMs: 0, verb: 'patch', slot: 0, outputs: [0, 1], gain: 1 },
      { atMs: 0, verb: 'patch', slot: 1, outputs: [0, 1], gain: 1, device: 'test:out-a' },
      { atMs: 0, verb: 'patch', slot: 2, outputs: [0, 1], gain: 1, device: 'test:out-b' },
      { atMs: 0, verb: 'prepare', cueId: 'main', filePath: dcPath },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'prepare', cueId: 'b', filePath: dcPath },
      { atMs: 100, verb: 'start', cueId: 'main', options: { ...START, patch: 0, volume: 0.5 } },
      { atMs: 100, verb: 'start', cueId: 'a', options: { ...START, patch: 1 } },
      { atMs: 100, verb: 'start', cueId: 'b', options: { ...START, patch: 2 } },
      // Device A is pulled.
      { atMs: 1000, verb: 'simulateDeviceNotification', type: 'stopped', device: 'test:out-a' },
      { atMs: 1200, verb: 'outputStatus' },
      // A cue on its patch now: heard on the main device's outputs of the same numbers.
      { atMs: 1300, verb: 'prepare', cueId: 'a2', filePath: dcPath },
      { atMs: 1300, verb: 'start', cueId: 'a2', options: { ...START, patch: 1, volume: 0.25 } },
      { atMs: 1600, verb: 'stop', cueId: 'a2' },
      // Reconnected: the patch is back on device A.
      { atMs: 1800, verb: 'outputOpen', device: 'test:out-a' },
      { atMs: 1900, verb: 'prepare', cueId: 'a3', filePath: dcPath },
      { atMs: 1900, verb: 'start', cueId: 'a3', options: { ...START, patch: 1 } },
      { atMs: 2500, verb: 'meters' }
    ]
  }, { devices: ['test:out-a', 'test:out-b'] })
  const a = devices['test:out-a']
  const b = devices['test:out-b']
  const ended = events(summary, 'ended')
  const lostA = ended.find(event => event.cueId === 'a')
  check('the cue on the lost device ends device-lost', lostA && lostA.reason === 'device-lost', JSON.stringify(ended))
  check('the cues on the other devices do not end', !ended.some(event => (event.cueId === 'main' || event.cueId === 'b') && event.at < 2900),
    JSON.stringify(ended))
  const error = events(summary, 'error').find(event => event.code === 'device')
  check('the loss is reported the way a lost device is, by name', error && /Test output A/.test(error.message) &&
    error.cueId === null, JSON.stringify(events(summary, 'error')))
  check('no panic: the show was not stopped', events(summary, 'panic').length === 0)
  const status = reply(summary, 10).result.outputs
  const statusA = status.find(output => output.device === 'test:out-a')
  const statusB = status.find(output => output.device === 'test:out-b')
  check('device A reports itself lost, and why', statusA && statusA.failed && !statusA.running && /stopped/.test(statusA.error),
    JSON.stringify(statusA))
  check('device B is still running, and never ran dry', statusB && statusB.running && statusB.underruns === 0,
    JSON.stringify(statusB))
  check('device A played its cue until it was lost', near(sampleAt(a, 900, 0), 0.5))
  check('device B plays on through the loss', near(peak(b, 1000, 1290), 0.5) && near(sampleAt(b, 1250, 1), 0.25))
  check('the main device plays on through the loss', near(sampleAt(wav, 1050, 0), 0.25) && near(sampleAt(wav, 1250, 0), 0.25),
    JSON.stringify([levels(wav, 1050), levels(wav, 1250)]))
  check('a cue on the lost device\'s patch falls back to the main device\'s outputs of the same numbers',
    near(sampleAt(wav, 1450, 0), 0.25 + 0.125) && near(sampleAt(wav, 1450, 1), 0.125 + 0.0625), JSON.stringify(levels(wav, 1450)))
  check('reconnecting the device is taken', reply(summary, 14).ok === true && reply(summary, 14).result.running === true,
    JSON.stringify(reply(summary, 14)))
  const meterA = reply(summary, 17).result.devices.find(entry => entry.device === 'test:out-a')
  check('and its patch is back on it', meterA && near(meterA.peaks[0], 0.5) && near(sampleAt(wav, 2500, 0), 0.25),
    `device A ${JSON.stringify(meterA)}, main ${JSON.stringify(levels(wav, 2500))}`)
  check('the cue started after the reconnect plays on', !ended.some(event => event.cueId === 'a3'))
}

{
  console.log('\na patch for a device this machine does not have plays on the main device, and says so')
  const { summary, wav } = render(workDir, {
    channels: 4,
    frames: RATE,
    commands: [
      { atMs: 0, verb: 'patch', slot: 0, outputs: [2, 3], gain: 1, device: 'hw:CARD=Missing,DEV=0' },
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, patch: 0 } },
      { atMs: 500, verb: 'outputStatus' },
      { atMs: 500, verb: 'meters' }
    ]
  })
  const result = reply(summary, 0).result
  check('the patch is defined, as a fallback, with the reason', result.applied === true && result.fallback === true &&
    result.device === null && /not connected/.test(result.reason), JSON.stringify(result))
  check('its cue is heard on outputs 3 and 4 of the main device', JSON.stringify(levels(wav, 300)) === '[0,0,0.5,0.25]',
    JSON.stringify(levels(wav, 300)))
  check('no device was opened for it', reply(summary, 3).result.outputs.length === 0)
  check('a show on one device has no device meters beside the main one', reply(summary, 4).result.devices.length === 0)
}

{
  console.log('\nwhat the extra devices refuse')
  const { summary } = render(workDir, {
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'outputOpen', device: 'test:out-z' },
      { atMs: 0, verb: 'outputOpen', device: 'hw:CARD=Missing,DEV=0' },
      { atMs: 0, verb: 'outputOpen', device: 'test:out-a', skewPpm: 20000 },
      { atMs: 0, verb: 'outputClose', device: 'test:out-b' },
      { atMs: 0, verb: 'simulateDeviceNotification', type: 'stopped', device: 'hw:CARD=Missing,DEV=0' },
      { atMs: 0, verb: 'outputs' },
      { atMs: 0, verb: 'outputOpen', device: 'test:out-a' },
      { atMs: 0, verb: 'outputClose', device: 'test:out-a' },
      { atMs: 0, verb: 'outputStatus' }
    ]
  })
  check('a test output that does not exist', reply(summary, 0).ok === false && /no test output/.test(reply(summary, 0).error.message),
    JSON.stringify(reply(summary, 0)))
  check('a device the machine does not have', reply(summary, 1).ok === false && reply(summary, 1).error.code === 'device')
  check('a clock error past ±10000 ppm', reply(summary, 2).ok === false)
  check('closing a device that is not open says so', reply(summary, 3).result.closed === false)
  check('a real device cannot be made to look lost', reply(summary, 4).ok === false)
  const outputs = reply(summary, 5).result.outputs
  check('the offline engine offers the two test devices', outputs.some(o => o.id === 'test:out-a') && outputs.some(o => o.id === 'test:out-b'))
  check('a device opened and closed again is gone', reply(summary, 7).result.closed === true && reply(summary, 8).result.outputs.length === 0)
}

console.log('\ninter-device offset measured from the samples, after lock:')
for (const [label, offsets] of runs) {
  console.log(`  ${label}: ${offsets.mean.toFixed(3)} ms, wander ${((offsets.max - offsets.min) * 1000).toFixed(1)} µs peak to peak ` +
    `(sd ${(offsets.sd * 1000).toFixed(1)} µs) over ${(offsets.seconds / 60).toFixed(1)} min`)
}
finish()
