// What the audio-io specs share: a tone written to a file, a show written around cues, an app
// opened on it with the engine's output teed to a WAV, and that WAV read one channel at a time.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { launchApp, openFromRecent } from './helpers'

/** A 16-bit sine file: `seconds` long, at `levelDb` dBFS peak, on every channel. */
export function writeSineWav(filePath: string, { seconds = 20, channels = 2, levelDb = -6, hz = 440 } = {}): void {
  const sampleRate = 48000
  const frames = Math.round(sampleRate * seconds)
  const dataBytes = frames * channels * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * channels * 2, 28)
  buffer.writeUInt16LE(channels * 2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  const amplitude = Math.pow(10, levelDb / 20) * 32767
  let offset = 44
  for (let i = 0; i < frames; i++) {
    const value = Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * amplitude)
    for (let c = 0; c < channels; c++) {
      buffer.writeInt16LE(value, offset)
      offset += 2
    }
  }
  writeFileSync(filePath, buffer)
}

/** A cue's common fields, for a show written by hand. */
export function cueBase(id: string, number: string, name: string): Record<string, unknown> {
  return {
    id, number, name, colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
    duration: 0, advance: 'none', isArmed: true, notes: ''
  }
}

/** An audio cue on `filePath`, with any field of its own. */
export function audioCue(id: string, number: string, name: string, filePath: string, extra: Record<string, unknown> = {}) {
  return {
    ...cueBase(id, number, name), type: 'audio', filePath, startTime: 0, endTime: null, fadeInDuration: 0,
    volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1, ...extra
  }
}

export interface Opened {
  app: ElectronApplication
  page: Page
  root: string
  capturePath: string
}

/**
 * Writes a show and opens it with the engine's output teed to a WAV the spec can read. The
 * directory is named for the branch, so a sibling's run on this machine never shares it.
 */
export async function openShow(
  testInfo: TestInfo,
  name: string,
  show: { audioSettings?: Record<string, unknown>; cues: unknown[] },
  env: Record<string, string> = {}
): Promise<Opened> {
  const root = mkdtempSync(path.join(tmpdir(), 'cuerunner-audio-io-e2e-'))
  const showPath = path.join(root, `${name}.cuerunner`)
  writeFileSync(showPath, `${JSON.stringify({
    version: 1, id: `w-${name}`, name, createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default', ...(show.audioSettings ?? {}) },
    midiSettings: { outputPortName: '' },
    cues: show.cues
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  mkdirSync(userDataDir, { recursive: true })
  const capturePath = testInfo.outputPath('engine-output.wav')
  const { app, page } = await launchApp({ userDataDir, env: { CUERUNNER_TEST_AUDIO_CAPTURE: capturePath, ...env } })
  await openFromRecent(page, userDataDir, showPath)
  return { app, page, root, capturePath }
}

/** The channel count and rate of the tee, and its frames, read past a header still being written. */
function readCapture(filePath: string): { channels: number; sampleRate: number; frames: number; buffer: Buffer } {
  const buffer = readFileSync(filePath)
  const channels = buffer.length > 24 ? buffer.readUInt16LE(22) || 2 : 2
  const sampleRate = buffer.length > 28 ? buffer.readUInt32LE(24) || 48000 : 48000
  const frames = Math.max(0, Math.floor((buffer.length - 44) / (4 * channels)))
  return { channels, sampleRate, frames, buffer }
}

/** The peak of each output channel over the last `windowMs` of the engine's output. */
export function capturedChannelPeaks(filePath: string, windowMs: number): number[] {
  let capture: ReturnType<typeof readCapture>
  try {
    capture = readCapture(filePath)
  } catch {
    return []
  }
  const { channels, sampleRate, frames, buffer } = capture
  const peaks = new Array<number>(channels).fill(0)
  const windowFrames = Math.min(frames, Math.ceil((sampleRate * windowMs) / 1000))
  for (let frame = frames - windowFrames; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.abs(buffer.readFloatLE(44 + (frame * channels + channel) * 4))
      if (sample > peaks[channel]) peaks[channel] = sample
    }
  }
  return peaks.map(peak => Number(peak.toFixed(3)))
}
