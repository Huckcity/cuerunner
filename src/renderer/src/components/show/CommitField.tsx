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

/** A port that commits when it is left rather than on every keystroke. */
export function CommitPort({
  value,
  onCommit,
  ...rest
}: {
  value: number
  onCommit: (value: number) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    const parsed = Number(draft)
    if (draft !== null && Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      onCommit(parsed)
    }
    setDraft(null)
  }

  return (
    <input
      {...rest}
      type="number"
      min={1}
      max={65535}
      value={draft ?? String(value)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}
