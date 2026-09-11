// A single field's "put it back the way a new cue has it" control. The arrow stays
// dim and inert while the field is at its default, so a row of them doubles as a
// map of what has been changed on the cue.

interface Props {
  /** The field's value right now. */
  value: unknown
  /** What createCue gives the field. */
  defaultValue: unknown
  /** Called when the arrow is clicked; must write the default back. */
  onReset: () => void
  /** Field name for the tooltip and assistive tech, e.g. "Rate". */
  label: string
}

export function ResetButton({ value, defaultValue, onReset, label }: Props) {
  const atDefault = Object.is(value, defaultValue)
  const title = atDefault ? `${label} is at its default` : `Reset ${label} to default`

  return (
    <button
      type="button"
      className="inspector-reset-btn"
      title={title}
      aria-label={title}
      data-default={atDefault}
      disabled={atDefault}
      onClick={onReset}
    >↻</button>
  )
}
