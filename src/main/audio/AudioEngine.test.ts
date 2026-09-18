/**
 * The main-process audio client, exercised against the real engine executable in its
 * silent backend: the same protocol, mixer, scheduler and events the app uses, with no
 * device involved. The engine binary is built on demand (npm run build:native).
 *
 * This is an integration test against a real-time audio process, so the few waits here
 * poll a condition the engine actually reports (progress, snapshot, events) rather than
 * sleeping for a guessed duration.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AudioEngineError, NativeAudioEngine, audioEngine } from './AudioEngine'
import { AUDIO_LIMITS, AUDIO_PROTOCOL_VERSION } from '../../shared/audio'
import type { AudioEndedEvent, AudioEngineEvent, AudioErrorEvent, AudioStartOptions } from '../../shared/audio'

const repoRoot = resolve(__dirname, '..', '..', '..')
const binaryName = process.platform === 'win32' ? 'cuerunner-audio.exe' : 'cuerunner-audio'
const binaryPath = join(repoRoot, 'native', 'audio', 'build', binaryName)
const engineMissing = join(repoRoot, 'native', 'audio', 'build', 'not-an-engine')

function ensureBinary(): string {
  if (!existsSync(binaryPath)) {
    execFileSync('node', [join(repoRoot, 'scripts', 'build-native-audio.mjs')], { stdio: 'inherit', timeout: 600_000 })
  }
  if (!existsSync(binaryPath)) throw new Error(`audio engine did not build; expected ${binaryPath}`)
  return binaryPath
}

function writeFloatWav(path: string, channels: number, sampleRate: number, frames: number, sample: number): void {
  const dataBytes = frames * channels * 4
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(3, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * 4, 28)
  buffer.writeUInt16LE(channels * 4, 32)
  buffer.writeUInt16LE(32, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames * channels; i++) buffer.writeFloatLE(sample, 44 + i * 4)
  writeFileSync(path, buffer)
}

/** A WAV of one shape: the sample at each frame comes from `sampleAt`, so a test can put
 *  a tone in one second of silence and ask the engine about that second. */
function writeFloatWavShape(
  path: string,
  channels: number,
  sampleRate: number,
  frames: number,
  sampleAt: (frame: number) => number
): void {
  const dataBytes = frames * channels * 4
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(3, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * 4, 28)
  buffer.writeUInt16LE(channels * 4, 32)
  buffer.writeUInt16LE(32, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let frame = 0; frame < frames; frame++) {
    const value = sampleAt(frame)
    for (let channel = 0; channel < channels; channel++) {
      buffer.writeFloatLE(value, 44 + (frame * channels + channel) * 4)
    }
  }
  writeFileSync(path, buffer)
}

/** Polls a condition the engine reports; hangs are the engine's fault, not a sleep guess. */
async function waitUntil<T>(describe: string, probe: () => Promise<T | null>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== null) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${describe}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function loopOptions(): AudioStartOptions {
  return {
    startTime: 0,
    endTime: null,
    loopCount: -1,
    rate: 1,
    trim: 1,
    volume: 1,
    pan: 0,
    fadeInDuration: 0,
    outputs: null
  }
}

const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-engine-client-'))
const workFilePath = join(workDir, 'one-second.wav')
const events: AudioEngineEvent[] = []

beforeAll(async () => {
  process.env.CUERUNNER_AUDIO_BIN = ensureBinary()
  process.env.CUERUNNER_AUDIO_BACKEND = 'silent'
  writeFloatWav(workFilePath, 2, 48000, 48000, 0.5)
  audioEngine.subscribe((event) => events.push(event))
  await audioEngine.ensureStarted()
}, 600_000)

afterAll(async () => {
  await audioEngine.shutdown()
  rmSync(workDir, { recursive: true, force: true })
})

