#!/usr/bin/env node
/**
 * Seamless jumps (spine AD-29): every jump a voice's path makes — a loop's wrap, a skip over
 * slices that play no times, the way out of a vamp, a start at an offset, a seek into a later
 * slice — plays the file's own samples with nothing inserted, streamed or cached, in every
 * format the engine reads.
 *
 * Each case renders offline and is compared, sample for sample, with what the path should
 * sound like built from a reference: the same file decoded straight through by the engine
 * (cached, one plain pass). A join whose two sides do not meet is an equal-power crossfade of
 * `kJoinCrossfadeMs` (plan.h), and the reference is built with the same crossfade, so the
 * comparison is exact there too. The maximum error at each join is printed beside the checks.
 *
 * A file streams when the cache is told its bound is one byte. `--stream-preroll-ms 300`
 * makes every jump past the ring's window land on a pad rather than in the ring, and a small
 * per-voice budget makes a loop longer than the pads can hold. The last part runs 24 streamed
 * vamps on a real decode thread, with and without a slow disk.
 *
 * The fixtures are one 4 s, 48 kHz stereo signal — two chirps under two tones, so no stretch
 * of it repeats — encoded by ffmpeg (`libmp3lame -b:a 128k`, `libvorbis -q:a 3`, `flac`,
 * `aac -b:a 128k`, and in video containers with `libopus` in WebM and `aac` in MP4); WAV and
 * AIFF are written here.
 *
 *   node native/audio/tests/seamless.mjs [--binary path]
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { binary, checker, readFloatWav, render, reply, START } from './offline-kit.mjs'

const { workDir, check, finish } = checker('seamless')
const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url))), 'fixtures')
const RATE = 48000
/** A join's crossfade at the device's rate: `kJoinCrossfadeMs` (3 ms) in plan.h. */
const XFADE = Math.round((3 * RATE) / 1000)
/** `kCleanJoinStep`: a join whose step is no bigger than this is made without a crossfade. */
const CLEAN = 1 / 1024
const EXACT = 1e-6
const STREAM = ['--cache-max-file-bytes', '1']
const STREAM_PADS = [...STREAM, '--stream-preroll-ms', '300']
/** A ring of 250 ms and pads of about 0.6 s each: smaller than the 1.4 s vamp. */
const STREAM_TIGHT = [...STREAM, '--stream-preroll-ms', '250', '--stream-max-bytes-per-voice', '1000000']

// --- the files ------------------------------------------------------------------------

/** The fixtures' signal, as the encoders were given it. */
function chirp(channel, frame) {
  const t = frame / RATE
  return channel === 0
    ? 0.3 * Math.sin(2 * Math.PI * (200 * t + 150 * t * t)) + 0.2 * Math.sin(2 * Math.PI * 331.7 * t)
    : 0.3 * Math.sin(2 * Math.PI * (310 * t + 110 * t * t) + 1) + 0.2 * Math.sin(2 * Math.PI * 517.3 * t)
}

function writeWav16(path, frames) {
  const buffer = Buffer.alloc(44 + frames * 4)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + frames * 4, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22); buffer.writeUInt32LE(RATE, 24)
  buffer.writeUInt32LE(RATE * 4, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36)
  buffer.writeUInt32LE(frames * 4, 40)
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < 2; channel++) buffer.writeInt16LE(Math.round(chirp(channel, frame) * 32767), 44 + frame * 4 + channel * 2)
  }
  writeFileSync(path, buffer)
}

/** 16-bit big-endian AIFF: FORM/AIFF with COMM (the rate as an 80-bit extended) and SSND. */
function writeAiff(path, frames) {
  const data = frames * 4
  const buffer = Buffer.alloc(12 + 26 + 16 + data)
  buffer.write('FORM', 0); buffer.writeUInt32BE(buffer.length - 8, 4); buffer.write('AIFF', 8)
  buffer.write('COMM', 12); buffer.writeUInt32BE(18, 16); buffer.writeUInt16BE(2, 20); buffer.writeUInt32BE(frames, 22)
  buffer.writeUInt16BE(16, 26)
  // 48000 = 1.46484375 × 2^15: exponent 16383 + 15, mantissa with the integer bit set.
  buffer.writeUInt16BE(16383 + 15, 28); buffer.writeUInt32BE(0xbb800000, 30); buffer.writeUInt32BE(0, 34)
  buffer.write('SSND', 38); buffer.writeUInt32BE(8 + data, 42); buffer.writeUInt32BE(0, 46); buffer.writeUInt32BE(0, 50)
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < 2; channel++) buffer.writeInt16BE(Math.round(chirp(channel, frame) * 32767), 54 + frame * 4 + channel * 2)
  }
  writeFileSync(path, buffer)
}

