import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useStore, useSelectedCue } from '../../store'
import { audioEngine } from '../../engine/audioEngineClient'
import { cueEngine } from '../../engine/CueEngine'
import { PlaybackWarnings } from '../layout/PlaybackWarnings'
import {
  DPR, drawWaveform, PEAK_BUCKETS, FULL_VIEW,
  type WaveformLayout, type WaveformPeaks, type WaveformRegion, type WaveformView
} from '../../utils/waveform'
import { regionEndMs } from '../../utils/cueSplit'
import { playRegion } from '../../utils/silenceTrim'
import type { AudioCue, DevampCue } from '../../../../shared/cue'
import { AUDIO_MAX_SLICES } from '../../../../shared/audio'
import { addMarker, slicesInUse, type CueSlices } from '../../../../shared/slices'
import {
  canAddMarkerAt,
  isJump,
  mergeOnDelete,
  pieceFromEngine,
  placeFromPosition,
  placeMarker,
  removalSentence,
  roundMarkerMs,
  zeroCrossingNear,
  ZERO_CROSSING_REACH_MS,
  type SlicePlace
} from '../../utils/sliceMarkers'
import { SliceLayer, SLICE_LANE_PX, slicesOf, type SliceJump, type SliceLive } from './SliceLayer'
import './WaveformPanel.css'

/**
 * A time in the panel, to a tenth of a second — the precision the inspector's own fields
 * are written to, so the two cannot come to disagree about where a boundary is. Rounded
 * rather than truncated: 997 ms is a second to anybody reading it, and showing it as
 * "0:00.9" beside a field that says 1.0 is the panel calling its own number a lie.
 */
function formatTime(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100)
  const min = Math.floor(tenths / 600)
  const sec = (tenths % 600) / 10
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

/**
 * How close a press has to be to a transient to land on it.
 *
 * Two reaches, and the nearer one wins. Thirty-two pixels is what a hand needs: a
 * whole-file view puts a second of music in about 400 pixels, so the attack of a note is
 * a target nobody hits exactly, and four pixels was a snap that never fired.
 *
 * The time is what keeps that honest on a long file. The panel has one zoom, so a
 * hundred pixels is a tenth of a second in a three-second walk-in and half a minute in a
 * ten-minute act — and a boundary that jumped half a minute to the nearest hit would be
 * the panel moving the operator's work for them.
 */
const SNAP_PX = 32
const SNAP_MS = 100

/**
 * How much of the file the panel can show, as multiples of it: 1× is the whole file and
 * the steps after it are the detail an operator actually reaches for — the note a
 * boundary belongs on is a fifth of a second and a fifth of a second has to be wider
 * than a fingertip. A ladder rather than a continuous scale, because a panel with no
 * scrollbar has to be able to come back to exactly where it started.
 */
const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32]

/**
 * The window beyond which the panel stops asking for onsets. A window this long is
 * about two minutes of reading on the engine's side, and the ticks it returns are places
 * a hand cannot aim at anyway: at that span a hit is a fraction of a pixel, and a
 * boundary that jumped to one would be the panel moving the operator's work.
 */
const ONSET_WINDOW_MS = 120_000
const ONSET_CAP = 2000
/** One question per resting place: a pan drags the window across the file frame by frame. */
const WINDOW_DEBOUNCE_MS = 120

/** How long a jump of the playhead stays drawn, and a slice edit's sentence stays in the header, ms. */
const JUMP_SHOWN_MS = 900
const STATUS_SHOWN_MS = 5000

/** The last reveal of the waveform a panel has acted on, so a panel mounted by one acts on it once. */
let revealHandled = 0

