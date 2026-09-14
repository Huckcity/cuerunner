import { useStore } from '../../store'
import type { WaitCue } from '../../types/cue'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { WAIT_DEFAULTS } from '../../utils/cueDefaults'

interface Props { cue: WaitCue }

export function WaitInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)

  return (
    <div>
      <div className="field-row">
        <label>Duration (ms)</label>
        <NumberField when="typed" min={0} value={cue.duration}
          onValue={duration => { if (duration !== null) update(cue.id, { duration }) }} />
        <ResetButton label="Duration" value={cue.duration} defaultValue={WAIT_DEFAULTS.duration}
          onReset={() => update(cue.id, { duration: WAIT_DEFAULTS.duration })} />
      </div>
      <p className="inspector-hint">
        Wait cues pause the sequence for the specified duration, then continue.
        Set Advance to "On end" on the Basics tab to automatically fire the next cue after waiting.
      </p>
      <LastRun cueId={cue.id} />
    </div>
  )
}