const FILES = {
  wav: join(workDir, 'seamless.wav'),
  aiff: join(workDir, 'seamless.aiff'),
  mp3: join(fixtures, 'seamless.mp3'),
  ogg: join(fixtures, 'seamless.ogg'),
  flac: join(fixtures, 'seamless.flac'),
  m4a: join(fixtures, 'seamless.m4a'),
  'mp4 (video)': join(fixtures, 'seamless-video.mp4'),
  'webm (video)': join(fixtures, 'seamless-video.webm')
}
writeWav16(FILES.wav, 4 * RATE)
writeAiff(FILES.aiff, 4 * RATE)
/** Formats whose decoder lands on the exact sample when it seeks. The rest go through the
 *  ffmpeg helper on Linux, whose seek is a decode of its own: what is read after one is
 *  ffmpeg's sound from there, not the straight-through decode's. */
const EXACT_SEEK = new Set(['wav', 'aiff', 'mp3', 'ogg', 'flac'])
/**
 * How close a read that began with a seek comes to the straight-through decode. AAC through
 * the helper lands on the sample and, decoded through its pre-roll, within a few 1e-5 of it —
 * up to a few 1e-3 in the file's last 15 ms, where the two decodes trim the encoder's padding
 * apart. WebM's Opus lands a millisecond early — Matroska keeps its times in milliseconds — so
 * its error after a seek is reported and not held; that it is never silence still is.
 */
function seekBound(name) {
  if (EXACT_SEEK.has(name)) return EXACT
  return name.startsWith('webm') ? null : 1e-2
}

// --- the reference and the path ----------------------------------------------------------

const references = new Map()
/** The file decoded straight through: one cached, plain pass. */
function reference(name) {
  if (references.has(name)) return references.get(name)
  const { summary, wav } = render(workDir, {
    frames: 5 * RATE,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'ref', filePath: FILES[name] },
      { atMs: 0, verb: 'start', cueId: 'ref', options: START }
    ]
  })
  const prepared = reply(summary, 0)
  if (prepared.ok !== true) throw new Error(`${name} does not open: ${JSON.stringify(prepared)}`)
  const frames = prepared.result.frames
  // Where the plain pass ended: the file's own end as its decoder reads it, which for AAC is
  // not the length the container declares.
  const ended = summary.events.find((event) => event.type === 'ended' && event.cueId === 'ref')
  const played = ended ? Math.round((ended.at * RATE) / 1000) : frames
  const ref = { frames, played, samples: wav.samples, at: (channel, frame) => (frame >= 0 && frame < frames ? wav.samples[frame * 2 + channel] : 0) }
  references.set(name, ref)
  return ref
}

/**
 * What a path through the file sounds like: its runs of source frames played in order, and
 * where one run does not start where the last ended, the join — straight on when the step is
 * clean, otherwise an equal-power crossfade from the frames the file would have gone on with
 * to the frames the run starts on. `length` is the region the voice lands in, which a very
 * short loop's crossfade is held to half of. Returns the output and where each join is.
 */
