// The waveform is drawn from the engine's bounded envelope: one bucket read per pixel,
// and no decoded audio anywhere in the renderer. What these tests hold is the panel's
// reading of a cue: which part of the file is inside the region, where the playhead is,
// and where the two grips are — the last of these because the pointer grabs exactly what
// the drawing says is there.
import { describe, it, expect } from 'vitest'
import {
  drawWaveform, waveformLayout, viewX, FULL_VIEW, HANDLE_RADIUS, DPR, type WaveformPeaks
} from './waveform'

function peaks(values: number[], buckets: number): WaveformPeaks {
  return { values, buckets }
}

interface Recorded {
  canvas: HTMLCanvasElement
  calls: string[]
  bars: string[]
}

function recordingCanvas(width: number, height: number): Recorded {
  const calls: string[] = []
  const bars: string[] = []
  const ctx = {
    clearRect: () => calls.push('clear'),
    fillRect: (...args: unknown[]) => {
      calls.push(`fillRect:${args.join(',')}`)
      bars.push(String(args.join(',')))
    },
    beginPath: () => {},
    closePath: () => {},
    arc: () => calls.push('arc'),
    moveTo: (...args: unknown[]) => calls.push(`moveTo:${args.join(',')}`),
    lineTo: () => {},
    stroke: () => {},
    fill: () => calls.push('fill'),
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
  return { canvas, calls, bars }
}

const region = { start: 0, end: 1 }
/** The whole file on screen: what the panel shows until somebody zooms in. */
const view = FULL_VIEW

describe('drawWaveform', () => {
  it('draws one bar per column without touching the samples', () => {
    const { canvas, bars } = recordingCanvas(64, 32)

    drawWaveform(canvas, peaks([-0.5, 0.5], 1), { region, view, play: null, cursor: null })

    // One background fill plus one bar per column.
    expect(bars.length).toBe(65)
  })

  it('draws silence as a single-pixel line per column', () => {
    const { canvas, bars } = recordingCanvas(8, 32)

    drawWaveform(canvas, peaks([0, 0], 1), { region, view, play: null, cursor: null })

    // The background, then eight 1px bars at the centre line.
    expect(bars.length).toBe(9)
  })

  it('draws one tick per onset, and none when there are none', () => {
    // The ticks are what a boundary snaps to: a snap the operator cannot see is a
    // boundary that moved by itself.
    const none = recordingCanvas(100, 20)
    const three = recordingCanvas(100, 20)

    drawWaveform(none.canvas, peaks([-0.5, 0.5], 1), { region, view, play: null, cursor: null })
    drawWaveform(three.canvas, peaks([-0.5, 0.5], 1), {
      region, view, play: null, cursor: null, onsets: [0.25, 0.5, 0.75]
    })

    // The ticks are 5px tall along the bottom edge; the bars are the full height.
    const ticks = (calls: string[]): number =>
      calls.filter(call => call.startsWith('fillRect:') && call.endsWith(',1,5')).length
    expect(ticks(none.calls)).toBe(0)
    expect(ticks(three.calls)).toBe(3)
  })

  it('draws the playhead and the cursor only inside the window', () => {
    // A line pinned to the edge of a zoomed view is the panel claiming the music is
    // somewhere it is not.
    const inside = recordingCanvas(100, 20)
    drawWaveform(inside.canvas, peaks([-1, 1], 1), {
      region, view: { start: 0.4, end: 0.6 }, play: 0.5, cursor: 0.55
    })
    expect(inside.calls).toContain('moveTo:50,0')
    expect(inside.calls).toContain('moveTo:75,0')

    const outside = recordingCanvas(100, 20)
    drawWaveform(outside.canvas, peaks([-1, 1], 1), {
      region, view: { start: 0.4, end: 0.6 }, play: 0.2, cursor: 0.9
    })
    expect(outside.calls.filter(call => call.startsWith('moveTo:'))).toEqual(['moveTo:0,10'])
  })

  it('draws only the onsets the window is showing', () => {
    const { canvas, calls } = recordingCanvas(100, 20)

    drawWaveform(canvas, peaks([-1, 1], 1), {
      region, view: { start: 0.4, end: 0.6 }, play: null, cursor: null, onsets: [0.2, 0.5, 0.9]
    })

    const ticks = calls.filter(call => call.startsWith('fillRect:') && call.endsWith(',1,5'))
    expect(ticks).toEqual(['fillRect:50,15,1,5'])
  })

  it('draws both boundary grips, every frame', () => {
    // The grips are the only hit targets the pointer has, so a frame that does not draw
    // one is a boundary nobody can drag.
    const { canvas, calls } = recordingCanvas(64, 32)

    drawWaveform(canvas, peaks([-1, 1], 1), { region: { start: 0.25, end: 0.75 }, view, play: null, cursor: null })

    expect(calls.filter(call => call === 'arc').length).toBe(2)
  })
})

describe('waveformLayout', () => {
  it('puts the head grip at the top and the tail grip at the bottom', () => {
    const layout = waveformLayout(200, 100, { start: 0.25, end: 0.75 }, view)

    expect(layout.handles.start?.x).toBe(50)
    expect(layout.handles.start?.y).toBe(HANDLE_RADIUS * DPR)
    expect(layout.handles.end?.x).toBe(150)
    expect(layout.handles.end?.y).toBe(100 - HANDLE_RADIUS * DPR)
  })

  it('keeps the grips on the canvas at either end of the file', () => {
    const layout = waveformLayout(200, 100, { start: 0, end: 1 }, view)

    expect(layout.handles.start?.x).toBe(0)
    expect(layout.handles.end?.x).toBe(200)
  })

  it('places the grips through the window the panel is showing', () => {
    // The file's own edges are the window's edges at 4×: the head grip is at the left of
    // the canvas and the tail at the right, whatever times those are.
    const layout = waveformLayout(200, 100, { start: 0.25, end: 0.75 }, { start: 0.25, end: 0.75 })

    expect(layout.handles.start?.x).toBe(0)
    expect(layout.handles.end?.x).toBe(200)
  })

  it('has no grip for a boundary outside the window', () => {
    // A grip pinned to the edge would point at a time the panel is not showing, and a
    // drag on it would move a boundary nobody can see.
    const layout = waveformLayout(200, 100, { start: 0.25, end: 0.75 }, { start: 0.5, end: 1 })

    expect(layout.handles.start).toBeNull()
    expect(layout.handles.end?.x).toBe(100)
  })
})

describe('viewX', () => {
  it('reads a fraction through the window on screen', () => {
    expect(viewX(0.5, { start: 0, end: 1 }, 200)).toBe(100)
    expect(viewX(0.5, { start: 0.25, end: 0.75 }, 200)).toBe(100)
    expect(viewX(0.25, { start: 0.25, end: 0.75 }, 200)).toBe(0)
    expect(viewX(0.75, { start: 0.25, end: 0.75 }, 200)).toBe(200)
  })
})
