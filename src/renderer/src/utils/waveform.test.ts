// The waveform is drawn from the engine's bounded envelope: one bucket read per pixel,
// and no decoded audio anywhere in the renderer.
import { describe, it, expect } from 'vitest'
import { drawWaveform, type WaveformPeaks } from './waveform'

function peaks(values: number[], buckets: number): WaveformPeaks {
  return { values, buckets }
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

describe('drawWaveform', () => {
  it('draws one bar per column without touching the samples', () => {
    const { canvas, calls } = recordingCanvas(64, 32)
    // Interleaved min/max, one pair per bucket.
    const envelope = peaks([-0.5, 0.5], 1)

    drawWaveform(canvas, envelope, 0, 0)

    // One background fill plus one bar per column.
    expect(calls.filter(call => call.startsWith('fillRect:')).length).toBe(65)
  })

  it('marks the playhead and the start marker', () => {
    const { canvas, calls } = recordingCanvas(100, 20)
    const envelope = peaks([-0.5, 0.5, -0.25, 0.25], 2)

    drawWaveform(canvas, envelope, 0.5, 0.25)

    // Clear, background, 100 bars, then the start marker and the playhead.
    expect(calls[0]).toBe('clear')
    expect(calls[1]).toBe('fillRect:0,0,100,20')
    expect(calls.filter(call => call.startsWith('fillRect:')).length).toBe(101)
  })

  it('draws silence as a single-pixel line per column', () => {
    const { canvas, calls } = recordingCanvas(8, 32)
    const envelope = peaks([0, 0], 1)

    drawWaveform(canvas, envelope, 0, 0)

    // The background, then eight 1px bars at the centre line.
    expect(calls.filter(call => call.startsWith('fillRect:')).length).toBe(9)
  })
})
