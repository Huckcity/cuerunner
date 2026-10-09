import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import ReactDOM from 'react-dom'
import { useStore } from '../../store'
import type { AudioCue } from '../../../../shared/cue'
import { AUDIO_MAX_SLICES } from '../../../../shared/audio'
import { playCountLabel, setPlayCount, SLICE_SKIP, SLICE_VAMP, type CueSlices } from '../../../../shared/slices'
import {
  canAddMarkerAt,
  countInWords,
  drawnPieces,
  formatMarkerTime,
  inSliceView,
  labelFit,
  mergeOnDelete,
  msToX,
  nudgeCount,
  passLabel,
  pieceLabel,
  placeMarker,
  snapToOnset,
  xToMs,
  type SlicePlace,
  type SliceView
} from '../../utils/sliceMarkers'
import '../cue-list/CueContextMenu.css'
import './SliceLayer.css'

/** The strip along the top of the waveform the pieces' counts and the markers' grips sit in, CSS px. */
export const SLICE_LANE_PX = 20

/** How far an arrow moves a marker, ms: plain, with Shift, with Alt. */
const NUDGE_MS = 10
const NUDGE_SHIFT_MS = 100
const NUDGE_ALT_MS = 1

/** The slices a cue has, or the one piece a cue without them is. */
export function slicesOf(cue: AudioCue): CueSlices {
  return cue.slices ?? { markers: [], playCounts: [1] }
}

/** Where the music is while the cue plays: its place in the slices, and a jump the panel is showing. */
export interface SliceLive {
  place: SlicePlace
  positionMs: number
}

/** A jump the playhead just made — a wrap or a skip — drawn for a moment so the eye can follow it. */
export interface SliceJump {
  id: number
  fromMs: number
  toMs: number
}

interface Props {
  cue: AudioCue
  /** The file's length, ms. */
  fileMs: number
  /** The window on screen, with the width it is drawn at. */
  view: SliceView
  /** Whether the lane is drawn: the cue has slices, or a marker is being placed. */
  lane: boolean
  onsets: readonly number[]
  live: SliceLive | null
  jumps: SliceJump[]
  /** Moves a marker that has just been placed onto the zero crossing nearest it; resolves to where it went. */
  refine: (ms: number) => Promise<number>
  /** The context menu the stage asked for, at a client point and a file time. */
  menu: { x: number; y: number; ms: number } | null
  closeMenu: () => void
  /** Adds a marker at a file time — the panel's own add, which M and a double-click use too. */
  add: (ms: number) => void
  /** Takes marker `index` out — the panel's own remove, which Delete on the panel uses too. */
  remove: (index: number) => void
}

/** A marker drag in progress: which marker, and whether it has moved. */
interface MarkerDrag {
  index: number
  pointerId: number
  moved: boolean
  /** Where it was when the press landed, for the readout. */
  startMs: number
}

/**
 * The slices on the waveform: a line for every marker with a grip in the lane above the file,
 * and every piece between them a region in that lane saying how often it plays. The lane is
 * where the pieces are pressed and the grips are held; the lines and the tints run down over
 * the file itself, so the music under a marker is the music the operator can see.
 */
