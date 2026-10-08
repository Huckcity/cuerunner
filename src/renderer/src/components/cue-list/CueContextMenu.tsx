import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import type { Cue } from '../../../../shared/cue'
import { useStore } from '../../store'
import { CUE_COLORS, CUE_COLOR_SWATCH } from '../../utils/cueColors'
import { regionEndMs } from '../../utils/cueSplit'
import { formatShortcut } from '../../utils/shortcuts'
import { canTarget, targetingBlock, type TargetingKind } from '../../utils/batchEdit'
import { nextCueNumber } from '../../utils/cueDefaults'
import { canPaste, copyCues, pasteCues } from '../../hooks/useCueClipboard'
import './CueContextMenu.css'

interface Props {
  x: number
  y: number
  cue: Cue
  onClose: () => void
  onRename: () => void
  /** Opens the batch edit for these cues; the list owns the dialog, since the menu closes. */
  onBatchEdit?: (ids: string[]) => void
}

const MENU_WIDTH = 176
const MENU_HEIGHT = 400

/** What the split item would do, where the cursor is: "Split at 1:23.4". */
function splitHint(cue: Cue, atMs: number): string {
  // The tenth that is shown, then the minutes: see `formatDuration`.
  const tenths = Math.round(atMs / 100)
  const min = Math.floor(tenths / 600)
  const sec = (tenths % 600) / 10
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
export function CueContextMenu({ x, y, cue, onClose, onRename, onBatchEdit }: Props) {
  const cues = useStore(s => s.cues)
  const selectedIds = useStore(s => s.selectedIds)
  const removeCues = useStore(s => s.removeCues)
  const duplicateCues = useStore(s => s.duplicateCues)
  const updateCues = useStore(s => s.updateCues)
  const splitAudioCueAt = useStore(s => s.splitAudioCueAt)
  const insertCues = useStore(s => s.insertCues)
  const cursor = useStore(s => s.waveformCursor)
  // The other lists, for "Move to": the one on screen is where the cues already are.
  const lists = useStore(s => s.cueLists)
  const activeListId = useStore(s => s.activeListId)
  const otherLists = lists.filter(list => list.id !== activeListId)
  const moveCuesToList = useStore(s => s.moveCuesToList)
  const menuRef = useRef<HTMLDivElement>(null)
  /** Where the keyboard is in the menu: the item per index, in the order drawn. */
  const [activeIndex, setActiveIndex] = useState(0)

  const clampedX = Math.min(x, window.innerWidth - MENU_WIDTH - 4)
  const clampedY = Math.min(y, window.innerHeight - MENU_HEIGHT - 4)

  // The menu takes the keyboard when it opens, and gives it back when it closes. Every
  // action in it is reachable with the arrows and Enter, because on a keyboard-only desk
  // it was reachable no other way — and the Mod+D it prints beside Duplicate did not work
  // while the menu was up, since focus never entered the portal.
  useEffect(() => {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('.cue-context-menu-item')
    items?.[activeIndex]?.focus()
  }, [activeIndex])

  /** Every item the arrows walk, in the order they are drawn. */
  const itemCount = (): number =>
    menuRef.current?.querySelectorAll('.cue-context-menu-item').length ?? 0

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Escape closes the menu here rather than only in the list's handler: the press has
    // to be swallowed either way, or dismissing a menu stops the show behind it.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const count = itemCount()
      if (count === 0) return
      setActiveIndex(current => (current + (e.key === 'ArrowDown' ? 1 : count - 1)) % count)
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
  const handleBatchEdit = () => { onBatchEdit?.(targets); onClose() }

  // A fade or a stop made for the selection, put after the last cue it acts on: one cue aimed
  // at every target, however many. One edit, one undo.
  const aimable = (kind: TargetingKind) => targetCues.filter(target => canTarget(kind, target))
  const handleTargeting = (kind: TargetingKind) => {
    const aimedAt = aimable(kind)
    const block = targetingBlock(kind, aimedAt, nextCueNumber(cues))
    if (block.length > 0) insertCues(block, aimedAt[aimedAt.length - 1].id)
    onClose()
  }
  const fadeCount = aimable('fade').length
  const stopCount = aimable('stop').length

  // A split is offered when there is a place to make one: an audio cue whose region the
  // waveform cursor is inside, and the cursor is this cue's — it is a time in a file, and
  // a time in another track is a different place. The cursor is the same one a click on
  // the waveform sets, so the operator chooses the point where they can see it and
  // commits it here — the menu is beside the list, and the thing being pointed at is a
  // time.
  const atMs = cursor !== null && cursor.cueId === cue.id ? cursor.ms : null
  const splitSplit = !several && cue.type === 'audio' && cue.filePath !== '' &&
    atMs !== null && atMs > cue.startTime && atMs < regionEndMs(cue)
  const handleSplit = () => { if (atMs !== null) splitAudioCueAt(cue.id, atMs); onClose() }

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="cue-context-menu"
      style={{ left: clampedX, top: clampedY }}
      onContextMenu={e => e.preventDefault()}
      role="menu"
    >
      <button className="cue-context-menu-item" onClick={handleRename} onMouseEnter={e => e.currentTarget.focus()}>
        <span className="cue-context-menu-icon">✎</span>
        Rename
      </button>
      <button className="cue-context-menu-item" onClick={handleDuplicate} onMouseEnter={e => e.currentTarget.focus()}>
        <span className="cue-context-menu-icon">⧉</span>
        Duplicate{count}
        <kbd>{formatShortcut('Mod+D')}</kbd>
      </button>
      {splitSplit && (
        <button className="cue-context-menu-item" onClick={handleSplit} title={splitHint(cue, atMs)} onMouseEnter={e => e.currentTarget.focus()}>
          <span className="cue-context-menu-icon">✂</span>
          Split here
        </button>
      )}
      <button className="cue-context-menu-item cue-context-menu-item--danger" onClick={handleDelete} onMouseEnter={e => e.currentTarget.focus()}>
        <span className="cue-context-menu-icon">✕</span>
        Delete{count}
        <kbd>Del</kbd>
      </button>
      <div className="cue-context-menu-separator" />
      <button className="cue-context-menu-item" onClick={handleArmToggle} onMouseEnter={e => e.currentTarget.focus()}>
        <span className="cue-context-menu-icon">{allArmed ? '○' : '●'}</span>
        {allArmed ? 'Disarm' : 'Arm'}{count}
        <kbd>{formatShortcut('Mod+Shift+A')}</kbd>
      </button>
      {otherLists.map(list => (
        <button key={list.id} className="cue-context-menu-item" data-action="move-to-list" data-list-id={list.id}
          onClick={() => { moveCuesToList(targets, list.id); onClose() }} onMouseEnter={e => e.currentTarget.focus()}>
          <span className="cue-context-menu-icon">⇥</span>
          Move{count} to “{list.name}”
        </button>
      ))}
      <div className="cue-context-menu-separator" />
      <button className="cue-context-menu-item" data-action="copy" onClick={() => { copyCues(targets); onClose() }} onMouseEnter={e => e.currentTarget.focus()}>
        <span className="cue-context-menu-icon">⎘</span>
        Copy{count}
        <kbd>{formatShortcut('Mod+C')}</kbd>
      </button>
      {canPaste() && (
        <button className="cue-context-menu-item" data-action="paste" onClick={() => { pasteCues(); onClose() }} onMouseEnter={e => e.currentTarget.focus()}>
          <span className="cue-context-menu-icon">⎗</span>
          Paste after
          <kbd>{formatShortcut('Mod+V')}</kbd>
        </button>
      )}
      {several && onBatchEdit && (
        <button className="cue-context-menu-item" data-action="batch-edit" onClick={handleBatchEdit} onMouseEnter={e => e.currentTarget.focus()}>
          <span className="cue-context-menu-icon">⋯</span>
          Edit{count}…
        </button>
      )}
      {fadeCount > 0 && (
        <button className="cue-context-menu-item" data-action="fade-out" onClick={() => handleTargeting('fade')} onMouseEnter={e => e.currentTarget.focus()}>
          <span className="cue-context-menu-icon">↘</span>
          Fade out{fadeCount > 1 ? ` (${fadeCount})` : ''}
        </button>
      )}
      {stopCount > 0 && (
        <button className="cue-context-menu-item" data-action="stop-cue" onClick={() => handleTargeting('stop')} onMouseEnter={e => e.currentTarget.focus()}>
          <span className="cue-context-menu-icon">■</span>
          Add stop{stopCount > 1 ? ` (${stopCount})` : ''}
        </button>
      )}
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