function expected(ref, path) {
  const out = new Float32Array(path.reduce((total, run) => total + (run.to - run.from), 0) * 2)
  const joins = []
  let at = 0
  for (let i = 0; i < path.length; i++) {
    const run = path[i]
    for (let frame = run.from; frame < run.to; frame++, at++) {
      out[at * 2] = ref.at(0, frame)
      out[at * 2 + 1] = ref.at(1, frame)
    }
    const start = at - (run.to - run.from)
    if (i === 0 || run.from === path[i - 1].to) continue
    const continuation = path[i - 1].to
    // Past the end of the file the next sample is predicted from the last two, and the last one
    // is held under the crossfade.
    const pastEnd = continuation >= ref.frames
    const next = (channel) => pastEnd
      ? Math.fround(2 * ref.at(channel, ref.frames - 1) - ref.at(channel, ref.frames - 2))
      : ref.at(channel, continuation)
    const leaving = (channel, k) => (pastEnd ? ref.at(channel, ref.frames - 1) : ref.at(channel, continuation + k))
    let step = 0
    for (let channel = 0; channel < 2; channel++) step = Math.max(step, Math.abs(Math.fround(next(channel) - ref.at(channel, run.from))))
    let frames = 0
    if (step > CLEAN) {
      frames = XFADE
      const length = run.length ?? run.to - run.from
      if (length < 2 * frames) frames = Math.max(1, Math.floor(length / 2))
      for (let k = 0; k < frames; k++) {
        const t = (k + 0.5) / frames
        for (let channel = 0; channel < 2; channel++) {
          const landing = out[(start + k) * 2 + channel]
          out[(start + k) * 2 + channel] = landing * Math.sin((t * Math.PI) / 2) + leaving(channel, k) * Math.cos((t * Math.PI) / 2)
        }
      }
    }
    joins.push({ frame: start, crossfade: frames })
  }
  return { out, frames: at, joins }
}

/** How the render matches the path: the worst error at each join and everywhere else. */
function compare(wav, want) {
  const near = new Uint8Array(want.frames)
  const atJoin = want.joins.map(() => 0)
  want.joins.forEach((join, index) => {
    for (let t = Math.max(0, join.frame - 32); t < Math.min(want.frames, join.frame + join.crossfade + 32); t++) near[t] = index + 1
  })
  let elsewhere = 0
  let firstBad = -1
  for (let t = 0; t < want.frames; t++) {
    let error = 0
    for (let channel = 0; channel < 2; channel++) {
      const got = t < wav.frames ? wav.samples[t * 2 + channel] : 0
      error = Math.max(error, Math.abs(got - want.out[t * 2 + channel]))
    }
    if (error > EXACT && firstBad < 0) firstBad = t
    if (near[t] > 0) atJoin[near[t] - 1] = Math.max(atJoin[near[t] - 1], error)
    else elsewhere = Math.max(elsewhere, error)
  }
  // Silence the path does not have: runs of exact zeros where the reference is sounding.
  let inserted = 0
  for (let t = 0; t < want.frames && t < wav.frames; t++) {
    if (wav.samples[t * 2] === 0 && wav.samples[t * 2 + 1] === 0 && (want.out[t * 2] !== 0 || want.out[t * 2 + 1] !== 0)) inserted++
  }
  const worstJoin = atJoin.reduce((a, b) => Math.max(a, b), 0)
  return { atJoin, worstJoin, elsewhere, worst: Math.max(worstJoin, elsewhere), firstBad, inserted }
}

const fmt = (value) => value.toExponential(1)
const ms = (frames) => (frames * 1000) / RATE

/** Renders one case and holds it to its path. */
function holds(label, name, { args = [], slices, options = {}, commands = [], path, bound = EXACT, seconds = 20, after }) {
  const ref = reference(name)
  const want = expected(ref, path(ref))
  const { summary, wav } = render(workDir, {
    frames: seconds * RATE,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: FILES[name] },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, ...options, ...(slices ? { slices } : {}) } },
      ...commands
    ]
  }, { args })
  const result = compare(wav, want)
  const ended = summary.events.find((event) => event.type === 'ended' && event.cueId === 'a')
  const underruns = summary.info.media.decodeUnderruns
  const streamed = reply(summary, 0).result.streaming === true
  const joins = result.atJoin.length > 0
    ? `${result.atJoin.length} joins, max error at each: ${[...new Set(result.atJoin.map(fmt))].join(' / ')}`
    : 'no joins'
  console.log(`    ${label} [${name}${streamed ? ', streamed' : ', cached'}]: ${joins}; elsewhere ${fmt(result.elsewhere)}; ` +
    `${result.inserted} frames of inserted silence; ${underruns} underruns`)
  if (bound !== null) {
    check(`${label} — ${name}: the output is the path, sample for sample (≤ ${fmt(bound)})`, result.worst <= bound,
      `worst ${fmt(result.worst)}, first frame off at ${result.firstBad} (${ms(result.firstBad).toFixed(1)} ms)`)
  }
  check(`${label} — ${name}: no silence inserted, no underrun`, result.inserted === 0 && underruns === 0,
    `${result.inserted} frames of silence, ${underruns} underruns`)
  check(`${label} — ${name}: it ends where the path ends`, ended?.reason === 'complete' && Math.abs(ended.at - ms(want.frames)) < 0.05,
    `${JSON.stringify(ended)} against ${ms(want.frames).toFixed(2)} ms`)
  if (args.includes('--cache-max-file-bytes')) check(`${label} — ${name}: the file streamed`, streamed)
  after?.(summary, result)
  return result
}