export const SliceLayer = memo(function SliceLayer({ cue, fileMs, view, lane, onsets, live, jumps, refine, menu, closeMenu, add, remove }: Props) {
  const setCueSlices = useStore(s => s.setCueSlices)
  const endSliceDrag = useStore(s => s.endSliceDrag)
  const selected = useStore(s => s.selectedSliceMarker)
  const selectSliceMarker = useStore(s => s.selectSliceMarker)

  const slices = slicesOf(cue)
  const regionStart = cue.startTime
  const regionEnd = cue.endTime ?? (fileMs > 0 ? fileMs : cue.duration)
  const pieces = drawnPieces(slices, regionStart, regionEnd)
  const selectedIndex = selected !== null && selected.cueId === cue.id && selected.index < slices.markers.length
    ? selected.index
    : null

  const layerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<MarkerDrag | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  /** The piece whose count is being chosen, or null. */
  const [chooser, setChooser] = useState<number | null>(null)
  /** A gesture key per marker index, so each drag is one edit. */
  const gesture = (kind: string, index: number): string => `${kind}:${index}`

  const write = (next: CueSlices, drag?: string): void => setCueSlices(cue.id, next, drag)

  /** Marker `index` moved to `ms`, as part of the gesture named. */
  const move = (index: number, ms: number, drag: string): void => {
    write(placeMarker(slicesOf(currentCue()), index, ms, fileMs), drag)
  }

  /** The cue as the store holds it now: a handler runs after the render that made it. */
  const currentCue = (): AudioCue => {
    const found = useStore.getState().cues.find(c => c.id === cue.id)
    return found?.type === 'audio' ? found as AudioCue : cue
  }

  const focusPiece = (index: number): void => {
    requestAnimationFrame(() => {
      layerRef.current?.querySelector<HTMLElement>(`.slice-region[data-piece="${index}"]`)?.focus()
    })
  }

  /** Sets piece `index`'s count, as one edit. */
  const setCount = (index: number, count: number, drag?: string): void => {
    const current = slicesOf(currentCue())
    write(setPlayCount(current, index, count), drag)
  }

  // ── Marker drags ─────────────────────────────────────────────────────────

  const msAt = (clientX: number): number => {
    const rect = layerRef.current?.getBoundingClientRect()
    if (!rect) return view.startMs
    return xToMs(clientX - rect.left, view)
  }

  const startDrag = (e: ReactPointerEvent<HTMLElement>, index: number): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { index, pointerId: e.pointerId, moved: false, startMs: slices.markers[index] }
    setDragging(index)
    selectSliceMarker({ cueId: cue.id, index })
    // The grip takes the keyboard too, so the arrows and Delete act on what was just grabbed.
    const grip = layerRef.current?.querySelector<HTMLElement>(`.slice-marker-grip[data-marker="${index}"]`)
    grip?.focus({ preventScroll: true })
  }

  const dragMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const raw = msAt(e.clientX)
    // Shift is the free hand: no onset pulls the marker while it is held.
    const at = e.shiftKey ? raw : snapToOnset(raw, onsets, view)
    drag.moved = true
    move(drag.index, at, gesture('drag', drag.index))
  }

  const endDrag = (e: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setDragging(null)
    const key = gesture('drag', drag.index)
    if (!drag.moved || e.shiftKey) {
      endSliceDrag()
      return
    }
    // Onto the zero crossing beside where it was let go, as part of the same edit: a cut
    // between two samples of opposite sign is a click in the speakers.
    const placed = slicesOf(currentCue()).markers[drag.index]
    void refine(placed).then(at => {
      const now = slicesOf(currentCue()).markers[drag.index]
      if (now === placed && at !== placed) move(drag.index, at, key)
    }).finally(() => endSliceDrag())
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  const markerKey = (e: ReactKeyboardEvent<HTMLElement>, index: number): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      const step = e.altKey ? NUDGE_ALT_MS : e.shiftKey ? NUDGE_SHIFT_MS : NUDGE_MS
      const at = slicesOf(currentCue()).markers[index] + (e.key === 'ArrowLeft' ? -step : step)
      // A held arrow is one edit: the repeats fold into it until the key comes up.
      move(index, at, gesture('nudge', index))
      selectSliceMarker({ cueId: cue.id, index })
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      remove(index)
    }
  }

  const pieceKey = (e: ReactKeyboardEvent<HTMLElement>, index: number, count: number): void => {
    // Space is GO wherever it is pressed; on a slice it must not open the chooser as well.
    if (e.key === ' ') {
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      // Read from the store rather than the render: a held arrow's repeats outrun the redraw.
      const current = slicesOf(currentCue()).playCounts[index] ?? count
      setCount(index, nudgeCount(current, e.key === 'ArrowUp' ? 1 : -1), gesture('count', index))
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // A count straight from the keys: a digit is that many passes, 0 skips, V vamps.
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault()
      e.stopPropagation()
      setCount(index, Number(e.key))
    } else if (e.key === 'v' || e.key === 'V') {
      e.preventDefault()
      e.stopPropagation()
      setCount(index, SLICE_VAMP)
    }
  }

  const keyUp = (): void => endSliceDrag()

  // The count of a piece under the wheel: a turn up is one pass more. The wheel is a listener
  // of its own because React's are passive, and a wheel that cannot be kept is the dock scrolling.
  const lanesRef = useRef<HTMLDivElement>(null)
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {})
  wheelRef.current = (e: WheelEvent): void => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.slice-region')
    if (!target) return
    e.preventDefault()
    const index = Number(target.dataset.piece)
    const count = slicesOf(currentCue()).playCounts[index] ?? 1
    if (e.deltaY === 0) return
    setCount(index, nudgeCount(count, e.deltaY < 0 ? 1 : -1), gesture('wheel', index))
  }
  useEffect(() => {
    const el = lanesRef.current
    if (!el) return
    const listener = (e: WheelEvent): void => wheelRef.current(e)
    el.addEventListener('wheel', listener, { passive: false })
    // A wheel is a gesture with no "up": it ends when the hand leaves the lane.
    const leave = (): void => endSliceDrag()
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('wheel', listener)
      el.removeEventListener('pointerleave', leave)
    }
  }, [lane, endSliceDrag])

  // ── Drawing ──────────────────────────────────────────────────────────────

  const x = (ms: number): number => msToX(ms, view)
  const visible = (fromMs: number, toMs: number): boolean =>
    toMs >= view.startMs && fromMs <= view.startMs + view.spanMs
  const clampX = (value: number): number => Math.max(0, Math.min(view.width, value))

  const total = pieces.length
  const regionPieces = pieces.filter(piece => visible(piece.fromMs, piece.toMs))

  const isOutside = (marker: number): boolean => marker <= regionStart || marker >= regionEnd

  /** The lane's contents in file order: a grip sorts before the piece that starts at its marker. */
  const laneItems: Array<{ kind: 'piece'; order: number; at: number } | { kind: 'grip'; index: number; at: number }> = [
    ...pieces.map((piece, order) => ({ kind: 'piece' as const, order, at: piece.fromMs + 1e-6 })),
    ...slices.markers.map((marker, index) => ({ kind: 'grip' as const, index, at: marker }))
  ].sort((a, b) => a.at - b.at)

  const renderPiece = (order: number) => {
    const piece = pieces[order]
    if (!visible(piece.fromMs, piece.toMs)) return null
    const left = clampX(x(piece.fromMs))
    const right = clampX(x(piece.toMs))
    const width = Math.max(0, right - left)
    const playing = live !== null && live.place.piece === piece.index
    const fit = labelFit(width)
    const pass = playing && fit === 'full' ? passLabel(piece.count, live.place.pass) : ''
    const name = `Slice ${order + 1} of ${total}, ${formatMarkerTime(piece.fromMs)} to ${formatMarkerTime(piece.toMs)}, ${countInWords(piece.count)}` +
      (playing ? `, playing${piece.count < 0 || piece.count > 1 ? `, pass ${live.place.pass}` : ''}` : '')
    return (
      <button
        key={`piece-${piece.index}`}
        type="button"
        className="slice-region"
        data-piece={piece.index}
        data-count={piece.count}
        data-vamp={piece.count < 0}
        data-skip={piece.count === SLICE_SKIP}
        data-playing={playing}
        data-fit={fit}
        style={{ left, width }}
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={chooser === piece.index}
        title={`${name} — click to choose, ↑↓ to step, 0–9 or V`}
        onPointerDown={e => e.stopPropagation()}
        onClick={() => setChooser(open => open === piece.index ? null : piece.index)}
        onKeyDown={e => pieceKey(e, piece.index, piece.count)}
        onKeyUp={keyUp}
      >
        <span className="slice-region-count">{pieceLabel(piece.count, fit)}</span>
        {pass !== '' && <span className="slice-region-pass">{pass}</span>}
      </button>
    )
  }

  const renderGrip = (index: number) => {
    const marker = slices.markers[index]
    if (!inSliceView(marker, view)) return null
    const outside = isOutside(marker)
    const after = slices.playCounts[index + 1] ?? 1
    return (
      <div
        key={`grip-${index}`}
        className="slice-marker-grip"
        data-marker={index}
        data-selected={selectedIndex === index}
        data-dragging={dragging === index}
        data-outside={outside}
        style={{ left: x(marker) }}
        role="slider"
        tabIndex={0}
        aria-label={`Slice marker ${index + 1} of ${slices.markers.length}${outside ? ', outside the region' : ''}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(fileMs)}
        aria-valuenow={Math.round(marker)}
        aria-valuetext={`${formatMarkerTime(marker)}, then ${playCountLabel(after)}`}
        aria-keyshortcuts="ArrowLeft ArrowRight Delete"
        title={`Marker ${index + 1} at ${formatMarkerTime(marker)} — drag to move (Shift: no snap), ←→ to nudge, Delete to remove`}
        onPointerDown={e => startDrag(e, index)}
        onPointerMove={dragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onFocus={() => selectSliceMarker({ cueId: cue.id, index })}
        onKeyDown={e => markerKey(e, index)}
        onKeyUp={keyUp}
        onDoubleClick={e => e.stopPropagation()}
      />
    )
  }

  return (
    <div
      ref={layerRef}
      className="slice-layer"
      data-lane={lane}
      data-markers={slices.markers.length}
      data-playing-piece={live?.place.piece ?? undefined}
      data-pass={live?.place.pass ?? undefined}
      style={{ ['--slice-lane' as string]: `${SLICE_LANE_PX}px` }}
    >
      {/* The tints run down over the file: a vamp is a colour, a skip is struck out, and the
          piece the music is in is lit. */}
      {regionPieces.map(piece => {
        const left = clampX(x(piece.fromMs))
        const right = clampX(x(piece.toMs))
        if (right - left < 0.5) return null
        const playing = live !== null && live.place.piece === piece.index
        const kind = piece.count < 0 ? 'vamp' : piece.count === SLICE_SKIP ? 'skip' : null
        if (kind === null && !playing) return null
        return (
          <div
            key={`tint-${piece.index}`}
            className="slice-tint"
            data-kind={kind ?? undefined}
            data-playing={playing}
            style={{ left, width: right - left }}
          />
        )
      })}

      {/* The lane: every piece and every marker's grip, in the order they come in the file, so
          Tab walks the track from left to right — a piece, the marker that ends it, the next. */}
      {lane && (
        <div ref={lanesRef} className="slice-lane" role="group" aria-label={`Slices of ${cue.name || 'this cue'}`}>
          {laneItems.map(item => item.kind === 'piece' ? renderPiece(item.order) : renderGrip(item.index))}
        </div>
      )}

      {slices.markers.map((marker, index) => {
        if (!inSliceView(marker, view)) return null
        return (
          <div
            key={`marker-${index}`}
            className="slice-marker"
            data-marker={index}
            data-selected={selectedIndex === index}
            data-outside={isOutside(marker)}
            data-dragging={dragging === index}
            style={{ left: x(marker) }}
          >
            <div
              className="slice-marker-hit"
              onPointerDown={e => startDrag(e, index)}
              onPointerMove={dragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={e => e.stopPropagation()}
            />
            {dragging === index && (
              <span className="slice-marker-time">{formatMarkerTime(marker)}</span>
            )}
          </div>
        )
      })}

      {jumps.map(jump => {
        const from = clampX(x(jump.fromMs))
        const to = clampX(x(jump.toMs))
        const left = Math.min(from, to)
        return (
          <div
            key={jump.id}
            className="slice-jump"
            data-direction={jump.toMs < jump.fromMs ? 'back' : 'forward'}
            style={{ left, width: Math.max(2, Math.abs(from - to)) }}
          />
        )
      })}

      {chooser !== null && (
        <CountChooser
          piece={chooser}
          order={pieces.findIndex(piece => piece.index === chooser)}
          count={slices.playCounts[chooser] ?? 1}
          anchorX={(() => {
            const piece = pieces.find(p => p.index === chooser)
            return piece ? (clampX(x(piece.fromMs)) + clampX(x(piece.toMs))) / 2 : view.width / 2
          })()}
          width={view.width}
          onChoose={count => { setCount(chooser, count); setChooser(null); focusPiece(chooser) }}
          onClose={() => { setChooser(null); focusPiece(chooser) }}
        />
      )}

      {menu !== null && (
        <SliceMenu
          menu={menu}
          cue={cue}
          slices={slices}
          fileMs={fileMs}
          view={view}
          onAdd={add}
          onRemove={remove}
          onCount={setCount}
          onChooser={index => setChooser(index)}
          onClose={closeMenu}
        />
      )}
    </div>
  )
})

// ── The count chooser ───────────────────────────────────────────────────────

/**
 * The small popover a piece's count is chosen in: once to four times as presses, a typed count
 * for more, a vamp, or skip. Each press is one edit. Escape puts it away without one, and is
 * kept from the window, where it would stop the show.
 */
function CountChooser({ piece, order, count, anchorX, width, onChoose, onClose }: {
  piece: number
  order: number
  count: number
  anchorX: number
  width: number
  onChoose: (count: number) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The panel redraws every frame while the music plays; what closes this is read through a
  // ref, so the listeners — and the keyboard's place among the choices — outlive those frames.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [typed, setTyped] = useState(count > 4 ? String(count) : '')
  const [left, setLeft] = useState(anchorX)

  // Kept inside the panel: centred on the piece where there is room, against an edge where there is not.
  useLayoutEffect(() => {
    const own = ref.current?.offsetWidth ?? 0
    setLeft(Math.max(0, Math.min(anchorX - own / 2, width - own)))
  }, [anchorX, width])

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      ref.current?.querySelector<HTMLElement>('.slice-count-choice')
    first?.focus()
  }, [piece])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
      }
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
        !(e.target as HTMLElement | null)?.closest?.(`.slice-region[data-piece="${piece}"]`)) closeRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [piece])

  /** Arrows walk the choices, the way a toolbar's buttons are walked. */
  const walk = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Space is GO wherever it is pressed; here it must not also press the choice under it.
    if (e.key === ' ' && (e.target as HTMLElement).tagName === 'BUTTON') e.preventDefault()
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    if ((e.target as HTMLElement).tagName === 'INPUT' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return
    e.preventDefault()
    e.stopPropagation()
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('.slice-count-choice, .slice-count-typed') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
    items[(at + step + items.length) % items.length]?.focus()
  }

  const commitTyped = (): void => {
    const value = Number(typed)
    if (typed.trim() !== '' && Number.isFinite(value) && value >= 0) onChoose(Math.round(value))
  }

  const choice = (value: number, label: string, title: string) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={count === value}
      className="slice-count-choice"
      data-count={value}
      title={title}
      onClick={() => onChoose(value)}
    >
      {label}
    </button>
  )

  return (
    <div
      ref={ref}
      className="slice-count-chooser"
      role="menu"
      aria-label={`Slice ${order + 1} plays`}
      style={{ left }}
      onKeyDown={walk}
      onPointerDown={e => e.stopPropagation()}
    >
      {choice(1, '×1', 'Plays once')}
      {choice(2, '×2', 'Plays twice')}
      {choice(3, '×3', 'Plays three times')}
      {choice(4, '×4', 'Plays four times')}
      <label className="slice-count-more">
        ×
        <input
          className="slice-count-typed"
          type="number"
          min={0}
          max={999}
          step={1}
          value={typed}
          placeholder="n"
          aria-label="Passes"
          onChange={e => setTyped(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitTyped() }
          }}
        />
      </label>
      {choice(SLICE_VAMP, '∞ vamp', 'Vamps: plays until a devamp moves it on')}
      {choice(SLICE_SKIP, 'skip', 'Plays no times: the music goes from the slice before straight into the one after')}
    </div>
  )
}

// ── The waveform's context menu ─────────────────────────────────────────────

const MENU_WIDTH = 220
const MENU_HEIGHT = 230
/** How near a right-click has to be to a marker, CSS px, for the menu to offer to take it out. */
const MENU_MARKER_PX = 8

function SliceMenu({ menu, cue, slices, fileMs, view, onAdd, onRemove, onCount, onChooser, onClose }: {
  menu: { x: number; y: number; ms: number }
  cue: AudioCue
  slices: CueSlices
  fileMs: number
  view: SliceView
  onAdd: (ms: number) => void
  onRemove: (index: number) => void
  onCount: (piece: number, count: number) => void
  onChooser: (piece: number) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pxPerMs = view.spanMs > 0 ? view.width / view.spanMs : 0
  // The marker the press was on, if it was on one.
  let near: number | null = null
  slices.markers.forEach((marker, index) => {
    const px = Math.abs(marker - menu.ms) * pxPerMs
    if (px <= MENU_MARKER_PX && (near === null || Math.abs(marker - menu.ms) < Math.abs(slices.markers[near] - menu.ms))) near = index
  })
  const nearIndex: number | null = near
  const regionEnd = cue.endTime ?? fileMs
  const inRegion = menu.ms > cue.startTime && menu.ms < regionEnd
  const piece = slices.markers.filter(marker => marker <= menu.ms).length
  const count = slices.playCounts[piece] ?? 1
  const addable = nearIndex === null && canAddMarkerAt(slices, menu.ms, fileMs, AUDIO_MAX_SLICES - 1)
  const removal = nearIndex === null ? null : mergeOnDelete(slices, nearIndex)
  const pieceOrder = drawnPieces(slices, cue.startTime, regionEnd).findIndex(p => p.index === piece) + 1
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.cue-context-menu-item')?.focus()
  }, [menu])

  useEffect(() => {
    const onClose = (): void => closeRef.current()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      e.stopPropagation()
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('.cue-context-menu-item') ?? [])]
      if (items.length === 0) return
      const at = items.indexOf(document.activeElement as HTMLElement)
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [])

  const act = (fn: () => void) => () => { fn(); onClose() }
  const item = (action: string, icon: string, label: string, fn: () => void, extra?: { kbd?: string; title?: string; danger?: boolean }) => (
    <button
      type="button"
      role="menuitem"
      className={`cue-context-menu-item${extra?.danger ? ' cue-context-menu-item--danger' : ''}`}
      data-action={action}
      title={extra?.title}
      onClick={act(fn)}
      onMouseEnter={e => e.currentTarget.focus()}
    >
      <span className="cue-context-menu-icon">{icon}</span>
      {label}
      {extra?.kbd !== undefined && <kbd>{extra.kbd}</kbd>}
    </button>
  )

  return ReactDOM.createPortal(
    <div
      ref={ref}
      className="cue-context-menu slice-context-menu"
      role="menu"
      aria-label="Slices"
      style={{
        left: Math.min(menu.x, window.innerWidth - MENU_WIDTH - 4),
        top: Math.min(menu.y, window.innerHeight - MENU_HEIGHT - 4)
      }}
      onContextMenu={e => e.preventDefault()}
    >
      {addable && item('slice-add', '+', `Add marker at ${formatMarkerTime(menu.ms)}`, () => onAdd(menu.ms), { kbd: 'M' })}
      {nearIndex !== null && removal !== null && item('slice-remove', '✕', `Delete marker ${nearIndex + 1}`, () => onRemove(nearIndex), {
        kbd: 'Del',
        danger: true,
        title: removal.kept === removal.dropped
          ? `Joins slices ${nearIndex + 1} and ${nearIndex + 2}, which both play ${playCountLabel(removal.kept)}`
          : `Joins slices ${nearIndex + 1} and ${nearIndex + 2}: ${playCountLabel(removal.kept)} is kept, ${playCountLabel(removal.dropped)} goes`
      })}
      {inRegion && (
        <>
          <div className="cue-context-menu-separator" />
          {count !== 1 && item('slice-once', '1', `Play slice ${pieceOrder} once`, () => onCount(piece, 1))}
          {count >= 0 && item('slice-vamp', '∞', `Vamp slice ${pieceOrder}`, () => onCount(piece, SLICE_VAMP))}
          {count !== SLICE_SKIP && item('slice-skip', '–', `Skip slice ${pieceOrder}`, () => onCount(piece, SLICE_SKIP))}
          {item('slice-count', '×', `Slice ${pieceOrder} plays…`, () => onChooser(piece))}
        </>
      )}
    </div>,
    document.body
  )
}
