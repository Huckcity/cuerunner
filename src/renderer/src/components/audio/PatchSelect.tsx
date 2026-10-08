import { useMemo } from 'react'
import { useStore } from '../../store'
import { audioRoutingOf, patchChannelsLabel } from '../../../../shared/audioRouting'

interface Props {
  value: string | null | undefined
  onChange: (patchId: string | null) => void
  /** Distinguishes two selects in one panel. */
  name: string
}

/**
 * Where a cue's sound goes by name: one of the show's output patches, or the device's own
 * channels. A cue pointed at a patch the show no longer has says so, and plays on the
 * device's channels until it is pointed somewhere else.
 */
export function PatchSelect({ value, onChange, name }: Props) {
  const settings = useStore(s => s.audioSettings)
  const patches = useMemo(() => audioRoutingOf(settings).patches, [settings])
  const current = value ?? ''
  const missing = current !== '' && !patches.some(patch => patch.id === current)
  const id = `patch-select-${name}`
  return (
    <div className="field-row">
      <label htmlFor={id}>Output patch</label>
      <select id={id} className="patch-select" value={current} onChange={e => onChange(e.target.value === '' ? null : e.target.value)}>
        <option value="">Device channels</option>
        {missing && <option value={current}>— a patch this show no longer has —</option>}
        {patches.map(patch => (
          <option key={patch.id} value={patch.id}>{patch.name} ({patchChannelsLabel(patch.channels)})</option>
        ))}
      </select>
    </div>
  )
}