export function WaveformPanel() {
  const selectedCue = useSelectedCue()
  const updateCue = useStore(s => s.updateCue)
  const setRegionBoundary = useStore(s => s.setRegionBoundary)
  const endRegionDrag = useStore(s => s.endRegionDrag)
  const syncCueDuration = useStore(s => s.syncCueDuration)
  const running = useStore(s => s.running)
  const cursor = useStore(s => s.waveformCursor)
  const setWaveformCursor = useStore(s => s.setWaveformCursor)
  const setCueSlices = useStore(s => s.setCueSlices)
  const endSliceDrag = useStore(s => s.endSliceDrag)
  const selectSliceMarker = useStore(s => s.selectSliceMarker)
  const selectedSliceMarker = useStore(s => s.selectedSliceMarker)
  const waveformReveal = useStore(s => s.waveformReveal)
  const cues = useStore(s => s.cues)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const peaksRef = useRef<WaveformPeaks | null>(null)
  /** The file the drawn envelope belongs to, so another file's shape is never drawn for it. */
  const peaksFileRef = useRef<string | null>(null)
  const durationRef = useRef(0)
  const layoutRef = useRef<WaveformLayout | null>(null)
  /** The drag in progress, or null. `grab` is the file fraction the boundary started at. */
  const dragRef = useRef<{ mode: DragMode; grab: number } | null>(null)

  // How much of the file the panel shows, and where that window starts: 1× is the whole
  // file, and the window is in milliseconds from the top of it. Session state, like the
  // cursor: what the operator is looking at is not part of the show. It begins again at
  // the whole file for each cue, because a zoom is a reading of the track it was made on.
  const [zoom, setZoom] = useState(ZOOM_LEVELS[0])
  const [viewStartMs, setViewStartMs] = useState(0)

  // The engine's bounded envelope for the file: interleaved min/max buckets, never the
  // media itself.
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null)
  // Where the notes and hits begin in this file, in ms. Fetched with the envelope and
  // kept with it: the ticks are part of reading the file, not a second question about it.
  const [onsets, setOnsets] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [playFraction, setPlayFraction] = useState(0)
  const [hoverFraction, setHoverFraction] = useState<number | null>(null)
  const [dragging, setDragging] = useState<DragMode | null>(null)
  // The waveform's width in CSS px, which is what the slice markers are placed against.
  const [stageWidth, setStageWidth] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  /** The file's sample rate, from the envelope: what a zero crossing is read at. */
  const sampleRateRef = useRef(0)
  // Where the music is in the slices while the cue plays, and the jumps it has just made.
  const [live, setLive] = useState<SliceLive | null>(null)
  const liveRef = useRef<{ place: SlicePlace; positionMs: number; at: number } | null>(null)
  const [jumps, setJumps] = useState<SliceJump[]>([])
  const [jumpCount, setJumpCount] = useState(0)
  const jumpIdRef = useRef(0)
  // What the last slice edit did, said in the header for a moment and to a screen reader.
  const [status, setStatus] = useState('')
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The slices a removal's sentence is about; undefined when the sentence is about nothing in particular. */
  const statusSlicesRef = useRef<CueSlices | null | undefined>(undefined)
  // The waveform's context menu, at a client point and the file time under it.
  const [menu, setMenu] = useState<{ x: number; y: number; ms: number } | null>(null)
  /** A marker grip a reveal asked to have focused, waiting for the grip to be drawn. */
  const pendingGripRef = useRef<number | null>(null)

  const audioCue = selectedCue?.type === 'audio' ? selectedCue as AudioCue : null
  /** The cue as it stands, for the loops and handlers that outlive the render that made them. */
  const cueRef = useRef(audioCue)
  cueRef.current = audioCue
  /**
   * Whether the trim applies to this cue here: the cue asks for it and this machine is
   * licensed to apply it. The same two questions `CueEngine` asks before a firing, so
   * what the panel shades is what the engine will sound.
   */
  const trim = audioCue?.trimSilence === true
  const runState = audioCue ? running.get(audioCue.id) : undefined
  const isPlaying = runState?.state === 'playing'

  /**
   * The cursor, when it is this cue's. It is placed against the file the panel is
   * showing, so a cursor left on another track is not a place in this one — drawing it
   * here would be this panel claiming the operator pointed at a time they did not.
   */
  const cursorMs = cursor !== null && cursor.cueId === audioCue?.id ? cursor.ms : null

  /**
   * The file length in ms, from the envelope the engine sent, or the cue's own. The ref is
   * seconds and the cue's length is milliseconds, so only the ref is scaled: scaling both
   * made the fallback a thousand times the file, for as long as there was no envelope —
   * while one was on its way, and for good when the file could not be read.
   */
  const totalMs = (): number =>
    durationRef.current > 0 ? durationRef.current * 1000 : audioCue?.duration ?? 0

  /** A span of the file, in ms, as fractions of it; a null end is the end of the file. */
  const fractionsOf = (startMs: number, endMs: number | null, totalMs: number): WaveformRegion => {
    if (totalMs <= 0) return { start: 0, end: 1 }
    return {
      start: Math.max(0, startMs / totalMs),
      end: Math.min((endMs ?? totalMs) / totalMs, 1)
    }
  }

  /** The cue's region as fractions of the file. `totalMs` is milliseconds, like the cue. */
  const regionOf = (cue: AudioCue, totalMs: number): WaveformRegion =>
    fractionsOf(cue.startTime, regionEndMs(cue), totalMs)

  /**
   * What the cue will play, as fractions of the file: the region with the silence trim
   * folded in. The region is the operator's; this is the part of it with sound in it.
   */
  const playedOf = (cue: AudioCue, totalMs: number): WaveformRegion => {
    const played = playRegion(cue, trim)
    return fractionsOf(played.startMs, played.endMs, totalMs)
  }

  // The window the panel is looking at, in ms and clamped to the file. Clamped on the way
  // out rather than on the way in: a cue's length arrives from the engine after the
  // first frame, and a zoom chosen against a length that is not known yet must not be
  // able to point outside the file once it is.
  const total = totalMs()
  const spanMs = zoom > 1 ? total / zoom : total
  const viewFromMs = Math.max(0, Math.min(viewStartMs, Math.max(0, total - spanMs)))
  const view: WaveformView = total > 0
    ? { start: viewFromMs / total, end: (viewFromMs + spanMs) / total }
    : FULL_VIEW

  // A different cue is a different file: the zoom and the place went with the last one.
  useEffect(() => {
    setZoom(ZOOM_LEVELS[0])
    setViewStartMs(0)
    setMenu(null)
  }, [audioCue?.id])

  /** The file fraction under a client x, read through the window on screen. */
  const fractionAt = (clientX: number): number => {
    const canvas = canvasRef.current
    if (!canvas || total <= 0) return 0
    const rect = canvas.getBoundingClientRect()
    const rel = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.max(0, Math.min(1, (viewFromMs + rel * spanMs) / total))
  }

  // What the rAF loop and the wheel handler read: they run outside the render that made
  // them, and the window moves under them between frames.
  const viewRef = useRef({ startMs: viewFromMs, spanMs, total })
  viewRef.current = { startMs: viewFromMs, spanMs, total }
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {})
  wheelRef.current = (e: WheelEvent): void => {
    const canvas = canvasRef.current
    if (!canvas || total <= 0 || spanMs <= 0) return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const index = ZOOM_LEVELS.indexOf(zoom)
      const next = ZOOM_LEVELS[Math.max(0, Math.min(index + (e.deltaY < 0 ? 1 : -1), ZOOM_LEVELS.length - 1))]
      if (next === zoom) return
      const keepMs = fractionAt(e.clientX) * total
      const keepRel = Math.max(0, Math.min(1, (keepMs - viewFromMs) / spanMs))
      applyZoom(next, keepMs, keepRel)
      return
    }
    // A plain wheel pans: the file is the only axis the panel has, and a view that
    // cannot be moved is a zoom the operator cannot use.
    panBy(((e.deltaX !== 0 ? e.deltaX : e.deltaY) / canvas.getBoundingClientRect().width) * spanMs)
  }

  /**
   * The wheel is this panel's zoom and pan. It is a listener of its own rather than a
   * React handler because React attaches wheel handlers passively: a Ctrl+wheel that
   * cannot call `preventDefault` is the whole window zooming instead of the file.
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const listener = (e: WheelEvent): void => wheelRef.current(e)
    canvas.addEventListener('wheel', listener, { passive: false })
    return () => canvas.removeEventListener('wheel', listener)
  }, [audioCue?.id])

  /** Where the eye already is: the cursor, or the playing cue, or the middle of the window. */
  const anchorMs = (): number => {
    if (cursorMs !== null) return cursorMs
    if (isPlaying) return playFraction * total
    return viewFromMs + spanMs / 2
  }

  /**
   * Moves to a zoom level with a time in the file kept where it is on screen: zooming in
   * on a boundary the operator cannot see any more is the panel losing their place.
   */
  const applyZoom = (level: number, keepMs: number, keepRel: number): void => {
    if (total <= 0) return
    const next = Math.max(ZOOM_LEVELS[0], Math.min(level, ZOOM_LEVELS[ZOOM_LEVELS.length - 1]))
    const nextSpan = next > 1 ? total / next : total
    const start = Math.max(0, Math.min(keepMs - keepRel * nextSpan, Math.max(0, total - nextSpan)))
    setZoom(next)
    setViewStartMs(start)
  }

  /** One press of the zoom buttons. */
  const zoomBy = (step: number): void => {
    if (total <= 0) return
    const level = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.indexOf(zoom) + step, ZOOM_LEVELS.length - 1))]
    if (level === zoom) return
    const keepMs = anchorMs()
    const keepRel = spanMs > 0 ? (keepMs - viewFromMs) / spanMs : 0.5
    applyZoom(level, keepMs, Math.max(0, Math.min(1, keepRel)))
  }

  const panBy = (ms: number): void => {
    if (total <= 0 || spanMs >= total) return
    setViewStartMs(Math.max(0, Math.min(viewFromMs + ms, total - spanMs)))
  }

  // Refuse a drag outside the panel without leaving the panel stuck in a drag: the
  // pointer is captured, but a window blur (a desktop switch) never delivers the up.
  useEffect(() => {
    const cancel = (): void => { dragRef.current = null; setDragging(null) }
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [])

  // The engine is asked about the window on screen rather than about the file: the
  // envelope of what is visible, and — while the window is short enough that a hit is a
  // place a hand can aim at — the onsets inside it. That is what keeps a twelve-hour
  // file's panel proportional to the screen instead of to the file, and what lets a zoom
  // ask its own question and get a sharper answer than a whole-file envelope could hold.
  useEffect(() => {
    if (!audioCue?.filePath) {
      peaksRef.current = null
      peaksFileRef.current = null
      durationRef.current = 0
      setPeaks(null)
      setOnsets([])
      return
    }

    // A different file is a different drawing: the shape of the last one must not stand
    // in for it while its own envelope is on its way.
    if (peaksFileRef.current !== audioCue.filePath) {
      peaksRef.current = null
      peaksFileRef.current = audioCue.filePath
      // The length went with the envelope it came from: left behind, the header and every
      // press on the panel read the last file's length until this one's own arrived.
      durationRef.current = 0
      setPeaks(null)
      setOnsets([])
    }

    let current = true
    setLoading(true)
    // A pan drags the window across the file frame by frame; one question per resting
    // place is the same answer for a fraction of the reading. The first question about a
    // file is asked at once: there is nothing on screen to hold the place for it.
    const timer = setTimeout(() => {
      // The window as it stands when the question is asked, rather than as it stood when
      // the effect ran: a file's length arriving can move the clamped window under it.
      const { startMs, spanMs: span, total: fileMs } = viewRef.current
      const region = span > 0 && span < fileMs ? { startMs, endMs: startMs + span } : undefined
      // The envelope is what is drawn and the onsets are what a drag snaps to; they
      // arrive independently, and a file whose onsets cannot be read still has a waveform.
      if (region === undefined || spanMs <= ONSET_WINDOW_MS) {
        audioEngine.onsets(audioCue.filePath, 1, ONSET_CAP, region).then(result => {
          if (current) setOnsets(result.onsetsMs)
        }).catch(() => {
          if (current) setOnsets([])
        })
      } else {
        // Ticks a hand cannot aim at are not ticks: at this span a hit is a fraction of
        // a pixel, and asking for every one of them across twelve hours is a minute of
        // reading for nothing on screen.
        setOnsets([])
      }
      audioEngine.waveform(audioCue.filePath, PEAK_BUCKETS, region)
        .then(data => {
          if (!current) return
          const fileMs = data.durationMs
          const envelope: WaveformPeaks = {
            values: data.values,
            buckets: data.buckets,
            from: fileMs > 0 ? data.startMs / fileMs : 0,
            to: fileMs > 0 ? data.endMs / fileMs : 1,
            sampled: data.sampled
          }
          peaksRef.current = envelope
          durationRef.current = fileMs / 1000
          sampleRateRef.current = data.sampleRate
          setPeaks(envelope)
          if (fileMs > 0) syncCueDuration(audioCue.id, Math.round(fileMs))
        })
        .catch(() => {
          // A file the engine cannot read leaves the panel empty rather than showing
          // the previous cue's waveform against this cue's timing.
          if (!current) return
          peaksRef.current = null
          durationRef.current = 0
          setPeaks(null)
        })
        .finally(() => { if (current) setLoading(false) })
    }, peaksRef.current === null ? 0 : WINDOW_DEBOUNCE_MS)

    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [audioCue?.filePath, audioCue?.id, zoom, viewStartMs, syncCueDuration])

  /**
   * Where the music is in the slices, from a progress reading: the engine's own report of the
   * slice and its pass when it gives one, and otherwise the piece the position is in, with a
   * pass counted at each move back inside it. A move back, or forward further than the time
   * since the last reading could carry it, is a jump, and is drawn.
   */
  const followSlices = (positionMs: number, reported: { index: number; pass: number } | null | undefined): void => {
    const cue = cueRef.current
    if (!cue || !slicesInUse(cue.slices)) {
      if (liveRef.current !== null) { liveRef.current = null; setLive(null) }
      return
    }
    const previous = liveRef.current
    if (previous !== null && previous.positionMs === positionMs) return
    const slices = cue.slices
    // The engine's pieces are cut from the region it was sent — the trim folded in — so its
    // index is read against the same one.
    const sent = playRegion(cue, cue.trimSilence === true)
    const fromEngine = reported
      ? pieceFromEngine(slices, sent.startMs, sent.endMs ?? (totalMs() || cue.duration), reported.index)
      : null
    const place: SlicePlace = reported && fromEngine !== null
      ? { piece: fromEngine, pass: Math.max(1, reported.pass) }
      : placeFromPosition(slices, positionMs, previous)
    const now = performance.now()
    if (previous !== null && isJump(previous.positionMs, positionMs, now - previous.at, cue.playbackRate)) {
      const id = ++jumpIdRef.current
      setJumps(current => [...current.slice(-3), { id, fromMs: previous.positionMs, toMs: positionMs }])
      setJumpCount(count => count + 1)
      setTimeout(() => setJumps(current => current.filter(jump => jump.id !== id)), JUMP_SHOWN_MS)
    }
    liveRef.current = { place, positionMs, at: now }
    setLive(current => current !== null && current.place.piece === place.piece && current.place.pass === place.pass
      ? current
      : { place, positionMs })
  }

  // rAF loop for playhead while playing: the client keeps the engine's last reported
  // position, so a frame costs nothing across IPC.
  useEffect(() => {
    if (!isPlaying || !audioCue) {
      if (!isPlaying) {
        const length = totalMs()
        setPlayFraction(audioCue && length > 0 ? audioCue.startTime / length : 0)
      }
      liveRef.current = null
      setLive(null)
      setJumps([])
      return
    }
    const tick = () => {
      const prog = audioEngine.getProgress(audioCue.id)
      if (prog) {
        setPlayFraction(prog.fraction)
        followSlices(prog.elapsedMs, prog.slice)
        // A zoomed window the music has walked out of is a window on nothing: the panel
        // follows the playhead back into view, because the sound is what the operator is
        // listening to.
        const { startMs, spanMs: span, total: length } = viewRef.current
        const atMs = prog.fraction * length
        if (span < length && (atMs < startMs || atMs > startMs + span)) {
          setViewStartMs(Math.max(0, Math.min(atMs - span / 2, length - span)))
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying, audioCue?.id])

  // Redraw canvas whenever the envelope, the playhead, the region, the window or the
  // cursor changes
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const envelope = peaksRef.current
    if (!canvas || !envelope || !audioCue) return
    const length = totalMs()
    const region = regionOf(audioCue, length)
    const shown = cursorMs === null ? null : Math.min(Math.max(cursorMs / length, 0), 1)
    layoutRef.current = drawWaveform(canvas, envelope, {
      region,
      played: playedOf(audioCue, length),
      view,
      play: isPlaying ? playFraction : null,
      cursor: shown,
      onsets: length > 0 ? onsets.map(ms => ms / length) : []
    })
  }, [peaks, playFraction, audioCue?.startTime, audioCue?.endTime, audioCue?.duration, audioCue?.soundRegion, trim, cursorMs, isPlaying, onsets, view.start, view.end])

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
      setStageWidth(width)
      draw()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [draw])

  /**
   * The same place, moved onto a note or a hit if one is close enough to be what the
   * operator meant. The pixels are read through the window on screen, so what counts as
   * close is what the hand can reach — and the time cap keeps that honest however far in
   * the panel is zoomed.
   */
  const snap = (clientX: number): number => {
    const canvas = canvasRef.current
    if (!canvas || total <= 0 || onsets.length === 0 || spanMs <= 0) return fractionAt(clientX)
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    let best: number | null = null
    let bestPixels = SNAP_PX + 1
    for (const onset of onsets) {
      const pixels = Math.abs(((onset - viewFromMs) / spanMs) * rect.width - x)
      if (pixels < bestPixels) {
        bestPixels = pixels
        best = onset
      }
    }
    if (best === null || bestPixels > SNAP_PX) return fractionAt(clientX)
    // Both reaches: near enough in the hand, and near enough in the music.
    if (Math.abs(best - fractionAt(clientX) * total) > SNAP_MS) return fractionAt(clientX)
    return best / total
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
    if (layout.handles.end !== null && reach(layout.handles.end) <= layout.handles.end.r) return 'end'
    if (layout.handles.start !== null && reach(layout.handles.start) <= layout.handles.start.r) return 'start'
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
    // A grip drag reports every pointer move; the store folds them into the one edit the
    // drag opened, and `endRegionDrag` tells it the pen is up.
    setRegionBoundary(cue.id, mode, Math.round(fraction * total), true)
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
    const fraction = snap(e.clientX)
    const timeMs = fraction * total
    setWaveformCursor(cue.id, timeMs)
    setPlayFraction(fraction)
    if (isPlaying) cueEngine.seekCue(cue.id, timeMs)
    dragRef.current = { mode: 'cursor', grab: fraction }
    setDragging('cursor')
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const fraction = snap(e.clientX)
    const drag = dragRef.current
    if (!drag) {
      setHoverFraction(fraction)
      return
    }
    const total = totalMs()
    const timeMs = fraction * total
    if (drag.mode === 'cursor') {
      if (audioCue) setWaveformCursor(audioCue.id, timeMs)
      setPlayFraction(fraction)
      if (isPlaying && audioCue) cueEngine.seekCue(audioCue.id, timeMs)
    } else {
      moveBoundary(fraction, drag.mode)
    }
    setHoverFraction(fraction)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // A grip drag is over: the next one is a new edit, not the rest of this one.
    if (dragRef.current !== null && dragRef.current.mode !== 'cursor') endRegionDrag()
    dragRef.current = null
    setDragging(null)
  }

  // ── Slices ───────────────────────────────────────────────────────────────

  /** Says what a slice edit did, in the header and to a screen reader, for a moment. */
  const announce = (text: string): void => {
    setStatus(text)
    if (statusTimer.current !== null) clearTimeout(statusTimer.current)
    statusTimer.current = setTimeout(() => setStatus(''), STATUS_SHOWN_MS)
  }
  useEffect(() => () => { if (statusTimer.current !== null) clearTimeout(statusTimer.current) }, [])
  // A sentence about a removal stands only while the slices are the ones the removal left.
  useEffect(() => {
    if (statusSlicesRef.current !== undefined && audioCue?.slices !== statusSlicesRef.current) {
      statusSlicesRef.current = undefined
      setStatus('')
    }
  }, [audioCue?.slices, audioCue?.id])

  /** The cue as the store holds it now. */
  const currentCue = (): AudioCue | null => {
    const id = cueRef.current?.id
    const found = useStore.getState().cues.find(c => c.id === id)
    return found?.type === 'audio' ? found as AudioCue : null
  }

  /**
   * The zero crossing nearest a marker, read from the file a few milliseconds either side of
   * it at one bucket a sample — or the marker where it is, when the file cannot say. A cut
   * between two samples of opposite sign is a click; a move of a few milliseconds is not one
   * anybody hears.
   */
  const refine = async (ms: number): Promise<number> => {
    const cue = cueRef.current
    const rate = sampleRateRef.current
    const fileMs = totalMs()
    if (!cue?.filePath || rate <= 0) return ms
    // Frame-aligned, so a bucket is exactly one sample: a bucket with none in it reads as zero.
    const first = Math.max(0, Math.round(((ms - ZERO_CROSSING_REACH_MS) * rate) / 1000))
    const last = Math.round((Math.min(fileMs, ms + ZERO_CROSSING_REACH_MS) * rate) / 1000)
    const buckets = last - first
    if (buckets < 2 || buckets > 4096) return ms
    try {
      const data = await audioEngine.waveform(cue.filePath, buckets, {
        startMs: ((first + 0.25) * 1000) / rate,
        endMs: ((last + 0.25) * 1000) / rate
      })
      if (data.sampled || data.buckets !== buckets) return ms
      const at = zeroCrossingNear(data.values, data.buckets, data.startMs, data.endMs, ms)
      return at === null || Math.abs(at - ms) > ZERO_CROSSING_REACH_MS ? ms : roundMarkerMs(at)
    } catch {
      return ms
    }
  }

  const focusGrip = (index: number): void => {
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(`.slice-marker-grip[data-marker="${index}"]`)?.focus({ preventScroll: true })
    })
  }

  /**
   * Adds a marker at a file time, as one edit, and moves it onto the zero crossing beside it
   * as part of the same edit. The piece it lands in is cut in two and both halves keep its count.
   */
  const addSliceMarker = (ms: number): void => {
    const cue = currentCue()
    if (!cue) return
    const fileMs = totalMs()
    const at = roundMarkerMs(ms)
    if (!canAddMarkerAt(cue.slices, at, fileMs, AUDIO_MAX_SLICES - 1)) {
      announce((cue.slices?.markers.length ?? 0) >= AUDIO_MAX_SLICES - 1
        ? `A cue holds at most ${AUDIO_MAX_SLICES - 1} markers`
        : 'No marker there: too close to another, or to the end of the file')
      return
    }
    const next = addMarker(cue.slices, at)
    const gesture = `add:${at}`
    setCueSlices(cue.id, next, gesture)
    const index = next.markers.indexOf(at)
    selectSliceMarker({ cueId: cue.id, index })
    focusGrip(index)
    void refine(at).then(moved => {
      const now = currentCue()
      if (!now?.slices || moved === at || now.slices.markers[index] !== at) return
      setCueSlices(now.id, placeMarker(now.slices, index, moved, fileMs), gesture)
    }).finally(() => endSliceDrag())
  }

  /** Takes marker `index` out: the pieces either side join, and the header says which count they kept. */
  const removeSliceMarker = (index: number): void => {
    const cue = currentCue()
    if (!cue) return
    const removal = mergeOnDelete(slicesOf(cue), index)
    if (removal === null) return
    setCueSlices(cue.id, removal.slices)
    announce(removalSentence(removal))
    // The sentence is about these slices: an undo, or the next edit, makes it yesterday's news.
    statusSlicesRef.current = currentCue()?.slices ?? null
    const left = removal.slices.markers.length
    const nextFocus = Math.max(0, Math.min(index, left) - 1)
    selectSliceMarker(left === 0 ? null : { cueId: cue.id, index: nextFocus })
    if (left > 0) focusGrip(nextFocus)
    else stageRef.current?.focus({ preventScroll: true })
  }

  /** Where M puts a marker: on the music while it plays, on the cursor while it does not. */
  const markerPlace = (): number | null => {
    const cue = cueRef.current
    if (!cue) return null
    if (isPlaying) {
      const prog = audioEngine.getProgress(cue.id)
      if (prog) return prog.elapsedMs
    }
    return cursorMs
  }

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const el = e.target as HTMLElement
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'm' || e.key === 'M') {
      // The panel's own key: kept from the window, where a cue's hotkey could be M.
      e.preventDefault()
      e.stopPropagation()
      const at = markerPlace()
      if (at === null) announce('Click the waveform to place the cursor, then M adds a marker there')
      else addSliceMarker(at)
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && el === stageRef.current) {
      const marker = useStore.getState().selectedSliceMarker
      if (marker !== null && marker.cueId === cueRef.current?.id) {
        e.preventDefault()
        e.stopPropagation()
        removeSliceMarker(marker.index)
      }
    }
  }

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!audioCue || totalMs() <= 0) return
    // The first press of the pair put the cursor on the note; the marker goes where it is.
    const at = cursorMs ?? snap(e.clientX) * totalMs()
    addSliceMarker(at)
  }

  const handleContextMenu = (e: React.MouseEvent<HTMLElement>): void => {
    if (!audioCue || totalMs() <= 0) return
    e.preventDefault()
    const ms = snap(e.clientX) * totalMs()
    setMenu({ x: e.clientX, y: e.clientY, ms })
  }

  // The slices are redrawn when they or the window change, not on every frame of the playhead:
  // a cue cut at a hundred markers is a few hundred elements. So what the layer is handed is
  // stable — the window by its numbers, and the handlers through refs that always hold the
  // latest of them.
  const sliceView = useMemo(() => ({ startMs: viewFromMs, spanMs, width: stageWidth }), [viewFromMs, spanMs, stageWidth])
  const handlersRef = useRef({ refine, add: addSliceMarker, remove: removeSliceMarker })
  handlersRef.current = { refine, add: addSliceMarker, remove: removeSliceMarker }
  const stableRefine = useCallback((ms: number) => handlersRef.current.refine(ms), [])
  const stableAdd = useCallback((ms: number) => handlersRef.current.add(ms), [])
  const stableRemove = useCallback((index: number) => handlersRef.current.remove(index), [])
  const closeMenu = useCallback(() => setMenu(null), [])

  // A reveal from elsewhere — the inspector's "Show on waveform", or a marker picked in its
  // list — brings the panel's keyboard to the slices, and the picked marker into view.
  useEffect(() => {
    if (waveformReveal <= revealHandled || !audioCue) return
    revealHandled = waveformReveal
    const marker = useStore.getState().selectedSliceMarker
    const markers = audioCue.slices?.markers ?? []
    if (marker !== null && marker.cueId === audioCue.id && marker.index < markers.length) {
      const at = markers[marker.index]
      if (at < viewFromMs || at > viewFromMs + spanMs) {
        setViewStartMs(Math.max(0, Math.min(at - spanMs / 2, total - spanMs)))
      }
      pendingGripRef.current = marker.index
    } else {
      pendingGripRef.current = null
      requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }))
    }
  }, [waveformReveal, audioCue?.id])

  // The grip a reveal asked for, focused once it is drawn: a panel the reveal has just opened
  // has no width to place a marker at until its first measure.
  useEffect(() => {
    const index = pendingGripRef.current
    if (index === null) return
    const grip = panelRef.current?.querySelector<HTMLElement>(`.slice-marker-grip[data-marker="${index}"]`)
    if (!grip) return
    pendingGripRef.current = null
    grip.focus({ preventScroll: true })
  })

  if (!audioCue) return null

  const totalDuration = durationRef.current || audioCue.duration / 1000
  const hoverTime = hoverFraction != null ? hoverFraction * totalDuration : null
  const playTime = playFraction * totalDuration
  // The tag speaks for what the cue will play, which with the trim on is the measured
  // part of it rather than the region the operator drew. The ✕ beside it undoes an edit
  // of theirs, so it is offered only when there is one: a reset next to a region nobody
  // moved is a button that appears to do nothing.
  const played = playRegion(audioCue, trim)
  const playedEndMs = played.endMs ?? totalDuration * 1000
  const playsWholeFile = played.startMs <= 0 && playedEndMs >= totalDuration * 1000 - 1
  const regionEdited = audioCue.startTime > 0 || regionEndMs(audioCue) < totalDuration * 1000 - 1
  const cursorTime = cursorMs
  const cursorOverRegion = cursorTime !== null &&
    cursorTime > audioCue.startTime && cursorTime < regionEndMs(audioCue)

  const sliced = slicesInUse(audioCue.slices)
  const slices: CueSlices = slicesOf(audioCue)
  // A vamp the music is holding in, and the devamp that will let it go: the first in the list
  // of those aimed at this cue.
  const holding = live !== null && (slices.playCounts[live.place.piece] ?? 1) < 0
  const devamp = cues.find((c): c is DevampCue => c.type === 'devamp' && (c as DevampCue).targetCueId === audioCue.id)
  const devampName = devamp ? [devamp.number, devamp.name].filter(part => part !== '').join(' ') : null
  const markerSelected = selectedSliceMarker !== null && selectedSliceMarker.cueId === audioCue.id

  return (
    <div className="waveform-panel" ref={panelRef} onKeyDown={handlePanelKeyDown}>
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
        {peaks?.sampled && (
          <span
            className="waveform-sampled-tag"
            title="Drawn from samples of each column rather than every one: the shape of a long file, without reading all of it"
          >
            sampled
          </span>
        )}
        {!playsWholeFile && (
          <span className="waveform-region-tag" title="The part of the file this cue plays">
            plays {formatTime(played.startMs)}–{formatTime(playedEndMs)}
            {regionEdited && (
              <button
                onClick={() => updateCue(audioCue.id, { startTime: 0, endTime: null })}
                title="Play the whole file"
              >✕</button>
            )}
          </span>
        )}
        {cursorOverRegion && (
          <span className="waveform-cursor" title="Where a split would be made">
            split {formatTime(cursorTime)}
          </span>
        )}
        {holding && live !== null && (
          <span
            className="waveform-vamp-tag"
            data-pass={live.place.pass}
            title={devampName === null
              ? 'This vamp holds until a devamp aimed at this cue fires; none is in the list'
              : `Firing ${devampName} lets this pass finish and moves the music on`}
          >
            vamp · pass {live.place.pass} · {devampName === null ? 'no devamp aimed here' : `${devampName} releases it`}
          </span>
        )}
        <span className="waveform-slice-status" role="status" aria-live="polite" data-empty={status === ''}>
          {status}
        </span>
        <div className="waveform-zoom">
          <button
            className="waveform-zoom-btn"
            onClick={() => zoomBy(-1)}
            disabled={zoom <= ZOOM_LEVELS[0]}
            title="Zoom out: a wider part of the file"
          >−</button>
          <span className="waveform-zoom-label" title={`The panel is showing ${zoom === 1 ? 'the whole file' : `1/${zoom} of the file`}`}>
            {zoom}×
          </span>
          <button
            className="waveform-zoom-btn"
            onClick={() => zoomBy(1)}
            disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            title="Zoom in: further into the file"
          >+</button>
        </div>
      </div>
      <div className="waveform-canvas-frame">
        <div
          ref={stageRef}
          className="waveform-stage"
          tabIndex={0}
          data-lane={sliced}
          data-markers={slices.markers.length}
          data-jumps={jumpCount}
          style={{ ['--slice-lane' as string]: `${SLICE_LANE_PX}px` }}
          aria-label={`Waveform of ${audioCue.name || 'this cue'}: M adds a slice marker at the cursor${markerSelected ? ', Delete removes the selected one' : ''}`}
          aria-keyshortcuts="M"
          onContextMenu={handleContextMenu}
        >
        <div ref={containerRef} className="waveform-canvas-container">
          {/* The overlay is for a panel with nothing to draw. A window being re-measured
              has the previous envelope on screen, and a finger over the waveform while
              it is being redrawn is the operator placing a boundary, not a wait. */}
          {!peaks && loading && <div className="waveform-loading">Loading waveform…</div>}
          {!peaks && !loading && audioCue.filePath && (
            <div className="waveform-loading">Could not read the waveform.</div>
          )}
          {!audioCue.filePath && (
            <div className="waveform-loading">No audio file selected.</div>
          )}
          <canvas
            ref={canvasRef}
            className="waveform-canvas"
            data-dragging={dragging ?? undefined}
            data-onsets={onsets.length}
            style={{ opacity: peaks ? 1 : 0 }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onMouseLeave={() => { if (!dragRef.current) setHoverFraction(null) }}
            onDoubleClick={handleDoubleClick}
            title="Click to place the cursor — drag a handle to move the boundary — double-click or M adds a slice marker"
          />
        </div>
        {total > 0 && stageWidth > 0 && (
          <SliceLayer
            cue={audioCue}
            fileMs={total}
            view={sliceView}
            lane={sliced}
            onsets={onsets}
            live={live}
            jumps={jumps}
            refine={stableRefine}
            menu={menu}
            closeMenu={closeMenu}
            add={stableAdd}
            remove={stableRemove}
          />
        )}
        </div>
      </div>
    </div>
  )
}
