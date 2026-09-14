import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore, useSelectedCue } from '../../store'
import { audioEngine } from '../../engine/audioEngineClient'
import { cueRunner } from '../../engine/CueRunner'
import { PlaybackWarnings } from '../layout/PlaybackWarnings'
import {
  DPR, drawWaveform, PEAK_BUCKETS,
  type WaveformLayout, type WaveformPeaks, type WaveformRegion
} from '../../utils/waveform'
import { regionEndMs } from '../../utils/cueSplit'
import type { AudioCue } from '../../types/cue'
import './WaveformPanel.css'

function formatTime(ms: number): string {
  const s = ms / 1000
  const min = Math.floor(s / 60)
  const sec = s % 60
  return `${min}:${sec.toFixed(1).padStart(4, '0')}`
}

/**
 * Which boundary a drag is moving, or the playhead's place when the press landed
 * elsewhere. A drag is what moves a boundary: a click is how the operator says where
 * they are looking, and the two gestures have to stay distinguishable in a panel this
 * small — a click that quietly trimmed the cue would be a click nobody could undo
 * without knowing they made it.
 */
type DragMode = 'start' | 'end' | 'cursor'

export function WaveformPanel() {
  const selectedCue = useSelectedCue()
  const updateCue = useStore(s => s.updateCue)
  const setRegionBoundary = useStore(s => s.setRegionBoundary)
  const syncCueDuration = useStore(s => s.syncCueDuration)
  const running = useStore(s => s.running)
  const cursorMs = useStore(s => s.waveformCursorMs)
  const setWaveformCursor = useStore(s => s.setWaveformCursor)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const peaksRef = useRef<WaveformPeaks | null>(null)
  const durationRef = useRef(0)
  const layoutRef = useRef<WaveformLayout | null>(null)
  /** The drag in progress, or null. `grab` is the file fraction the boundary started at. */
  const dragRef = useRef<{ mode: DragMode; grab: number } | null>(null)
  /** Mirrors of the state the pointer handlers need, so their listeners stay stable. */
  const regionRef = useRef<WaveformRegion>({ start: 0, end: 1 })
  const cursorRef = useRef<number | null>(null)

  // The engine's bounded envelope for the file: interleaved min/max buckets, never the
  // media itself.
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null)
  const [loading, setLoading] = useState(false)
  const [playFraction, setPlayFraction] = useState(0)
  const [hoverFraction, setHoverFraction] = useState<number | null>(null)
  const [dragging, setDragging] = useState<DragMode | null>(null)

  const audioCue = selectedCue?.type === 'audio' ? selectedCue as AudioCue : null
  const runState = audioCue ? running.get(audioCue.id) : undefined
  const isPlaying = runState?.state === 'playing'

  /** The file length in ms, from the envelope the engine sent, or the cue's own. */
  const totalMs = (): number =>
    (durationRef.current || (audioCue?.duration ?? 0)) * 1000

  /** The cue's region as fractions of the file. `totalMs` is milliseconds, like the cue. */
  const regionOf = (cue: AudioCue, totalMs: number): WaveformRegion => {
    if (totalMs <= 0) return { start: 0, end: 1 }
    return {
      start: Math.max(0, cue.startTime / totalMs),
      end: Math.min(regionEndMs(cue) / totalMs, 1)
    }
  }

  // Refuse a drag outside the panel without leaving the panel stuck in a drag: the
  // pointer is captured, but a window blur (a desktop switch) never delivers the up.
  useEffect(() => {
    const cancel = (): void => { dragRef.current = null; setDragging(null) }
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [])

  // Ask the engine for the envelope when the selected audio cue or its file changes
  useEffect(() => {
    if (!audioCue?.filePath) {
      peaksRef.current = null
      durationRef.current = 0
      setPeaks(null)
      return
    }

    let current = true
    setLoading(true)
    audioEngine.waveform(audioCue.filePath, PEAK_BUCKETS)
      .then(data => {
        if (!current) return
        const envelope: WaveformPeaks = { values: data.values, buckets: data.buckets }
        peaksRef.current = envelope
        durationRef.current = data.durationMs / 1000
        setPeaks(envelope)
        if (data.durationMs > 0) syncCueDuration(audioCue.id, Math.round(data.durationMs))
      })
      .catch(() => {
        // A file the engine cannot read leaves the panel empty rather than showing the
        // previous cue's waveform against this cue's timing.
        if (!current) return
        peaksRef.current = null
        durationRef.current = 0
        setPeaks(null)
      })
      .finally(() => { if (current) setLoading(false) })

    return () => { current = false }
  }, [audioCue?.filePath, audioCue?.id, syncCueDuration])

  // rAF loop for playhead while playing: the client keeps the engine's last reported
  // position, so a frame costs nothing across IPC.
  useEffect(() => {
    if (!isPlaying || !audioCue) {
      if (!isPlaying) {
        const total = durationRef.current || (audioCue?.duration ?? 0) / 1000
        setPlayFraction(audioCue && total > 0 ? (audioCue.startTime / 1000) / total : 0)
      }
      return
    }
    const tick = () => {
      const prog = audioEngine.getProgress(audioCue.id)
      if (prog) setPlayFraction(prog.fraction)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying, audioCue?.id])

  // Redraw canvas whenever the envelope, the playhead, the region or the cursor changes
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const envelope = peaksRef.current
    if (!canvas || !envelope || !audioCue) return
    const total = totalMs()
    const region = regionOf(audioCue, total)
    regionRef.current = region
    const shown = cursorMs === null ? null : Math.min(Math.max(cursorMs / (total * 1000), 0), 1)
    cursorRef.current = shown
    layoutRef.current = drawWaveform(canvas, envelope, {
      region,
      play: isPlaying ? playFraction : null,
      cursor: shown
    })
  }, [peaks, playFraction, audioCue?.startTime, audioCue?.endTime, audioCue?.duration, cursorMs, isPlaying])

  useEffect(draw, [draw])

  // Resize observer to redraw when panel width changes
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const { width, height } = el.getBoundingClientRect()
      canvas.width = Math.floor(width * DPR)
      canvas.height = Math.floor(height * DPR)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      draw()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [draw])

  const fractionAt = (clientX: number): number => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const rect = canvas.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  /** Which grip a press is on, if any: the drawn grips are the only hit targets. */
  const gripAt = (e: React.PointerEvent<HTMLCanvasElement>): DragMode | null => {
    const layout = layoutRef.current
    if (!layout) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) * DPR
    const y = (e.clientY - rect.top) * DPR
    const reach = (grip: { x: number; y: number; r: number }): number =>
      Math.hypot(x - grip.x, y - grip.y)
    // The tail is checked first: with a narrow region the two grips can overlap, and the
    // one drawn on top is the one the hand is aiming at.
    if (reach(layout.handles.end) <= layout.handles.end.r) return 'end'
    if (reach(layout.handles.start) <= layout.handles.start.r) return 'start'
    return null
  }

  /**
   * Moves the boundary being dragged to a fraction of the file. The head stops short of
   * the tail and the tail of the head by a millisecond — a region of no length is a cue
   * that plays nothing, and the two grips would sit on top of each other with no way to
   * pull them apart again.
   */
  const moveBoundary = (fraction: number, mode: 'start' | 'end'): void => {
    const total = totalMs()
    const cue = audioCue
    if (!cue || total <= 0) return
    setRegionBoundary(cue.id, mode, Math.round(fraction * total))
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const cue = audioCue
    if (!cue) return
    const total = totalMs()
    if (total <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)

    const grip = gripAt(e)
    if (grip !== null) {
      dragRef.current = { mode: grip, grab: fractionAt(e.clientX) }
      setDragging(grip)
      setHoverFraction(fractionAt(e.clientX))
      return
    }

    // Anywhere else: the cursor, which is where the playhead goes and where a split
    // will be made. Nothing is trimmed by it.
    const fraction = fractionAt(e.clientX)
    const timeMs = fraction * total
    setWaveformCursor(timeMs)
    setPlayFraction(fraction)
    if (isPlaying) cueRunner.seekCue(cue.id, timeMs)
    dragRef.current = { mode: 'cursor', grab: fraction }
    setDragging('cursor')
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const fraction = fractionAt(e.clientX)
    const drag = dragRef.current
    if (!drag) {
      setHoverFraction(fraction)
      return
    }
    const total = totalMs()
    const timeMs = fraction * total
    if (drag.mode === 'cursor') {
      setWaveformCursor(timeMs)
      setPlayFraction(fraction)
      if (isPlaying && audioCue) cueRunner.seekCue(audioCue.id, timeMs)
    } else {
      moveBoundary(fraction, drag.mode)
    }
    setHoverFraction(fraction)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    dragRef.current = null
    setDragging(null)
  }

  if (!audioCue) return null

  const totalDuration = durationRef.current || audioCue.duration / 1000
  const hoverTime = hoverFraction != null ? hoverFraction * totalDuration : null
  const playTime = playFraction * totalDuration
  const trimmed = audioCue.startTime > 0 || regionEndMs(audioCue) < totalDuration * 1000 - 1
  const cursorTime = cursorMs
  const cursorOverRegion = cursorTime !== null &&
    cursorTime > audioCue.startTime && cursorTime < regionEndMs(audioCue)

  return (
    <div className="waveform-panel">
      <div className="waveform-header">
        <span className="waveform-filename">
          {audioCue.filePath ? audioCue.filePath.split(/[\\/]/).pop() : 'No file selected'}
        </span>
        <PlaybackWarnings className="waveform-warning" compact />
        <span className="waveform-times">
          {isPlaying && <span className="waveform-elapsed">{formatTime(playTime * 1000)}</span>}
          {hoverTime != null && !isPlaying && (
            <span className="waveform-hover">{formatTime(hoverTime * 1000)}</span>
          )}
          <span className="waveform-total">{formatTime(totalDuration * 1000)}</span>
        </span>
        {trimmed && (
          <span className="waveform-region-tag" title="The part of the file this cue plays">
            plays {formatTime(audioCue.startTime)}–{formatTime(regionEndMs(audioCue))}
            <button
              onClick={() => updateCue(audioCue.id, { startTime: 0, endTime: null })}
              title="Play the whole file"
            >✕</button>
          </span>
        )}
        {cursorOverRegion && (
          <span className="waveform-cursor" title="Where a split would be made">
            split {formatTime(cursorTime)}
          </span>
        )}
      </div>
      <div ref={containerRef} className="waveform-canvas-container">
        {loading && <div className="waveform-loading">Loading waveform…</div>}
        {!loading && !peaks && audioCue.filePath && (
          <div className="waveform-loading">Could not read the waveform.</div>
        )}
        {!audioCue.filePath && (
          <div className="waveform-loading">No audio file selected.</div>
        )}
        <canvas
          ref={canvasRef}
          className="waveform-canvas"
          data-dragging={dragging ?? undefined}
          style={{ opacity: loading || !peaks ? 0 : 1 }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onMouseLeave={() => { if (!dragRef.current) setHoverFraction(null) }}
          title="Click to place the cursor — drag a handle to move the boundary"
        />
      </div>
    </div>
  )
}
