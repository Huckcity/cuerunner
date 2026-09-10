// The waveform is drawn from a precomputed envelope, so a frame costs one bucket read
// per pixel instead of a pass over every decoded sample.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildPeaks, clearPeaksCache, drawWaveform, getPeaks, PEAK_BUCKETS } from './waveform'

function fakeBuffer(channels: number[][], sampleRate = 48000): AudioBuffer {
  return {
    length: channels[0].length,
    numberOfChannels: channels.length,
    sampleRate,
    duration: channels[0].length / sampleRate,
    getChannelData: (channel: number) => Float32Array.from(channels[channel])
  } as unknown as AudioBuffer
}

function recordingCanvas(width: number, height: number): { canvas: HTMLCanvasElement; calls: string[] } {
  const calls: string[] = []
  const ctx = {
    clearRect: () => calls.push('clear'),
    fillRect: (...args: unknown[]) => calls.push(`fillRect:${args.join(',')}`),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    setLineDash: () => {},
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {}
  }
  const canvas = {
    width,
    height,
    getContext: () => ctx
  } as unknown as HTMLCanvasElement
  return { canvas, calls }
}

describe('buildPeaks', () => {
  it('reports the min and max of each bucket', () => {
    const buffer = fakeBuffer([[0.5, -0.5, 1, -1]])

    const peaks = buildPeaks(buffer, 2)

    expect([...peaks.values]).toEqual([-0.5, 0.5, -1, 1])
    expect(peaks.buckets).toBe(2)
  })

  it('takes the widest excursion across channels', () => {
    const buffer = fakeBuffer([[0.25, 0.25], [-0.75, 0.5]])

    const peaks = buildPeaks(buffer, 1)

    expect([...peaks.values]).toEqual([-0.75, 0.5])
  })

  it('produces a bucket per column at the default resolution', () => {
    const samples = new Array(PEAK_BUCKETS * 10).fill(0)

    const peaks = buildPeaks(fakeBuffer([samples]))

    expect(peaks.values).toHaveLength(PEAK_BUCKETS * 2)
  })
})

describe('getPeaks', () => {
  beforeEach(() => clearPeaksCache())

  it('builds once per file', () => {
    const buffer = fakeBuffer([[0.1, 0.2]])
    const spy = vi.spyOn(buffer, 'getChannelData')

    const first = getPeaks('/show/a.wav', buffer)
    const second = getPeaks('/show/a.wav', buffer)

    expect(second).toBe(first)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('drawWaveform', () => {
  it('draws one bar per column without touching the samples', () => {
    const { canvas, calls } = recordingCanvas(64, 32)
    const peaks = buildPeaks(fakeBuffer([[0.5, -0.5]]), 8)

    drawWaveform(canvas, peaks, 0, 0)

    // One background fill plus one bar per column.
    expect(calls.filter(call => call.startsWith('fillRect:')).length).toBe(65)
  })

  it('marks the playhead and the start marker', () => {
    const { canvas, calls } = recordingCanvas(100, 20)
    const peaks = buildPeaks(fakeBuffer([[0.5, -0.5]]), 8)

    drawWaveform(canvas, peaks, 0.5, 0.25)

    // Clear, background, 100 bars, then the start marker and the playhead.
    expect(calls[0]).toBe('clear')
    expect(calls[1]).toBe('fillRect:0,0,100,20')
    expect(calls.filter(call => call.startsWith('fillRect:')).length).toBe(101)
  })
})
