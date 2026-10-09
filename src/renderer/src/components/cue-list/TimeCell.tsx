import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A time as an operator types one into a list: seconds (`1.5`), or minutes and seconds
 * (`1:30`, `1:02.5`). Empty is zero — clearing a pre-wait is taking it away. Anything else is
 * null, and the cell keeps the time it had rather than guessing.
 */
export function parseCellTime(text: string): number | null {
  const value = text.trim()
  if (value === '') return 0
  const clock = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(value)
  if (clock) {
    const seconds = Number(clock[2])
    if (seconds >= 60) return null
    return Math.round((Number(clock[1]) * 60 + seconds) * 1000)
  }
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null
  return Math.round(Number(value) * 1000)
}

/** A time written back into the field for editing: seconds, as few decimals as it needs. */
function editText(ms: number): string {
  return String(Math.round(ms) / 1000)
}

interface Props {
  className: string
  ms: number
  /** Whether this cell's time is the cue's own to edit here; a measured length is not. */
  editable: boolean
  label: string
  onCommit: (ms: number) => void
  children: ReactNode
}

/**
 * One of the list's time cells, editable where it stands: double-click it, type, Enter. The
 * row's own double-click renames the cue, so the cell takes its press first; Escape puts the
 * time back and stays out of the list's Escape. A value it cannot read is not written.
 */
export function TimeCell({ className, ms, editable, label, onCommit, children }: Props) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = (): void => {
    const parsed = parseCellTime(inputRef.current?.value ?? '')
    setEditing(false)
    if (parsed !== null && parsed !== ms) onCommit(parsed)
  }

  if (editing) {
    return (
      <span className={className}>
        <input
          ref={inputRef}
          className="time-cell-edit"
          aria-label={label}
          defaultValue={editText(ms)}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false) }
          }}
        />
      </span>
    )
  }
  return (
    <span
      className={className}
      data-editable={editable || undefined}
      title={editable ? `${label}: double-click to change` : undefined}
      onDoubleClick={editable ? e => { e.stopPropagation(); setEditing(true) } : undefined}
    >
      {children}
    </span>
  )
}
