import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import ReactDOM from 'react-dom'
import {
  COLUMNS, defaultLayout, moveColumn, resizeColumn, toggleColumn, widthOf,
  type ColumnId, type ColumnLayout
} from '../../utils/cueColumns'

interface Props {
  layout: ColumnLayout
  onLayout: (layout: ColumnLayout) => void
}

/** The drag of a header onto another one: its own media type, so a row or a file is not it. */
const COLUMN_DRAG_TYPE = 'application/x-cuerunner-column'

/**
 * The cue list's header, and the layout's handles: drag a heading to move its column, drag
 * its right edge to size it, and right-click anywhere on the header for which columns are
 * shown. The number and the name are not in the layout — they lead every row — so they are
 * drawn as they always were.
 */
export function ColumnHeader({ layout, onLayout }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  /** Where a column being dragged would land: in front of a column, at the end, or nowhere. */
  const [dropBefore, setDropBefore] = useState<ColumnId | 'end' | null>(null)
  const resizing = useRef<{ id: ColumnId; startX: number; startWidth: number } | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const startResize = (e: ReactPointerEvent<HTMLSpanElement>, id: ColumnId): void => {
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    resizing.current = { id, startX: e.clientX, startWidth: widthOf(layoutRef.current, id) }
  }
  const resize = (e: ReactPointerEvent<HTMLSpanElement>): void => {
    const drag = resizing.current
    if (!drag) return
    // The columns after the name are right-aligned against the window's edge, so a handle on
    // a column's left edge is the one that sits between it and the column before it: dragging
    // it left makes the column wider.
    onLayout(resizeColumn(layoutRef.current, drag.id, drag.startWidth + (drag.startX - e.clientX)))
  }
  const endResize = (): void => { resizing.current = null }

  const dragStart = (e: DragEvent<HTMLSpanElement>, id: ColumnId): void => {
    if (resizing.current) { e.preventDefault(); return }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(COLUMN_DRAG_TYPE, id)
  }
  const dragOver = (e: DragEvent<HTMLSpanElement>, id: ColumnId): void => {
    if (!e.dataTransfer.types.includes(COLUMN_DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const shown = layout.order.filter(column => !layout.hidden.includes(column))
    const after = shown[shown.indexOf(id) + 1] ?? null
    // The left half of a heading is in front of it, the right half behind it.
    setDropBefore(e.clientX < rect.left + rect.width / 2 ? id : (after ?? 'end'))
  }
  const drop = (e: DragEvent<HTMLSpanElement>): void => {
    if (!e.dataTransfer.types.includes(COLUMN_DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    const id = e.dataTransfer.getData(COLUMN_DRAG_TYPE) as ColumnId
    const before = dropBefore === 'end' ? null : dropBefore
    setDropBefore(null)
    if (dropBefore !== null && COLUMNS.some(column => column.id === id)) onLayout(moveColumn(layout, id, before))
  }

  useEffect(() => {
    if (menu === null) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return
        // Taken before the window's own Escape, which would stop the show behind the menu.
        e.stopPropagation()
        e.preventDefault()
      }
      setMenu(null)
    }
    const onMouseDown = (e: MouseEvent): void => {
      if ((e.target as HTMLElement | null)?.closest('.column-menu')) return
      setMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', close, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', close, true)
    }
  }, [menu])

  return (
    <div
      className="cue-list-header"
      onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
      onDragLeave={() => setDropBefore(null)}
      title="Drag a heading to move its column, its left edge to size it; right-click for which are shown"
    >
      <span className="col-num">#</span>
      <span className="col-name">Name</span>
      {COLUMNS.map(column => (
        <span
          key={column.id}
          className={`col-${column.id} column-heading`}
          data-column={column.id}
          data-drop-before={dropBefore === column.id || undefined}
          draggable
          onDragStart={e => dragStart(e, column.id)}
          onDragOver={e => dragOver(e, column.id)}
          onDrop={drop}
          onDragEnd={() => setDropBefore(null)}
        >
          <span
            className="column-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${column.label}`}
            onPointerDown={e => startResize(e, column.id)}
            onPointerMove={resize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <span className="column-label">{column.label}</span>
        </span>
      ))}
      {menu !== null && ReactDOM.createPortal(
        <div className="column-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          {COLUMNS.map(column => (
            <label key={column.id} className="column-menu-item">
              <input
                type="checkbox"
                checked={!layout.hidden.includes(column.id)}
                onChange={() => onLayout(toggleColumn(layout, column.id))}
              />
              {column.label}
            </label>
          ))}
          <div className="column-menu-separator" />
          <button className="column-menu-reset" onClick={() => { onLayout(defaultLayout()); setMenu(null) }}>
            Reset columns
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
