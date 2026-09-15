// Drawing a waveform from a precomputed envelope: the engine hands the renderer
// interleaved min/max buckets for a file, and each frame reads one bucket per pixel.
// No decoded audio passes through the renderer at all.

/** Interleaved min/max per bucket: [min0, max0, min1, max1, …]. */
export interface WaveformPeaks {
  values: ArrayLike<number>
  buckets: number
}

/**
 * The region the cue plays, as fractions of the file. `end` is 1 when the region runs to
 * the end of the file, which is also what an unknown length draws as.
 */
export interface WaveformRegion {
  start: number
  end: number
}

/** What one frame of the panel shows, as fractions of the file. */
export interface WaveformDraw {
  region: WaveformRegion
  /**
   * The window into the file the panel is looking at, as fractions: `0–1` is the whole
   * file, and a zoomed panel is a narrower window inside it. Everything the frame draws
   * is placed through this, so the view is the only thing that decides what "further
   * along" means.
   */
  view: WaveformView
  /** Where the playhead is, if the cue is playing: null when it is not. */
  play: number | null
  /** Where a split would be made, if the cursor is over the panel: null when it is not. */
  cursor: number | null
  /**
   * Where the notes and hits begin, as fractions of the file. They are what a boundary
   * is placed on, so they are drawn whether or not one is being dragged — a snap the
   * operator cannot see is a boundary that moved by itself.
   */
  onsets?: number[]
}

/** The slice of the file on screen, as fractions of the file. */
export interface WaveformView {
  start: number
  end: number
}

/** The whole file: what the panel shows at 1×. */
export const FULL_VIEW: WaveformView = { start: 0, end: 1 }

/** How far a file fraction is from the left edge of the canvas, in device pixels. */
export function viewX(fraction: number, view: WaveformView, width: number): number {
  const span = Math.max(Number.EPSILON, view.end - view.start)
  return Math.floor(((fraction - view.start) / span) * width)
}

/** Whether a file fraction is inside the window the panel is looking at. */
export function inView(fraction: number, view: WaveformView): boolean {
  return fraction >= view.start && fraction <= view.end
}

/**
 * Where the two boundary grips are drawn: a head across the top of the panel and a tail
 * across the bottom, so the pair is one gesture apart in either direction and neither
 * hides behind the playhead. Returned by the drawing code as well as used by it, so what
 * the pointer can grab is exactly what the eye can see.
 *
 * A boundary outside the window is `null`: a grip pinned to the edge of a zoomed view
 * would be a handle pointing at a time the panel is not showing, and grabbing it would
 * move a boundary the operator cannot see.
 */
export interface WaveformHandles {
  start: { x: number; y: number; r: number } | null
  end: { x: number; y: number; r: number } | null
}

export interface WaveformLayout {
  handles: WaveformHandles
  /** File fractions the grips sit at. */
  startFraction: number
  endFraction: number
}

/** The grip radius, in CSS pixels; the drawing scales it for the device pixel ratio. */
export const HANDLE_RADIUS = 9

export function waveformLayout(
  width: number, height: number, region: WaveformRegion, view: WaveformView
): WaveformLayout {
  const startFraction = Math.max(0, Math.min(1, region.start))
  const endFraction = Math.max(0, Math.min(1, region.end))
  const x = (fraction: number): number =>
    Math.max(0, Math.min(width, viewX(fraction, view, width)))
  return {
    startFraction,
    endFraction,
    handles: {
      // Top and bottom rather than both at the top: the two grips are then always both
      // visible, even when the region is narrow enough for them to overlap in x.
      start: inView(startFraction, view)
        ? { x: x(startFraction), y: HANDLE_RADIUS * DPR, r: HANDLE_RADIUS * DPR }
        : null,
      end: inView(endFraction, view)
        ? { x: x(endFraction), y: height - HANDLE_RADIUS * DPR, r: HANDLE_RADIUS * DPR }
        : null
    }
  }
}

// Enough detail for any panel width the window can reach; 32 KB per file.
export const PEAK_BUCKETS = 4096

