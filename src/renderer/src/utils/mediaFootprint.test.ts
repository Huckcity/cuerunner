// The workspace estimate is arithmetic over engine metadata: it must never turn a file
// that streams into one that is "held", and it must not claim a number the metadata
// cannot support.
import { describe, it, expect } from 'vitest'
import {
  decodedBytesFor,
  distinctMediaPaths,
  formatBytes,
  summariseFootprint
} from './mediaFootprint'
import type { AudioProbe } from '../../../shared/audio'
import type { Cue, WaitCue } from '../types/cue'

const MB = 1024 * 1024

function probe(overrides: Partial<AudioProbe> = {}): AudioProbe {
  return {
    filePath: '/shows/a.wav',
    format: 'wav',
    durationMs: 60_000,
    sampleRate: 48000,
    channels: 2,
    frames: 60 * 48000,
    fileBytes: 11 * MB,
    decodedBytes: 23 * MB,
    streaming: false,
    resident: false,
    ...overrides
  }
}

function waitCue(id: string): WaitCue {
  return {
    id, number: id, name: id, type: 'wait',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 1000,
    advance: 'none', isArmed: true, notes: ''
  }
}

function audioCue(id: string, filePath: string): Cue {
  return {
    ...waitCue(id),
    type: 'audio',
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 1
  }
}

describe('decodedBytesFor', () => {
  it('takes the engine’s own figure as it stands', () => {
    expect(decodedBytesFor(probe({ decodedBytes: 12_345, frames: 1 }))).toBe(12_345)
  })

  it('estimates from the stated length when the container states no frame count', () => {
    // 10 s of 48 kHz stereo float32.
    expect(decodedBytesFor(probe({ decodedBytes: null, durationMs: 10_000, sampleRate: 48000, channels: 2 })))
      .toBe(10 * 48000 * 2 * 4)
  })

  it('refuses to guess when there is nothing to go on', () => {
    expect(decodedBytesFor(probe({ decodedBytes: null, durationMs: 0 }))).toBe(0)
    expect(decodedBytesFor(probe({ decodedBytes: null, sampleRate: 0 }))).toBe(0)
  })
})

describe('distinctMediaPaths', () => {
  it('keeps the order, drops repeats, and ignores cues with no media', () => {
    const paths = distinctMediaPaths([
      audioCue('a1', '/shows/a.wav'),
      waitCue('w1'),
      audioCue('a2', '/shows/b.wav'),
      audioCue('a3', '/shows/a.wav'),
      audioCue('a4', '')
    ])
    expect(paths).toEqual(['/shows/a.wav', '/shows/b.wav'])
  })
})

describe('summariseFootprint', () => {
  const budget = { limitBytes: 512 * MB, maxFileBytes: 32 * MB }

  it('says nothing when the media fits and nothing has to stream', () => {
    const footprint = summariseFootprint([probe(), probe({ filePath: '/shows/b.wav' })], budget, 2)
    expect(footprint.warning).toBeNull()
    expect(footprint.streaming).toBe(0)
    expect(footprint.residentBytes).toBe(46 * MB)
    expect(footprint.totalBytes).toBe(46 * MB)
  })

  it('reports an oversized file as streaming rather than resident', () => {
    const big = probe({ filePath: '/shows/long.wav', decodedBytes: 46 * MB, streaming: true })
    const footprint = summariseFootprint([big], budget, 1)

    expect(footprint.streaming).toBe(1)
    expect(footprint.residentBytes).toBe(0)
    expect(footprint.warning).toContain('above the engine’s 32 MB per-file cache bound'.replace('’', "'"))
    expect(footprint.warning).toContain('stream from disk')
  })

  it('says when the whole show is past what the engine holds at once', () => {
    const big = probe({ decodedBytes: 300 * MB, streaming: true })
    const footprint = summariseFootprint([big, probe({ filePath: '/b', decodedBytes: 300 * MB, streaming: true })], budget, 2)

    expect(footprint.totalBytes).toBe(600 * MB)
    expect(footprint.warning).toContain('more than the 512 MB the engine holds at once')
    expect(footprint.warning).toContain('stream from disk')
  })

  it('does not claim a total it stopped measuring', () => {
    const footprint = summariseFootprint(
      [probe({ decodedBytes: 600 * MB, streaming: true })],
      budget,
      40,
      true
    )
    expect(footprint.truncated).toBe(true)
    expect(footprint.warning).toContain('1 of 40 files measured so far, and there is more')
  })

  it('counts only what it could measure', () => {
    const footprint = summariseFootprint([], budget, 3)
    expect(footprint.measured).toBe(0)
    expect(footprint.warning).toBeNull()
  })
})

describe('formatBytes', () => {
  it('reads as an operator would say it', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(32 * MB)).toBe('32 MB')
    expect(formatBytes(1.5 * 1024 * MB)).toBe('1.5 GB')
  })
})
