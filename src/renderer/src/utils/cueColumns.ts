import type { CSSProperties } from 'react'

/**
 * The cue list's columns, as this operator has laid them out on this machine: which are shown,
 * in what order, and how wide. It is the operator's taste, not the show's — a designer who
 * wants the notes beside every row and a mixer who wants only the times are running the same
 * show — so it lives in the window's own storage beside the dock's height, and a storage that
 * will not answer costs nothing but the default.
 *
 * The number leads every row and the name fills what is left, so neither is in the layout:
 * the number is where the eye starts and the name is the one column that grows.
 */

export type ColumnId = 'dur' | 'pre' | 'post' | 'adv' | 'notes'

export interface ColumnSpec {
  id: ColumnId
  label: string
  /** Its width as the list first draws it, px. */
  width: number
}

/** Every column the list can draw beside the number and the name, in its first order. */
export const COLUMNS: readonly ColumnSpec[] = [
  { id: 'dur', label: 'Duration', width: 76 },
  { id: 'pre', label: 'Pre', width: 64 },
  { id: 'post', label: 'Post', width: 64 },
  { id: 'adv', label: 'Advance', width: 80 },
  { id: 'notes', label: 'Notes', width: 180 }
]

export const COLUMN_MIN_WIDTH = 40
export const COLUMN_MAX_WIDTH = 480

export interface ColumnLayout {
  /** The columns in the order they are drawn after the name, hidden ones included. */
  order: ColumnId[]
  hidden: ColumnId[]
  widths: Partial<Record<ColumnId, number>>
}

/** The list as it has always looked: the four timing columns, and the notes left to the inspector. */
export function defaultLayout(): ColumnLayout {
  return { order: COLUMNS.map(column => column.id), hidden: ['notes'], widths: {} }
}

const KEY = 'cuerunner.cueList.columns'

const isColumn = (value: unknown): value is ColumnId =>
  typeof value === 'string' && COLUMNS.some(column => column.id === value)

/**
 * A layout read back from storage, made whole: a column this build has and the stored order
 * does not name goes at the end, one it does not have is dropped, and a width is held to the
 * range the handles allow. A layout written by a build with fewer columns still opens.
 */
export function normaliseLayout(value: unknown): ColumnLayout {
  const fallback = defaultLayout()
  if (typeof value !== 'object' || value === null) return fallback
  const raw = value as Partial<Record<keyof ColumnLayout, unknown>>
  const order = Array.isArray(raw.order) ? raw.order.filter(isColumn) : []
  const unique = [...new Set(order)]
  for (const column of COLUMNS) if (!unique.includes(column.id)) unique.push(column.id)
  const hidden = Array.isArray(raw.hidden) ? [...new Set(raw.hidden.filter(isColumn))] : fallback.hidden
  const widths: Partial<Record<ColumnId, number>> = {}
  if (typeof raw.widths === 'object' && raw.widths !== null) {
    for (const [id, width] of Object.entries(raw.widths as Record<string, unknown>)) {
      if (isColumn(id) && typeof width === 'number' && Number.isFinite(width)) widths[id] = clampWidth(width)
    }
  }
  return { order: unique, hidden, widths }
}

export function loadLayout(): ColumnLayout {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === null ? defaultLayout() : normaliseLayout(JSON.parse(stored))
  } catch {
    return defaultLayout()
  }
}

export function saveLayout(layout: ColumnLayout): void {
  try { localStorage.setItem(KEY, JSON.stringify(layout)) } catch { /* the default is fine */ }
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, width)))
}

export function widthOf(layout: ColumnLayout, id: ColumnId): number {
  return layout.widths[id] ?? COLUMNS.find(column => column.id === id)!.width
}

/** The layout with one column moved to stand in front of another, or last for null. */
export function moveColumn(layout: ColumnLayout, id: ColumnId, before: ColumnId | null): ColumnLayout {
  if (id === before) return layout
  const rest = layout.order.filter(column => column !== id)
  const at = before === null ? rest.length : rest.indexOf(before)
  rest.splice(at < 0 ? rest.length : at, 0, id)
  return { ...layout, order: rest }
}

export function resizeColumn(layout: ColumnLayout, id: ColumnId, width: number): ColumnLayout {
  return { ...layout, widths: { ...layout.widths, [id]: clampWidth(width) } }
}

export function toggleColumn(layout: ColumnLayout, id: ColumnId): ColumnLayout {
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter(column => column !== id)
    : [...layout.hidden, id]
  return { ...layout, hidden }
}

/** The columns as they are drawn: shown ones, in order. */
export function shownColumns(layout: ColumnLayout): ColumnId[] {
  return layout.order.filter(id => !layout.hidden.includes(id))
}

/**
 * The layout as the list's container carries it: a width and a place for every column, as
 * custom properties the header and the rows both read, so the two line up by construction. The
 * number and the name keep the first two places.
 */
export function layoutStyle(layout: ColumnLayout): CSSProperties {
  const style: Record<string, string> = {}
  layout.order.forEach((id, index) => {
    style[`--col-${id}-w`] = `${widthOf(layout, id)}px`
    style[`--col-${id}-order`] = String(index + 10)
  })
  return style as CSSProperties
}
