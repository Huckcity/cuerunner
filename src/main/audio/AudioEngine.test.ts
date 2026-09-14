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
import type { AudioEngineEvent, AudioStartOptions } from '../../shared/audio'

const repoRoot = resolve(__dirname, '..', '..', '..')
const binaryName = process.platform === 'win32' ? 'winslab-audio.exe' : 'winslab-audio'
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

const workDir = mkdtempSync(join(tmpdir(), 'winslab-engine-client-'))
const workFilePath = join(workDir, 'one-second.wav')
const events: AudioEngineEvent[] = []

beforeAll(async () => {
  process.env.WINSLAB_AUDIO_BIN = ensureBinary()
  process.env.WINSLAB_AUDIO_BACKEND = 'silent'
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
    expect(info.protocol).toBe(2)
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
    const clamped = await audioEngine.waveform(workFilePath, 100000)
    expect(clamped.buckets).toBe(4096)
    expect(clamped.truncated).toBe(true)
  })

  it('fails loudly, and leaks no child, when the engine executable is missing', async () => {
    const previous = process.env.WINSLAB_AUDIO_BIN
    process.env.WINSLAB_AUDIO_BIN = engineMissing
    const instance = new NativeAudioEngine()
    await expect(instance.ensureStarted()).rejects.toMatchObject({ code: 'engine' })
    expect(instance.status().connected).toBe(false)
    expect(instance.snapshot()).toBeNull()
    process.env.WINSLAB_AUDIO_BIN = previous
  })
})
