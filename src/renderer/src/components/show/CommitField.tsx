import { useState, type InputHTMLAttributes } from 'react'

/**
 * A field that keeps what is being typed to itself until it is left. Binding the show's
 * setup to every keystroke would rewrite the workspace on each character — and a channel
 * renamed halfway through a word is a name the desk never saw.
 */
export function CommitInput({
  value,
  onCommit,
  ...rest
}: {
  value: string
  onCommit: (value: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }

  return (
    <input
      {...rest}
      value={draft ?? value}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

/**
 * A number that commits when it is left rather than on every keystroke: binding a port
 * as it is typed would move a listener somewhere nobody asked for, and a value outside
 * the range it is given is dropped rather than written.
 */
export function CommitNumber({
  value,
  min,
  max,
  onCommit,
  ...rest
}: {
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    const parsed = Number(draft)
    if (draft !== null && Number.isInteger(parsed) && parsed >= min && parsed <= max) {
      onCommit(parsed)
    }
    setDraft(null)
  }

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}
