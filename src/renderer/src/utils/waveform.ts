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

/**
 * Where the two boundary grips are drawn: a head across the top of the panel and a tail
 * across the bottom, so the pair is one gesture apart in either direction and neither
 * hides behind the playhead. Returned by the drawing code as well as used by it, so what
 * the pointer can grab is exactly what the eye can see.
 */
export interface WaveformHandles {
  start: { x: number; y: number; r: number }
  end: { x: number; y: number; r: number }
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
  width: number, height: number, region: WaveformRegion
): WaveformLayout {
  const startFraction = Math.max(0, Math.min(1, region.start))
  const endFraction = Math.max(0, Math.min(1, region.end))
  const x = (fraction: number): number => Math.max(0, Math.min(width, Math.floor(fraction * width)))
  return {
    startFraction,
    endFraction,
    handles: {
      // Top and bottom rather than both at the top: the two grips are then always both
      // visible, even when the region is narrow enough for them to overlap in x.
      start: { x: x(startFraction), y: HANDLE_RADIUS * DPR, r: HANDLE_RADIUS * DPR },
      end: { x: x(endFraction), y: height - HANDLE_RADIUS * DPR, r: HANDLE_RADIUS * DPR }
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

  const layout = waveformLayout(width, height, draw.region)
  const playX = draw.play === null ? null : Math.floor(draw.play * width)
  const regionFrom = Math.floor(layout.startFraction * width)
  const regionTo = Math.floor(layout.endFraction * width)
  const yMid = height / 2

  for (let x = 0; x < width; x++) {
    const from = Math.floor(x * buckets / width)
    const to = Math.max(from + 1, Math.floor((x + 1) * buckets / width))
    let min = 0
    let max = 0
    for (let bucket = from; bucket < to && bucket < buckets; bucket++) {
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

  // The playhead, if the cue is playing.
  if (playX !== null && draw.play !== null && draw.play > 0 && draw.play < 1) {
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
  if (draw.cursor !== null) {
    const cursorX = Math.floor(draw.cursor * width)
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
    const x = Math.floor(Math.max(0, Math.min(1, onset)) * width)
    ctx.fillStyle = ONSET_COLOR
    ctx.fillRect(x, height - ONSET_HEIGHT * DPR, Math.max(1, Math.floor(DPR)), ONSET_HEIGHT * DPR)
  }

  drawGrip(ctx, layout.handles.start, 'down', draw.region.start > 0)
  drawGrip(ctx, layout.handles.end, 'up', layout.endFraction < 1)
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
