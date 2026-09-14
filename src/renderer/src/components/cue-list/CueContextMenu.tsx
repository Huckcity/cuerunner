import { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import type { Cue } from '../../types/cue'
import { useStore } from '../../store'
import { CUE_COLORS, CUE_COLOR_SWATCH } from '../../utils/cueColors'
import { regionEndMs } from '../../utils/cueSplit'
import { formatShortcut } from '../../utils/shortcuts'
import './CueContextMenu.css'

interface Props {
  x: number
  y: number
  cue: Cue
  onClose: () => void
  onRename: () => void
}

const MENU_WIDTH = 176
const MENU_HEIGHT = 300

/** What the split item would do, where the cursor is: "Split at 1:23.4". */
function splitHint(cue: Cue, atMs: number): string {
  const seconds = atMs / 1000
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  return `Split “${cue.name}” at ${min}:${sec.toFixed(1).padStart(4, '0')}`
}

/**
 * What the right-click does, to what it was opened over.
 *
 * A cue that is part of the selection is not the menu's target on its own: the whole
 * selection is, because that is what the operator put together. One cue — a row that was
 * not selected, so the right-click moved the selection to it — is a selection of one, and
 * reads exactly as it always did.
 */
export function CueContextMenu({ x, y, cue, onClose, onRename }: Props) {
  const cues = useStore(s => s.cues)
  const selectedIds = useStore(s => s.selectedIds)
  const removeCues = useStore(s => s.removeCues)
  const duplicateCues = useStore(s => s.duplicateCues)
  const updateCues = useStore(s => s.updateCues)
  const splitAudioCueAt = useStore(s => s.splitAudioCueAt)
  const cursorMs = useStore(s => s.waveformCursorMs)
  const menuRef = useRef<HTMLDivElement>(null)

  const clampedX = Math.min(x, window.innerWidth - MENU_WIDTH - 4)
  const clampedY = Math.min(y, window.innerHeight - MENU_HEIGHT - 4)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Escape closes the menu here rather than only in the list's handler: the press has
    // to be swallowed either way, or dismissing a menu stops the show behind it.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    // Capture, on the document: the press is taken before anything else can read it,
    // including the window listener that would stop the show.
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  const targets = selectedIds.includes(cue.id) ? selectedIds : [cue.id]
  const targetCues = cues.filter(c => targets.includes(c.id))
  const several = targets.length > 1
  const count = several ? ` (${targets.length})` : ''

  // What the set has in common, and what the item would do to all of it: a mixed set is
  // armed by the press rather than half-disarmed by it.
  const colors = new Set(targetCues.map(c => c.colorLabel))
  const sharedColor = colors.size === 1 ? targetCues[0]?.colorLabel ?? null : null
  const allArmed = targetCues.every(c => c.isArmed)

  const handleRename = () => { onRename(); onClose() }
  const handleDuplicate = () => { duplicateCues(targets); onClose() }
  const handleDelete = () => { removeCues(targets); onClose() }
  const handleArmToggle = () => { updateCues(targets, { isArmed: !allArmed }); onClose() }

  // A split is offered when there is a place to make one: an audio cue whose region the
  // waveform cursor is inside. The cursor is the same one a click on the waveform sets,
  // so the operator chooses the point where they can see it and commits it here — the
  // menu is beside the list, and the thing being pointed at is a time.
  const splitSplit = !several && cue.type === 'audio' && cue.filePath !== '' &&
    cursorMs !== null && cursorMs > cue.startTime && cursorMs < regionEndMs(cue)
  const handleSplit = () => { splitAudioCueAt(cue.id, cursorMs!); onClose() }

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="cue-context-menu"
      style={{ left: clampedX, top: clampedY }}
      onContextMenu={e => e.preventDefault()}
    >
      <button className="cue-context-menu-item" onClick={handleRename}>
        <span className="cue-context-menu-icon">✎</span>
        Rename
      </button>
      <button className="cue-context-menu-item" onClick={handleDuplicate}>
        <span className="cue-context-menu-icon">⧉</span>
        Duplicate{count}
        <kbd>{formatShortcut('Mod+D')}</kbd>
      </button>
      {splitSplit && (
        <button className="cue-context-menu-item" onClick={handleSplit} title={splitHint(cue, cursorMs!)}>
          <span className="cue-context-menu-icon">✂</span>
          Split here
        </button>
      )}
      <button className="cue-context-menu-item cue-context-menu-item--danger" onClick={handleDelete}>
        <span className="cue-context-menu-icon">✕</span>
        Delete{count}
        <kbd>Del</kbd>
      </button>
      <div className="cue-context-menu-separator" />
      <button className="cue-context-menu-item" onClick={handleArmToggle}>
        <span className="cue-context-menu-icon">{allArmed ? '○' : '●'}</span>
        {allArmed ? 'Disarm' : 'Arm'}{count}
        <kbd>{formatShortcut('Mod+Shift+A')}</kbd>
      </button>
      <div className="cue-context-menu-separator" />
      {/* The eight colours, drawn where the cue is: the same pick as the inspector's, for
          the hand that is on the list rather than on the panel. */}
      <div className="cue-context-menu-colors" role="group" aria-label="Color">
        {CUE_COLORS.map(color => (
          <button
            key={color}
            className="cue-context-menu-color"
            title={color}
            aria-label={color}
            data-active={sharedColor === color}
            style={{ background: CUE_COLOR_SWATCH[color] }}
            onClick={() => { updateCues(targets, { colorLabel: color }); onClose() }}
          />
        ))}
      </div>
    </div>,
    document.body
  )
}