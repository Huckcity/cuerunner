import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import './Field.css'

/** How long the confirmation stays on the field. Long enough to be seen, short enough to ignore. */
export const SAVED_MS = 1200

type ShellProps = {
  /** What the field shows when nothing is being typed. Text, because a field is text. */
  value: string
  /** When what has been typed is handed over: as it is typed, or when the field is left. */
  when: 'typed' | 'leave'
  onValue: (text: string) => void
  /**
   * Why the text cannot be taken, or null when it can. A field that refuses what was
   * typed has to say so: a value the operator typed, saw, and moved on from is a value
   * they believe is set, and the old one silently coming back is how a cue plays at the
   * wrong level.
   */
  validate?: (text: string) => string | null
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onFocus'>

/**
 * The input both fields are built on: it keeps the text being typed, and it tells the
 * operator when that text took.
 *
 * A raw input box leaves one question open — a value typed and then left, by clicking
 * away or by pressing Enter, gives no sign that anything happened — and the answer is
 * the same for every field, whatever it is bound to. So the comparison lives here: what
 * the field was showing for the committed value when it was focused, against what that
 * value is once the field is left. Different means the operator changed something and it
 * took; the same means there is nothing to say, and typing a value back to what it was
 * says nothing either.
 *
 * The comparison is against the *committed* value rather than the text, because a field
 * can refuse what was typed: a port out of range is dropped rather than written, and a
 * glow for a value that did not take would be a lie.
 */
function FieldShell({ value, when, onValue, validate, className, ...rest }: ShellProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  /** The committed value when the field was focused — what a change is measured against. */
  const atFocusRef = useRef(value)
  const flashTimer = useRef<number | undefined>(undefined)

  const flash = (): void => {
    setSaved(true)
    clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setSaved(false), SAVED_MS)
  }

  useEffect(() => () => clearTimeout(flashTimer.current), [])

  useEffect(() => {
    if (leaving) {
      // The comparison the flash is: what the field was showing for the committed value
      // when it was focused, against what that value is now that the field has been left.
      if (value !== atFocusRef.current) flash()
      setLeaving(false)
    }
    // A value that changed under a field nobody is typing in — another cue selected, a
    // reset pressed — is not this field's operator being told anything, so the baseline
    // follows it. After this field's own write it follows too, which is why the
    // comparison above happens first.
    if (draft === null) atFocusRef.current = value
  }, [value, draft, leaving])

  const leave = (): void => {
    if (draft === null) return
    // What the field will do is decided before it is left, and said while the operator
    // is still looking at it: the draft stays on screen when it was refused, so the
    // number they typed and the number the show has cannot be mistaken for each other.
    if (validate !== undefined) {
      const reason = validate(draft)
      if (reason !== null) {
        setRefused(reason)
        return
      }
    }
    if (when === 'leave' && draft !== value) onValue(draft)
    setDraft(null)
    setLeaving(true)
  }

  return (
    <input
      {...rest}
      className={className === undefined ? 'field' : `field ${className}`}
      data-saved={saved || undefined}
      data-refused={refused !== null || undefined}
      title={refused ?? rest.title}
      aria-invalid={refused !== null || undefined}
      value={draft ?? value}
      onFocus={e => { atFocusRef.current = e.currentTarget.value }}
      onChange={e => {
        setDraft(e.target.value)
        setRefused(validate === undefined ? null : validate(e.target.value))
        if (when === 'typed') onValue(e.target.value)
      }}
      onBlur={leave}
      onKeyDown={e => {
        if (e.key !== 'Enter') return
        // Enter leaves the field without leaving it: the value is taken and confirmed
        // where the operator is looking, rather than when they next click away.
        if (when === 'leave') leave()
        else if (draft !== null) { setDraft(null); setLeaving(true) }
      }}
    />
  )
}

type TextProps = {
  value: string
  when?: 'typed' | 'leave'
  onValue: (text: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onFocus' | 'type'>

/** A text box that says when what was typed into it took. */
export function TextField({ when = 'leave', ...rest }: TextProps) {
  return <FieldShell type="text" when={when} {...rest} />
}

type NumberProps = {
  /** Null is an empty field: a length or a time that has not been set. */
  value: number | null
  min?: number
  max?: number
  /** What the field is written as: an integer at the default, or this many decimals. */
  step?: number
  when?: 'typed' | 'leave'
  onValue: (value: number | null) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onFocus' | 'type' | 'step'>

/**
 * A number box on the same terms. What is typed is written only when it is a number
 * inside the range the field was given; anything else is dropped and the field goes back
 * to what the value really is when it is left.
 */
export function NumberField({ value, min, max, step = 1, when = 'leave', onValue, ...rest }: NumberProps) {
  const decimals = (String(step).split('.')[1] ?? '').length

  /** Why this text cannot be a value of this field, or null when it can. */
  const reasonFor = (text: string): string | null => {
    // An empty field is not a mistake: a length or a time that has not been set is null.
    if (text.trim() === '') return null
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return `“${text}” is not a number`
    if (min !== undefined && parsed < min) return `Smallest is ${min}`
    if (max !== undefined && parsed > max) return `Largest is ${max}`
    return null
  }

  const take = (text: string): void => {
    if (text.trim() === '') { onValue(null); return }
    if (reasonFor(text) !== null) return
    onValue(Number(Number(text).toFixed(decimals)))
  }

  return (
    <FieldShell
      {...rest}
      type="number"
      min={min}
      max={max}
      step={step}
      when={when}
      value={value === null ? '' : String(value)}
      onValue={take}
      validate={reasonFor}
    />
  )
}