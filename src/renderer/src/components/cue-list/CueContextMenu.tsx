import { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import type { Cue } from '../../types/cue'
import { useStore } from '../../store'
import { CUE_COLORS, CUE_COLOR_SWATCH } from '../../utils/cueColors'
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
const MENU_HEIGHT = 250

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
  const menuRef = useRef<HTMLDivElement>(null)

  const clampedX = Math.min(x, window.innerWidth - MENU_WIDTH - 4)
  const clampedY = Math.min(y, window.innerHeight - MENU_HEIGHT - 4)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
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
      <button className="cue-context-menu-item cue-context-menu-item--danger" onClick={handleDelete}>
        <span className="cue-context-menu-icon">✕</span>
        Delete{count}
        <kbd>Del</kbd>
      </button>
      <div className="cue-context-menu-separator" />
      <button className="cue-context-menu-item" onClick={handleArmToggle}>
        <span className="cue-context-menu-icon">{allArmed ? '○' : '●'}</span>
        {allArmed ? 'Disarm' : 'Arm'}{count}
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