export function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: WaveformPeaks,
  draw: WaveformDraw
): WaveformLayout {
  const width = canvas.width
  const height = canvas.height
  const ctx = canvas.getContext('2d')!
  const { values, buckets } = peaks

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, width, height)

  // Center line
  ctx.strokeStyle = '#1e1e1e'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, height / 2)
  ctx.lineTo(width, height / 2)
  ctx.stroke()

  const layout = waveformLayout(width, height, draw.region, draw.view)
  const view = draw.view
  const viewSpan = Math.max(Number.EPSILON, view.end - view.start)
  const playX = draw.play === null ? null : viewX(draw.play, view, width)
  const regionFrom = viewX(layout.startFraction, view, width)
  const regionTo = viewX(layout.endFraction, view, width)
  const yMid = height / 2

  for (let x = 0; x < width; x++) {
    // The column's own slice of the file, read through the window: what one column is
    // worth in buckets is the zoom, so a zoomed-in panel reads a few buckets closely
    // instead of many of them coarsely.
    const from = Math.min(buckets - 1, Math.floor((view.start + (x / width) * viewSpan) * buckets))
    const to = Math.max(from + 1, Math.ceil((view.start + ((x + 1) / width) * viewSpan) * buckets))
    let min = 0
    let max = 0
    for (let bucket = Math.max(0, from); bucket < to && bucket < buckets; bucket++) {
      const low = values[bucket * 2]
      const high = values[bucket * 2 + 1]
      if (low < min) min = low
      if (high > max) max = high
    }

    const yMax = yMid - max * yMid
    const yMin = yMid - min * yMid
    const barHeight = Math.max(1, yMin - yMax)

    // Three states, all visible at once: the part of the file this cue plays, the part it
    // has played, and the part outside the region, which is dimmer than the rest — the
    // trim is the shape of the cue and the operator has to be able to see it.
    const inside = x >= regionFrom && x <= regionTo
    ctx.fillStyle = !inside
      ? WAVEFORM_COLOR_OUTSIDE
      : playX !== null && x <= playX
        ? WAVEFORM_COLOR_PLAYED
        : WAVEFORM_COLOR
    ctx.fillRect(x, yMax, 1, barHeight)
  }

  // The playhead, if the cue is playing, and if it is inside the window: a line pinned to
  // the edge of a zoomed view would be the panel claiming the music is somewhere it is not.
  if (playX !== null && draw.play !== null && inView(draw.play, view)) {
    ctx.strokeStyle = PLAYHEAD_COLOR
    ctx.lineWidth = 1.5 * DPR
    ctx.beginPath()
    ctx.moveTo(playX, 0)
    ctx.lineTo(playX, height)
    ctx.stroke()

    // Playhead handle triangle
    ctx.fillStyle = PLAYHEAD_COLOR
    ctx.beginPath()
    ctx.moveTo(playX - 5 * DPR, 0)
    ctx.lineTo(playX + 5 * DPR, 0)
    ctx.lineTo(playX, 8 * DPR)
    ctx.fill()
  }

  // The split cursor, where one would be made. Dashed, so it reads as a place rather
  // than as a state — the playhead is the solid line in this panel.
  if (draw.cursor !== null && inView(draw.cursor, view)) {
    const cursorX = viewX(draw.cursor, view, width)
    ctx.strokeStyle = CURSOR_COLOR
    ctx.lineWidth = 1 * DPR
    ctx.setLineDash([2 * DPR, 3 * DPR])
    ctx.beginPath()
    ctx.moveTo(cursorX, 0)
    ctx.lineTo(cursorX, height)
    ctx.stroke()
    ctx.setLineDash([])
  }

  for (const onset of draw.onsets ?? []) {
    if (!inView(onset, view)) continue
    const x = Math.max(0, Math.min(width, viewX(onset, view, width)))
    ctx.fillStyle = ONSET_COLOR
    ctx.fillRect(x, height - ONSET_HEIGHT * DPR, Math.max(1, Math.floor(DPR)), ONSET_HEIGHT * DPR)
  }

  if (layout.handles.start !== null) {
    drawGrip(ctx, layout.handles.start, 'down', draw.region.start > 0)
  }
  if (layout.handles.end !== null) {
    drawGrip(ctx, layout.handles.end, 'up', layout.endFraction < 1)
  }
  return layout
}

/**
 * One boundary grip: a filled circle with a point, drawn over the bar it sits on. A grip
 * for a boundary that is not trimming anything is drawn hollow — it is a handle that
 * exists to be pulled, not a marker of a state the cue is in.
 */
function drawGrip(
  ctx: CanvasRenderingContext2D,
  handle: { x: number; y: number; r: number },
  direction: 'up' | 'down',
  active: boolean
): void {
  ctx.beginPath()
  ctx.arc(handle.x, handle.y, handle.r, 0, Math.PI * 2)
  ctx.fillStyle = active ? BOUNDARY_COLOR : BOUNDARY_IDLE_FILL
  ctx.fill()
  ctx.strokeStyle = active ? BOUNDARY_COLOR : BOUNDARY_IDLE_STROKE
  ctx.lineWidth = DPR
  ctx.stroke()

  // A point in the direction the boundary can be pulled, so the pair reads as two ends
  // of one region rather than as two markers.
  const tip = direction === 'down'
    ? handle.y + handle.r * 0.9
    : handle.y - handle.r * 0.9
  ctx.beginPath()
  ctx.moveTo(handle.x - handle.r * 0.45, direction === 'down' ? handle.y + handle.r * 0.1 : handle.y - handle.r * 0.1)
  ctx.lineTo(handle.x + handle.r * 0.45, direction === 'down' ? handle.y + handle.r * 0.1 : handle.y - handle.r * 0.1)
  ctx.lineTo(handle.x, tip)
  ctx.closePath()
  ctx.fillStyle = active ? BOUNDARY_COLOR : BOUNDARY_IDLE_STROKE
  ctx.fill()
}

const WAVEFORM_COLOR = '#2a6099'
const WAVEFORM_COLOR_PLAYED = '#4a9eff'
/** Outside the cue's region: the part of the file this cue does not play. */
const WAVEFORM_COLOR_OUTSIDE = '#1d3a63'
const PLAYHEAD_COLOR = '#ffffff'
const BG_COLOR = '#111'
const BOUNDARY_COLOR = '#e0a020'
const BOUNDARY_IDLE_STROKE = '#6b5a2a'
const BOUNDARY_IDLE_FILL = '#1a1a1a'
/** The tick a note or hit gets along the bottom edge: a place, not a state. */
const ONSET_COLOR = '#5a7a9a'
const ONSET_HEIGHT = 5
const CURSOR_COLOR = '#8a8a8a'
export const DPR = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