// The plan most cases use: a lead-in, a 1.4 s vamp, and the rest of the file.
const S = 24000 // 500 ms
const E = 91200 // 1900 ms
const VAMP = [
  { startTime: 0, endTime: 500, playCount: 1 },
  { startTime: 500, endTime: 1900, playCount: -1 },
  { startTime: 1900, endTime: 4000, playCount: 1 }
]
const passes = (from, to, count) => Array.from({ length: count }, () => ({ from, to }))
/** Where a slice that runs to 4 s ends: the file's end, where an encoder padded it longer. */
const END = (ref) => Math.min(ref.frames, 4 * RATE)
/** Released 0.7 s into the vamp's tenth pass: the pass plays out, then the rest of the file. */
const RELEASE_TENTH = 500 + 1400 * 9 + 700
const vampPath = (count) => (ref) => [{ from: 0, to: S }, ...passes(S, E, count), { from: E, to: END(ref) }]
/** `--live-only`: the decode thread under load and nothing else — the ThreadSanitizer lane's
 *  part of this file (tsan.mjs), where a slowed engine is held to its counting, not its timing. */
const LIVE_ONLY = process.argv.includes('--live-only')

if (!LIVE_ONLY) {
// --- 1. the vamp, ten times, out of every format, streamed and cached --------------------

console.log('\na 1.4 s vamp looped ten times and released mid-pass: streamed and cached, every format')
for (const name of Object.keys(FILES)) {
  const exact = EXACT_SEEK.has(name)
  for (const [mode, args] of [['cached', []], ['streamed', STREAM]]) {
    holds(`vamp ×10, ${mode}`, name, {
      args,
      slices: VAMP,
      commands: [
        { atMs: 500 + 1400 * 2 + 300, verb: 'progress', cueId: 'a' },
        { atMs: RELEASE_TENTH, verb: 'release', cueId: 'a' }
      ],
      path: vampPath(10),
      after: (summary) => {
        if (name !== 'wav') return
        const progress = reply(summary, 2).result
        check(`vamp ×10, ${mode}: progress names the slice and the pass`, progress?.slice?.index === 1 && progress?.slice?.pass === 3,
          JSON.stringify(progress?.slice))
      }
    })
  }
  // Every jump onto a pad: a 300 ms ring cannot hold a loop, so each wrap lands in the pad
  // the loop was copied into, with the ring parked where it ends.
  holds('vamp ×10, streamed, 300 ms ring', name, {
    args: STREAM_PADS,
    slices: VAMP,
    commands: [{ atMs: RELEASE_TENTH, verb: 'release', cueId: 'a' }],
    path: vampPath(10)
  })
  void exact
}

/** The modes the remaining cases run in: cached, streamed, and streamed onto pads. */
const MODES = [['cached', []], ['streamed', STREAM], ['streamed, 300 ms ring', STREAM_PADS]]
/** 400 ms pieces from the top of the file with these counts, the last running to 4 s. */
const pieces = (...counts) => counts.map((playCount, i) => ({
  startTime: i * 400, endTime: i === counts.length - 1 ? 4000 : (i + 1) * 400, playCount
}))
const P = 19200 // 400 ms

// --- 2. finite counts and a cue's own loop ----------------------------------------------

console.log('\na slice played three times, and a cue looping its own region and the whole file')
for (const name of ['wav', 'mp3']) {
  for (const [mode, args] of MODES) {
    holds(`slice ×3, ${mode}`, name, {
      args,
      slices: [{ startTime: 0, endTime: 500, playCount: 1 }, { startTime: 500, endTime: 1900, playCount: 3 }, { startTime: 1900, endTime: 4000, playCount: 1 }],
      path: (ref) => [{ from: 0, to: S }, ...passes(S, E, 3), { from: E, to: END(ref) }]
    })
    holds(`cue loopCount 4 over 0.5–1.9 s, ${mode}`, name, {
      args,
      options: { startTime: 500, endTime: 1900, loopCount: 4 },
      path: () => passes(S, E, 5)
    })
    // A cue's own vamp released mid-pass: the pass it is in plays on past the loop's end, to
    // the end of the file — from the pad the loop is held in, and on into the parked ring.
    holds(`cue vamp over 0.5–1.9 s released in pass 3, ${mode}`, name, {
      args,
      options: { startTime: 500, endTime: 1900, loopCount: -1 },
      commands: [{ atMs: 1400 * 2 + 700, verb: 'release', cueId: 'a' }],
      path: (ref) => [...passes(S, E, 2), { from: S, to: ref.frames }]
    })
    // The whole file: each wrap leaves the end of the file, where there is nothing to go on
    // to, so the step is read against the waveform's own prediction and the last sample is
    // held under the crossfade.
    holds(`cue loopCount 2 over the whole file, ${mode}`, name, {
      args,
      options: { loopCount: 2 },
      path: (ref) => passes(0, ref.frames, 3),
      seconds: 16
    })
  }
}

// --- 3. skips -------------------------------------------------------------------------------

console.log('\nskips over one and over three pieces that play no times, in every format')
for (const name of Object.keys(FILES)) {
  // The ffmpeg helper's seek lands on its own decode of the place (see EXACT_SEEK): what a
  // landing pad holds is ffmpeg's sound from there, near the straight-through decode but not
  // equal to it. Everywhere a pad is not read from, it is still exact.
  const bound = seekBound(name)
  for (const [mode, args] of MODES) {
    const padded = mode.includes('300 ms')
    holds(`skip over 1, ${mode}`, name, {
      args,
      bound: padded ? bound : EXACT,
      slices: pieces(1, 0, 1),
      commands: [{ atMs: 600, verb: 'progress', cueId: 'a' }],
      path: (ref) => [{ from: 0, to: P }, { from: 2 * P, to: END(ref) }],
      after: (summary) => {
        const progress = reply(summary, 2).result
        check(`skip over 1, ${mode} — ${name}: progress numbers the slice past the skipped one`,
          progress?.slice?.index === 2 && progress?.slice?.pass === 1, JSON.stringify(progress?.slice))
      }
    })
    holds(`skip over 3, ${mode}`, name, {
      args,
      bound: padded ? bound : EXACT,
      slices: pieces(1, 0, 0, 0, 1),
      path: (ref) => [{ from: 0, to: P }, { from: 4 * P, to: END(ref) }]
    })
  }
}

// --- 4. the way out of a vamp -----------------------------------------------------------

console.log('\na devamp mid-pass: into the next piece, and over a skipped one')
for (const name of ['wav', 'mp3', 'm4a']) {
  const bound = seekBound(name)
  for (const [mode, args] of MODES) {
    // Released 1.2 s into the vamp's third pass, which plays out first.
    holds(`devamp in pass 3, ${mode}`, name, {
      args,
      slices: VAMP,
      commands: [{ atMs: 500 + 1400 * 2 + 1200, verb: 'release', cueId: 'a' }],
      path: (ref) => [{ from: 0, to: S }, ...passes(S, E, 3), { from: E, to: END(ref) }]
    })
    holds(`devamp in pass 3 over a skipped piece, ${mode}`, name, {
      args,
      bound: mode.includes('300 ms') ? bound : EXACT,
      slices: [
        { startTime: 0, endTime: 500, playCount: 1 },
        { startTime: 500, endTime: 1900, playCount: -1 },
        { startTime: 1900, endTime: 2300, playCount: 0 },
        { startTime: 2300, endTime: 4000, playCount: 1 }
      ],
      commands: [{ atMs: 500 + 1400 * 2 + 1390, verb: 'release', cueId: 'a' }],
      path: (ref) => [{ from: 0, to: S }, ...passes(S, E, 3), { from: 110400, to: END(ref) }]
    })
  }
}

// --- 5. a very short loop ---------------------------------------------------------------

console.log('\na 50 ms loop, forty-one passes')
for (const name of ['wav', 'mp3', 'ogg']) {
  for (const [mode, args] of MODES) {
    holds(`50 ms vamp, ${mode}`, name, {
      args,
      slices: [{ startTime: 0, endTime: 1000, playCount: 1 }, { startTime: 1000, endTime: 1050, playCount: -1 }, { startTime: 1050, endTime: 4000, playCount: 1 }],
      // 40 passes are done at 3 s; released 25 ms into the 41st.
      commands: [{ atMs: 3025, verb: 'release', cueId: 'a' }],
      path: (ref) => [{ from: 0, to: 48000 }, ...passes(48000, 50400, 41), { from: 50400, to: END(ref) }]
    })
  }
}

// --- 6. a loop longer than the pads -----------------------------------------------------

console.log('\na loop longer than a pad can hold: a 250 ms ring and a 1 MB per-voice budget')
for (const name of ['wav', 'mp3', 'flac']) {
  holds('vamp ×10, pads smaller than the loop', name, {
    args: STREAM_TIGHT,
    slices: VAMP,
    commands: [
      { atMs: 4000, verb: 'info' },
      { atMs: RELEASE_TENTH, verb: 'release', cueId: 'a' }
    ],
    path: vampPath(10),
    after: (summary) => {
      const info = reply(summary, 2).result
      const voice = info.activeCues.find((cue) => cue.cueId === 'a')
      check(`pads smaller than the loop — ${name}: the voice holds no more than its budget`,
        voice !== undefined && voice.streamBytes > 0 && voice.streamBytes <= 1_000_000 && voice.streamBytes === info.media.streamBufferBytes,
        JSON.stringify({ streamBytes: voice?.streamBytes, media: info.media.streamBufferBytes }))
    }
  })
  holds('cue loopCount 2 over the whole file, pads smaller than the loop', name, {
    args: STREAM_TIGHT,
    options: { loopCount: 2 },
    path: (ref) => passes(0, ref.frames, 3),
    seconds: 16
  })
}

// --- 7. starts at an offset, and a load to a later slice ---------------------------------

console.log('\nstarts at an offset, and a seek into a later slice (a Control cue\'s load)')
/** Where a seek sent at `atMs` lands: the top of the block it arrives in. */
const seekFrame = (atMs) => Math.ceil((atMs * RATE) / 1000 / 512) * 512 - 512
for (const name of ['wav', 'mp3', 'flac', 'm4a']) {
  const bound = seekBound(name)
  for (const [mode, args] of MODES) {
    const streamed = mode !== 'cached'
    holds(`start at 2.2 s, in a later slice, ${mode}`, name, {
      args,
      bound: streamed ? bound : EXACT,
      slices: VAMP,
      options: { startTime: 2200 },
      path: (ref) => [{ from: 105600, to: END(ref) }]
    })
    holds(`start at 1.0 s, inside the vamp, ${mode}`, name, {
      args,
      bound: streamed ? bound : EXACT,
      slices: VAMP,
      options: { startTime: 1000 },
      commands: [{ atMs: 900 + 1400 + 300, verb: 'release', cueId: 'a' }],
      path: (ref) => [{ from: 48000, to: E }, ...passes(S, E, 2), { from: E, to: END(ref) }]
    })
    const at = seekFrame(640)
    holds(`seek from the vamp's first pass to 2.5 s, ${mode}`, name, {
      args,
      bound: streamed ? bound : EXACT,
      slices: VAMP,
      commands: [{ atMs: 640, verb: 'seek', cueId: 'a', positionMs: 2500 }, { atMs: 700, verb: 'progress', cueId: 'a' }],
      path: (ref) => [{ from: 0, to: at }, { from: 120000, to: END(ref), length: END(ref) - E }],
      after: (summary) => {
        const progress = reply(summary, 3).result
        check(`seek to a later slice, ${mode} — ${name}: progress is in slice 3, pass 1`,
          progress?.slice?.index === 2 && progress?.slice?.pass === 1, JSON.stringify(progress?.slice))
      }
    })
  }
  // A seek back behind the ring lands on a pad of 1 s while the ring, full and 300 ms long, is
  // already linear towards the pad's end. Nothing reads the ring while the voice plays the pad,
  // so unless the frames before the hand-over are let go it stays parked where the seek found
  // it: here its last frame is 388 frames past the hand-over, which falls 92 frames into a
  // 512-frame block, and the voice ran off the ring before the next decode pass — the nightly
  // soak's underrun (a seek to a streamed cue's start, a quarter of a second after it began).
  const at = seekFrame(1000)
  holds('seek back behind a full ring, its last frame inside the hand-over\'s block', name, {
    args: STREAM_PADS,
    bound,
    commands: [{ atMs: 1000, verb: 'seek', cueId: 'a', positionMs: 290 }],
    // No slices: the voice plays to the file's own end, which for AAC is past 4 s.
    path: (ref) => [{ from: 0, to: at }, { from: 13920, to: ref.played }]
  })
}
}

