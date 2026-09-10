import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore, useSelectedCue } from '../../store'
import { audioPlayer } from '../../engine/AudioPlayer'
import { DPR, drawWaveform, getPeaks, type WaveformPeaks } from '../../utils/waveform'
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
  const bufferRef = useRef<AudioBuffer | null>(null)

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  // Min/max per bucket, built once per file: the playhead redraw must not depend on how
  // long the file is.
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null)
  const [loading, setLoading] = useState(false)
  const [playFraction, setPlayFraction] = useState(0)
  const [hoverFraction, setHoverFraction] = useState<number | null>(null)

  const audioCue = selectedCue?.type === 'audio' ? selectedCue as AudioCue : null
  const runState = audioCue ? running.get(audioCue.id) : undefined
  const isPlaying = runState?.state === 'playing'

  // Load buffer when selected audio cue or its file changes
  useEffect(() => {
    if (!audioCue?.filePath) { setBuffer(null); setPeaks(null); return }

    const cached = audioPlayer.getBuffer(audioCue.filePath)
    if (cached) {
      setBuffer(cached)
      bufferRef.current = cached
      setPeaks(getPeaks(audioCue.filePath, cached))
      return
    }

    setLoading(true)
    audioPlayer.load(audioCue.filePath).then(buf => {
      setBuffer(buf)
      bufferRef.current = buf
      setPeaks(getPeaks(audioCue.filePath, buf))
      syncCueDuration(audioCue.id, Math.round(buf.duration * 1000))
    }).catch(() => {
      // A file that cannot be read or decoded leaves the panel empty rather than
      // showing the previous cue's waveform against this cue's timing.
      setBuffer(null)
      bufferRef.current = null
      setPeaks(null)
    }).finally(() => setLoading(false))
  }, [audioCue?.filePath, audioCue?.id, syncCueDuration])

  // rAF loop for playhead while playing
  useEffect(() => {
    if (!isPlaying || !audioCue) {
      if (!isPlaying) setPlayFraction(audioCue ? (audioCue.startTime / 1000) / (buffer?.duration || 1) : 0)
      return
    }
    const tick = () => {
      const prog = audioPlayer.getProgress(audioCue.id)
      if (prog) setPlayFraction(prog.fraction)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying, audioCue?.id])

  // Redraw canvas whenever buffer, playFraction, or size changes
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const buf = bufferRef.current
    if (!canvas || !buf || !peaks) return
    const startFrac = audioCue ? audioCue.startTime / 1000 / buf.duration : 0
    drawWaveform(canvas, peaks, playFraction, startFrac)
  }, [buffer, peaks, playFraction, audioCue?.startTime])

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

  const handleClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioCue || !buffer) return
    const fraction = fractionFromEvent(e)
    const timeSeconds = fraction * buffer.duration
    const timeMs = timeSeconds * 1000

    // Always update the cue's startTime
    updateCue(audioCue.id, { startTime: timeMs })

    // If currently playing, seek in-place
    if (isPlaying) {
      await audioPlayer.seek(audioCue.id, timeSeconds)
    }

    setPlayFraction(fraction)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setHoverFraction(fractionFromEvent(e))
  }

  if (!audioCue) return null

  const totalDuration = buffer?.duration ?? audioCue.duration / 1000
  const hoverTime = hoverFraction != null ? hoverFraction * totalDuration : null
  const playTime = playFraction * totalDuration
  const startTimeSec = audioCue.startTime / 1000

  return (
    <div className="waveform-panel">
      <div className="waveform-header">
        <span className="waveform-filename">
          {audioCue.filePath ? audioCue.filePath.split(/[\\/]/).pop() : 'No file selected'}
        </span>
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
        {!loading && !buffer && audioCue.filePath && (
          <div className="waveform-loading">Could not decode audio.</div>
        )}
        {!audioCue.filePath && (
          <div className="waveform-loading">No audio file selected.</div>
        )}
        <canvas
          ref={canvasRef}
          className="waveform-canvas"
          style={{ opacity: loading || !buffer ? 0 : 1 }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverFraction(null)}
          title="Click to set start time / seek"
        />
      </div>
    </div>
  )
}
