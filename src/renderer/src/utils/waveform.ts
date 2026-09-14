// Drawing a waveform from a precomputed envelope: the engine hands the renderer
// interleaved min/max buckets for a file, and each frame reads one bucket per pixel.
// No decoded audio passes through the renderer at all.

/** Interleaved min/max per bucket: [min0, max0, min1, max1, …]. */
export interface WaveformPeaks {
  values: ArrayLike<number>
  buckets: number
}

// Enough detail for any panel width the window can reach; 32 KB per file.
export const PEAK_BUCKETS = 4096

export function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: WaveformPeaks,
  playFraction: number,
  startFraction: number
): void {
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

  const playedX = Math.floor(playFraction * width)
  const startX = Math.floor(startFraction * width)
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

    ctx.fillStyle = x <= playedX ? WAVEFORM_COLOR_PLAYED : WAVEFORM_COLOR
    ctx.fillRect(x, yMax, 1, barHeight)
  }

  // Start time marker
  if (startFraction > 0) {
    ctx.strokeStyle = '#e0a020'
    ctx.lineWidth = 1 * DPR
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(startX, 0)
    ctx.lineTo(startX, height)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Playhead
  if (playFraction > 0 && playFraction < 1) {
    ctx.strokeStyle = PLAYHEAD_COLOR
    ctx.lineWidth = 1.5 * DPR
    ctx.beginPath()
    ctx.moveTo(playedX, 0)
    ctx.lineTo(playedX, height)
    ctx.stroke()

    // Playhead handle triangle
    ctx.fillStyle = PLAYHEAD_COLOR
    ctx.beginPath()
    ctx.moveTo(playedX - 5, 0)
    ctx.lineTo(playedX + 5, 0)
    ctx.lineTo(playedX, 8)
    ctx.fill()
  }
}

const WAVEFORM_COLOR = '#2a6099'
const WAVEFORM_COLOR_PLAYED = '#4a9eff'
const PLAYHEAD_COLOR = '#ffffff'
const BG_COLOR = '#111'
export const DPR = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