// --- 8. a real decode thread under load -------------------------------------------------

/** One engine on the silent backend, driven over its socket, its output captured. */
async function liveEngine(extraArgs) {
  const socketPath = join(workDir, `engine-${Math.floor(Math.random() * 1e9)}.sock`)
  const capturePath = join(workDir, `capture-${Math.floor(Math.random() * 1e9)}.wav`)
  const child = spawn(binary, [
    '--socket', socketPath, '--backend', 'silent', '--sample-rate', String(RATE), '--channels', '2',
    '--buffer-frames', '512', '--capture', capturePath, ...extraArgs
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  let socket = null
  for (const deadline = Date.now() + 8000; socket === null && Date.now() < deadline;) {
    socket = await new Promise((resolveSocket) => {
      const attempt = connect(socketPath)
      attempt.once('connect', () => resolveSocket(attempt))
      attempt.once('error', () => { attempt.destroy(); setTimeout(() => resolveSocket(null), 50) })
    })
  }
  if (socket === null) throw new Error(`the engine never accepted a connection\n${stderr}`)
  let buffer = ''
  let nextId = 1
  const pending = new Map()
  const events = []
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let message
      try { message = JSON.parse(line) } catch { continue }
      const waiter = message.id !== undefined ? pending.get(message.id) : undefined
      if (message.event !== undefined) events.push(message.event)
      if (waiter === undefined) continue
      pending.delete(message.id)
      if (message.ok === false) waiter.reject(new Error(JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    }
  })
  const request = (verb, params = {}) => {
    const id = nextId++
    const { promise, resolve: done, reject } = Promise.withResolvers()
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`no answer to ${verb}`)) }, 10000)
    pending.set(id, { resolve: (value) => { clearTimeout(timer); done(value) }, reject: (error) => { clearTimeout(timer); reject(error) } })
    socket.write(`${JSON.stringify({ id, verb, ...params })}\n`)
    return promise
  }
  const close = async () => {
    socket.destroy()
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await new Promise((done) => { child.once('exit', done); setTimeout(done, 3000) })
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    return readFloatWav(capturePath)
  }
  /** The `ended` event for `cueId`, once it has come (or null after `timeoutMs`). */
  const ended = async (cueId, timeoutMs = 10000) => {
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(20)) {
      const event = events.find((entry) => entry.type === 'ended' && entry.cueId === cueId)
      if (event !== undefined) return event
    }
    return null
  }
  return { request, close, ended, stderr: () => stderr }
}

