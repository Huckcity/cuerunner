import { useStore } from '../../store'
import type { WaitCue } from '../../types/cue'
import { LastRun } from './LastRun'

interface Props { cue: WaitCue }

export function WaitInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)

  return (
    <div>
      <div className="field-row">
        <label>Duration (ms)</label>
        <input
          type="number"
          min={0}
          value={cue.duration}
          onChange={e => update(cue.id, { duration: Number(e.target.value) })}
        />
      </div>
      <p className="inspector-hint">
        Wait cues pause the sequence for the specified duration, then continue.
        Set Advance to "On end" on the Basics tab to automatically fire the next cue after waiting.
      </p>
      <LastRun cueId={cue.id} />
    </div>
  )
}
