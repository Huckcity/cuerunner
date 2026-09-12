import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore, useSelectedCue } from '../../store'
import { audioEngine } from '../../engine/audioEngineClient'
import { cueRunner } from '../../engine/CueRunner'
import { PlaybackWarnings } from '../layout/PlaybackWarnings'
import { DPR, drawWaveform, PEAK_BUCKETS, type WaveformPeaks } from '../../utils/waveform'
import type { AudioCue } from '../../types/cue'
import './WaveformPanel.css'

function formatTime(ms: number): string {
  const s = ms / 1000
  const min = Math.floor(s / 60)
  const sec = s % 60
  return `${min}:${sec.toFixed(1).padStart(4, '0')}`
}

export function WaveformPanel() {
  const selectedCue = useSelectedCue()
  const updateCue = useStore(s => s.updateCue)
  const syncCueDuration = useStore(s => s.syncCueDuration)
  const running = useStore(s => s.running)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const peaksRef = useRef<WaveformPeaks | null>(null)
  const durationRef = useRef(0)

  // The engine's bounded envelope for the file: interleaved min/max buckets, never the
  // media itself.
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null)
  const [loading, setLoading] = useState(false)
  const [playFraction, setPlayFraction] = useState(0)
  const [hoverFraction, setHoverFraction] = useState<number | null>(null)

  const audioCue = selectedCue?.type === 'audio' ? selectedCue as AudioCue : null
  const runState = audioCue ? running.get(audioCue.id) : undefined
  const isPlaying = runState?.state === 'playing'

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

  // Redraw canvas whenever the envelope, playFraction, or size changes
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const envelope = peaksRef.current
    if (!canvas || !envelope) return
    const total = durationRef.current || (audioCue?.duration ?? 0) / 1000
    const startFrac = audioCue && total > 0 ? (audioCue.startTime / 1000) / total : 0
    drawWaveform(canvas, envelope, playFraction, startFrac)
  }, [peaks, playFraction, audioCue?.startTime, audioCue?.duration])

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

  const fractionFromEvent = (e: React.MouseEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioCue) return
    const total = durationRef.current || audioCue.duration / 1000
    if (total <= 0) return
    const fraction = fractionFromEvent(e)
    const timeMs = fraction * total * 1000

    // Always update the cue's startTime
    updateCue(audioCue.id, { startTime: timeMs })

    // If currently playing, move the run's playhead — without fading the cue in again
    // over the position the operator picked.
    if (isPlaying) cueRunner.seekCue(audioCue.id, timeMs)

    setPlayFraction(fraction)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setHoverFraction(fractionFromEvent(e))
  }

  if (!audioCue) return null

  const totalDuration = durationRef.current || audioCue.duration / 1000
  const hoverTime = hoverFraction != null ? hoverFraction * totalDuration : null
  const playTime = playFraction * totalDuration
  const startTimeSec = audioCue.startTime / 1000

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
        {audioCue.startTime > 0 && (
          <span className="waveform-start-tag">
            start: {formatTime(startTimeSec * 1000)}
            <button
              onClick={() => updateCue(audioCue.id, { startTime: 0 })}
              title="Reset start time"
            >✕</button>
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
          style={{ opacity: loading || !peaks ? 0 : 1 }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverFraction(null)}
          title="Click to set start time / seek"
        />
      </div>
    </div>
  )
}