describe('audioEngine client (against the real engine)', () => {
  it('reports the engine it actually started', async () => {
    const info = await audioEngine.info()
    expect(info.protocol).toBe(AUDIO_PROTOCOL_VERSION)
    expect(info.sessionId).toMatch(/^[0-9a-f]{16}$/)
    expect(info.backend).toBe('silent')
    expect(info.sampleRate).toBe(48000)
    expect(info.active).toBe(false)
    expect(info.latencySource).toBe('unknown')
    expect(audioEngine.status().connected).toBe(true)
  })

  it('advances the sample clock without a device', async () => {
    const first = (await audioEngine.clock()).clockMs
    const second = await waitUntil('the clock to advance', async () => {
      const value = (await audioEngine.clock()).clockMs
      return value > first ? value : null
    })
    expect(second).toBeGreaterThan(first)
  })

  it('names the session every time it reports, so a reading can be trusted', async () => {
    const info = await audioEngine.info()
    const reading = await audioEngine.clock()
    expect(reading.sessionId).toBe(info.sessionId)

    // Events carry it too: a listener can tell which engine produced a line even when
    // the process was replaced under it.
    await audioEngine.prepare('s1', workFilePath)
    await audioEngine.start('s1', (await audioEngine.clock()).clockMs + 10, loopOptions())
    await audioEngine.stop('s1', 0)
    const ended = await waitUntil('the ended event', async () =>
      events.find((event) => event.type === 'ended' && event.cueId === 's1') ?? null
    )
    expect(ended.sessionId).toBe(info.sessionId)
  })

  it('prepares, plays, reports progress and stops with events carrying the run id', async () => {
    const metadata = await audioEngine.prepare('a1', workFilePath)
    expect(metadata).toMatchObject({ sampleRate: 48000, channels: 2, frames: 48000, format: 'wav' })

    const start = await audioEngine.start('a1', (await audioEngine.clock()).clockMs + 10, loopOptions())
    expect(start.runId).toMatch(/^run-/)
    expect(audioEngine.snapshot()?.active).toBe(true)

    const progress = await waitUntil('progress past 50ms', async () => {
      const value = await audioEngine.progress('a1')
      return value !== null && value.elapsedMs > 50 ? value : null
    })
    expect(progress.runId).toBe(start.runId)
    expect(progress.playing).toBe(true)

    await audioEngine.stop('a1', 0)
    const stopped = await waitUntil('the ended event', async () =>
      events.find((event) => event.type === 'ended' && event.cueId === 'a1') ?? null
    )
    expect(stopped).toMatchObject({ runId: start.runId, reason: 'stopped' })
    await waitUntil('the voice to disappear', async () => ((await audioEngine.progress('a1')) === null ? true : null))
    await waitUntil('the active indicator to clear', async () => (audioEngine.snapshot()?.active === false ? true : null))
  })

  it('schedules a future start and cancels it before it is audible', async () => {
    await audioEngine.prepare('a2', workFilePath)
    const start = await audioEngine.start('a2', (await audioEngine.clock()).clockMs + 400, loopOptions())
    expect(start.state).toBe('scheduled')
    const canceled = await audioEngine.cancel('a2')
    expect(canceled.canceled).toBeGreaterThanOrEqual(1)
    await waitUntil('the cancelled run to end', async () =>
      events.find((event) => event.type === 'ended' && event.runId === start.runId && event.reason === 'cancelled') ?? null
    )
    await expect(audioEngine.progress('a2')).resolves.toBeNull()
  })

  it('refuses a start that was never prepared, with the engine error code', async () => {
    await expect(audioEngine.start('missing', 0, loopOptions())).rejects.toMatchObject({ code: 'not-prepared' })
    await expect(audioEngine.start('missing', 0, loopOptions())).rejects.toBeInstanceOf(AudioEngineError)
  })

  it('moves a live matrix with routing() and reports what panic silenced', async () => {
    await audioEngine.prepare('a3', workFilePath)
    await audioEngine.start('a3', (await audioEngine.clock()).clockMs + 10, loopOptions())
    await waitUntil('a3 to play', async () => {
      const progress = await audioEngine.progress('a3')
      return progress !== null && progress.playing ? progress : null
    })
    await expect(audioEngine.routing('a3', [{ inputChannel: 0, outputChannel: 0, gain: 0.25 }])).resolves.toMatchObject({ applied: true })
    await expect(audioEngine.routing('a3', null)).resolves.toMatchObject({ applied: true })

    const panic = await audioEngine.panic(0)
    expect(panic.stoppedVoices).toBeGreaterThanOrEqual(1)
    await waitUntil('the panic event', async () => events.find((event) => event.type === 'panic') ?? null)
    await waitUntil('the engine to go quiet', async () => (audioEngine.snapshot()?.active === false ? true : null))
  })

  it('probes media metadata without decoding it into the cache', async () => {
    const before = await audioEngine.info()
    const probe = await audioEngine.probe(workFilePath)
    expect(probe).toMatchObject({ format: 'wav', sampleRate: 48000, channels: 2, frames: 48000 })
    expect(probe.decodedBytes).toBe(48000 * 2 * 4)
    expect(probe.streaming).toBe(false)
    const after = await audioEngine.info()
    // Measuring must not fill, pin, evict or count anything.
    expect(after.cache.entries).toBe(before.cache.entries)
    expect(after.cache.misses).toBe(before.cache.misses)
    expect(after.cache.bypassed).toBe(before.cache.bypassed)
    expect(after.media.residentBytes).toBe(before.media.residentBytes)
  })

  it('returns bounded waveform peaks for a file', async () => {
    const waveform = await audioEngine.waveform(workFilePath, 32)
    expect(waveform.buckets).toBe(32)
    expect(waveform.values).toHaveLength(64)
    expect(waveform.values[0]).toBeCloseTo(0.5, 3)
    expect(waveform.values[1]).toBeCloseTo(0.5, 3)
    const clamped = await audioEngine.waveform(workFilePath, AUDIO_LIMITS.maxWaveformPoints.value + 1)
    expect(clamped.buckets).toBe(AUDIO_LIMITS.maxWaveformPoints.value)
    expect(clamped.truncated).toBe(true)
  })

  it('answers for a window of a file rather than for the whole of it', async () => {
    // Four seconds: silence, then a second of tone, then silence. Asking about the second
    // second has to describe that second — a region the engine ignored would come back as
    // the whole file, and the panel would draw the quiet parts where the loud one is.
    const shaped = join(workDir, 'four-seconds.wav')
    const sampleRate = 48000
    writeFloatWavShape(shaped, 2, sampleRate, 4 * sampleRate, frame => {
      const second = Math.floor(frame / sampleRate)
      return second === 1 ? 0.5 : 0
    })

    const tone = await audioEngine.waveform(shaped, 64, { startMs: 1000, endMs: 2000 })
    expect(tone.startMs).toBe(1000)
    expect(tone.endMs).toBe(2000)
    expect(tone.durationMs).toBeCloseTo(4000, 0)
    expect(tone.sampled).toBe(false)
    expect(Math.max(...tone.values)).toBeCloseTo(0.5, 2)

    const silence = await audioEngine.waveform(shaped, 64, { startMs: 0, endMs: 1000 })
    expect(Math.max(...silence.values.map(Math.abs))).toBeLessThan(0.01)
  })

  it('reports an onset inside a window as a time in the file', async () => {
    // The attack is at one second. The detector counts from the first sample it is fed,
    // so an answer that was not put back on the file's own clock would land at the top of
    // the window instead of at the note.
    const shaped = join(workDir, 'four-seconds.wav')
    const sampleRate = 48000
    writeFloatWavShape(shaped, 2, sampleRate, 4 * sampleRate, frame => {
      const second = Math.floor(frame / sampleRate)
      return second === 1 ? Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 0.6 : 0
    })

    const onsets = await audioEngine.onsets(shaped, 1, 2000, { startMs: 900, endMs: 2100 })
    expect(onsets.startMs).toBe(900)
    expect(onsets.endMs).toBe(2100)
    expect(onsets.onsetsMs.length).toBeGreaterThan(0)
    expect(onsets.onsetsMs[0]).toBeGreaterThan(950)
    expect(onsets.onsetsMs[0]).toBeLessThan(1100)
  })

  it('measures where a file sound starts and stops, so a trim has edges to cut at', async () => {
    // Three seconds: silence, a second of tone, silence. The bounds have to land on the
    // tone — a scan that answered the file's own edges would leave the trim nothing to
    // drop, and one that answered anywhere else would cut into the cue.
    const shaped = join(workDir, 'tone-in-the-middle.wav')
    const sampleRate = 48000
    writeFloatWavShape(shaped, 2, sampleRate, 3 * sampleRate, frame => {
      const second = Math.floor(frame / sampleRate)
      return second === 1 ? Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 0.6 : 0
    })

    const silence = await audioEngine.silence(shaped)
    expect(silence.silent).toBe(false)
    expect(silence.sampleRate).toBe(sampleRate)
    expect(silence.channels).toBe(2)
    expect(silence.durationMs).toBeCloseTo(3000, 3)
    expect(silence.startMs).toBeGreaterThanOrEqual(1000)
    expect(silence.startMs).toBeLessThan(1002)
    expect(silence.endMs).toBeGreaterThan(1998)
    expect(silence.endMs).toBeLessThanOrEqual(2000)
  })

  it('answers a file that is silent end to end with its whole length as the bounds', async () => {
    // A file with no sound in it has no silence at its edges to trim: the bounds are the
    // whole file, so a cue playing it still plays the cue rather than nothing at all.
    const quiet = join(workDir, 'silent.wav')
    const sampleRate = 48000
    writeFloatWavShape(quiet, 2, sampleRate, 2 * sampleRate, () => 0)

    const silence = await audioEngine.silence(quiet)
    expect(silence.silent).toBe(true)
    expect(silence.startMs).toBe(0)
    expect(silence.durationMs).toBeCloseTo(2000, 3)
    expect(silence.endMs).toBe(silence.durationMs)
    expect(silence.sampleRate).toBe(sampleRate)
    expect(silence.channels).toBe(2)
  })

  it('clamps a threshold outside the workable range rather than refusing it', async () => {
    // A scan is bounded work, so a nonsense threshold is put back on the range and
    // answered: a typo must not be the one thing that stops a cue's trim from arriving.
    const shaped = join(workDir, 'tone-in-the-middle.wav')
    const sampleRate = 48000
    writeFloatWavShape(shaped, 2, sampleRate, 2 * sampleRate, frame => (frame >= sampleRate ? 0.5 : 0))

    // Far below what any converter can represent: clamped to the floor, where digital
    // silence is still below the line, so the bounds are the tone's own.
    const tooLow = await audioEngine.silence(shaped, -1000)
    expect(tooLow.silent).toBe(false)
    expect(tooLow.startMs).toBeGreaterThanOrEqual(1000)
    expect(tooLow.startMs).toBeLessThan(1002)
    expect(tooLow.endMs).toBeGreaterThan(1998)
    expect(tooLow.endMs).toBeLessThanOrEqual(2000)

    // Above full scale, where nothing in a normalised file can cross: clamped to 0 dBFS,
    // which answers with a file whose samples never rose above the line.
    const tooHigh = await audioEngine.silence(shaped, 1000)
    expect(tooHigh.silent).toBe(true)
    expect(tooHigh.startMs).toBe(0)
    expect(tooHigh.endMs).toBe(tooHigh.durationMs)
  })

  it('releases a loop out to the end the trim names, not to the end of the file', async () => {
    // A cue trimmed of its trailing silence releases to where its sound stops. The voice
    // loops a region of a three-second file, so the run's own length says which end it
    // played to: the named end is 700 ms after the top of the region, and a release that
    // had ignored it would play the region out to 2500 ms.
    const shaped = join(workDir, 'release-end.wav')
    const sampleRate = 48000
    writeFloatWavShape(shaped, 2, sampleRate, 3 * sampleRate, () => 0.5)
    await audioEngine.prepare('r2', shaped)
    const started = await audioEngine.start('r2', (await audioEngine.clock()).clockMs + 10, {
      ...loopOptions(),
      startTime: 500,
      endTime: 2500
    })
    await waitUntil('r2 to play', async () => {
      const progress = await audioEngine.progress('r2')
      return progress !== null && progress.playing ? progress : null
    })

    const released = await audioEngine.release('r2', undefined, 1200)
    expect(released.applied).toBe(true)
    const ended = await waitUntil('the released run to end', async () =>
      events.find((event): event is AudioEndedEvent => event.type === 'ended' && event.runId === started.runId) ?? null
    )
    expect(ended.reason).toBe('complete')
    const playedMs = ended.at - started.startAtMs
    expect(playedMs).toBeGreaterThan(600)
    expect(playedMs).toBeLessThan(1500)
  })

  it('finishes a loop a release names an end behind, rather than playing past it', async () => {
    // A trimmed vamp whose loop has already carried it past the end its trim names has
    // nothing left to play: the run ends where it stands rather than being left to play
    // the rest of its region — 2000 ms of it — and on into the file's own tail.
    const shaped = join(workDir, 'release-end.wav')
    await audioEngine.prepare('r3', shaped)
    const started = await audioEngine.start('r3', (await audioEngine.clock()).clockMs + 10, {
      ...loopOptions(),
      startTime: 500,
      endTime: 2500
    })
    await waitUntil('r3 to pass the end its release will name', async () => {
      const progress = await audioEngine.progress('r3')
      return progress !== null && progress.elapsedMs > 900 ? progress : null
    })

    const released = await audioEngine.release('r3', undefined, 700)
    expect(released.applied).toBe(true)
    const ended = await waitUntil('the released run to end', async () =>
      events.find((event): event is AudioEndedEvent => event.type === 'ended' && event.runId === started.runId) ?? null
    )
    expect(ended.reason).toBe('complete')
    expect(ended.at - started.startAtMs).toBeLessThan(1200)
  })

  it('carries a device loss to the desk as the engine’s own reason, untranslated', async () => {
    // What the engine says about a lost device is what the desk must read: `device-lost`
    // for the voice that was sounding, with the fault line beside it as an error the
    // operator sees, and the panic the engine queued behind it. This client's job is to
    // pass them through — a reason rewritten or dropped here would leave the renderer's
    // release with nothing to act on.
    const instance = new NativeAudioEngine()
    const seen: AudioEngineEvent[] = []
    instance.subscribe((event) => seen.push(event))
    try {
      await instance.ensureStarted()
      await instance.prepare('lost', workFilePath)
      const started = await instance.start('lost', 0, loopOptions())
      await waitUntil('the voice to play', async () => ((await instance.progress('lost'))?.elapsedMs ?? 0) > 0 || null)

      await instance.simulateDeviceLossForTest()

      const ended = await waitUntil('the lost voice to end', async () =>
        seen.find(
          (event): event is AudioEndedEvent => event.type === 'ended' && event.runId === started.runId
        ) ?? null
      )
      expect(ended.reason).toBe('device-lost')
      const fault = seen.find(
        (event): event is AudioErrorEvent => event.type === 'error' && event.code === 'device'
      )
      expect(fault?.cueId).toBeNull()
      expect(fault?.message).toMatch(/stopped unexpectedly/)
      // The panic rides beside it, as the line that clears what the ends left behind;
      // it is written after the ends, so under load it lands a tick later than they do.
      await waitUntil('the panic behind the loss', async () =>
        seen.some((event) => event.type === 'panic') || null
      )
    } finally {
      await instance.shutdown()
    }
  })

  it('fails loudly, and leaks no child, when the engine executable is missing', async () => {
    const previous = process.env.CUERUNNER_AUDIO_BIN
    process.env.CUERUNNER_AUDIO_BIN = engineMissing
    const instance = new NativeAudioEngine()
    await expect(instance.ensureStarted()).rejects.toMatchObject({ code: 'engine' })
    expect(instance.status().connected).toBe(false)
    expect(instance.snapshot()).toBeNull()
    process.env.CUERUNNER_AUDIO_BIN = previous
  })
  it('revives a dead engine from configure, and still refuses honestly when it cannot', async () => {
    // A restart budget spent at boot (or after three crashes) leaves no engine to talk
    // to; configure is the operator's lever, so it must be the one verb that re-enters
    // ensureStarted. First the refusal: with no engine binary, configure fails at the
    // start, not with a not-running shrug. Then the revival: with the real binary, the
    // same verb reaches a live engine — which, in this suite's silent backend, answers
    // the device request with its honest refusal, proof the connection exists.
    const revived = new NativeAudioEngine()
    try {
      process.env.CUERUNNER_AUDIO_BIN = engineMissing
      await expect(revived.configure({})).rejects.toMatchObject({ code: 'engine' })
      expect(revived.status().connected).toBe(false)
      process.env.CUERUNNER_AUDIO_BIN = binaryPath
      await expect(revived.configure({})).rejects.toMatchObject({ code: 'device' })
      expect(revived.status().connected).toBe(true)
      const info = await revived.info()
      expect(info.protocol).toBe(AUDIO_PROTOCOL_VERSION)
    } finally {
      process.env.CUERUNNER_AUDIO_BIN = binaryPath
      await revived.shutdown()
    }
  })
})