const sleep = (time) => new Promise((done) => setTimeout(done, time))
const VOICES = 24
/** What the other voices play: half of them vamps out of the fixtures, half a long file
 *  straight through, which keeps the decode thread reading for as long as the run lasts. */
const LONG = join(workDir, 'long.wav')
writeWav16(LONG, 40 * RATE)
const LOADED = ['wav', 'flac', 'ogg', 'mp3']

/**
 * 24 streamed voices at once on the real decode thread, each with a ring and pads of its own
 * — one heard, the MP3 vamp, and 23 at no level: vamps in the other formats and long files
 * read straight through — for `seconds`. The heard one is held to its path from the first
 * frame it played; where the disk could not keep up, every frame of silence it has must be an
 * underrun the engine counted.
 */
async function underLoad(label, extraArgs, seconds, { requireClean }) {
  const engine = await liveEngine(['--cache-max-file-bytes', '1', ...extraArgs])
  let underruns = 0
  let played = null
  let wav = null
  try {
    const straight = (voice) => voice > 0 && voice % 2 === 1
    for (let voice = 0; voice < VOICES; voice++) {
      const filePath = voice === 0 ? FILES.mp3 : straight(voice) ? LONG : FILES[LOADED[voice % LOADED.length]]
      await engine.request('prepare', { cueId: `v${voice}`, filePath })
    }
    for (let voice = 0; voice < VOICES; voice++) {
      const options = straight(voice) ? { ...START, volume: 0 } : { ...START, volume: voice === 0 ? 1 : 0, slices: VAMP }
      await engine.request('start', { cueId: `v${voice}`, whenMs: 0, options })
    }
    await sleep(seconds * 1000)
    const info = await engine.request('info')
    underruns = info.media.decodeUnderruns
    check(`${label}: all ${VOICES} voices are streaming`, info.media.streamingVoices === VOICES, `${info.media.streamingVoices} streaming`)
    // Where on the engine's clock the heard voice began, and where the stop ended it: the
    // frames it played between, which is the span held to its path — however long the engine
    // then takes to wind down, the silence after the stop is not the voice's.
    const progress = await engine.request('progress', { cueId: 'v0' })
    await engine.request('stopAll', { fadeMs: 0 })
    const end = await engine.ended('v0')
    played = progress !== null && end !== null ? Math.round(((end.at - progress.startedAtMs) * RATE) / 1000) : null
    check(`${label}: the heard voice's start and stop are known`, played !== null, JSON.stringify({ progress, end }))
  } finally {
    wav = await engine.close()
  }
  const ref = reference('mp3')
  let start = 0
  while (start < wav.frames && wav.samples[start * 2] === 0 && wav.samples[start * 2 + 1] === 0) start++
  // The heard voice's own path, from its first frame to the frame the stop ended it on.
  const heard = Math.max(0, Math.min(played ?? 0, wav.frames - start))
  const passesHeard = Math.ceil(heard / (E - S)) + 1
  const want = expected(ref, [{ from: 0, to: S }, ...passes(S, E, passesHeard)])
  const length = Math.min(heard, want.frames)
  const result = compare({ frames: length, samples: wav.samples.subarray(start * 2, (start + length) * 2) },
    { ...want, frames: length, joins: want.joins.filter((join) => join.frame < length) })
  // The signal is never zero on both channels at once for long: count every frame of the heard
  // span that is.
  let silent = 0
  for (let t = start; t < start + length; t++) if (wav.samples[t * 2] === 0 && wav.samples[t * 2 + 1] === 0) silent++
  let natural = 0
  for (let t = 0; t < length; t++) if (want.out[t * 2] === 0 && want.out[t * 2 + 1] === 0) natural++
  const wraps = result.atJoin.length
  console.log(`    ${label}: ${(length / RATE).toFixed(1)} s heard, ${wraps} wraps, max error at the joins ` +
    `${fmt(result.worstJoin)}, elsewhere ${fmt(result.elsewhere)}; ${silent - natural} frames of silence; ${underruns} underruns counted`)
  if (requireClean) {
    check(`${label}: the heard vamp is its path, sample for sample`, result.worst <= EXACT,
      `worst ${fmt(result.worst)}, first frame off at ${result.firstBad}`)
    check(`${label}: no silence and no underrun`, silent - natural === 0 && underruns === 0, `${silent - natural} silent frames, ${underruns} underruns`)
  } else {
    check(`${label}: every frame of silence is a counted underrun`, silent - natural <= underruns,
      `${silent - natural} silent frames against ${underruns} underruns`)
  }
  check(`${label}: the heard voice wrapped`, wraps >= 3, `${wraps} wraps`)
}

console.log('\n24 streamed vamps on the real decode thread')
await underLoad('24 voices', [], 8, { requireClean: !LIVE_ONLY })
// A disk that answers every read late: 3 ms a read keeps up; 12 ms a read cannot.
await underLoad('24 voices, 3 ms a read', ['--test-read-delay-us', '3000'], 8, { requireClean: false })
await underLoad('24 voices, 12 ms a read', ['--test-read-delay-us', '12000'], 8, { requireClean: false })

finish()
