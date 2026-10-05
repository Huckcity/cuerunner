import { useStore } from '../../store'
import type { WaitCue } from '../../../../shared/cue'
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
        {/* Seconds, like every other length in the inspector — pre-wait, post-wait, a
            fade — and to the hundredth: a wait is the one length whose whole job is to be
            exact, and it was the one field in milliseconds, so a 5 typed here by somebody
            who had just set a five-second pre-wait was a wait nobody could perceive. */}
        <label>Duration (s)</label>
        <NumberField when="typed" min={0} step={0.01} value={cue.duration / 1000}
          onValue={seconds => { if (seconds !== null) update(cue.id, { duration: Math.round(seconds * 1000) }) }} />
        <ResetButton label="Duration" value={cue.duration} defaultValue={WAIT_DEFAULTS.duration}
          onReset={() => update(cue.id, { duration: WAIT_DEFAULTS.duration })} />
      </div>
      <p className="inspector-hint">
        Holds for this long. To fire the next cue afterwards, set Advance to “On end” on
        the Basics tab.
      </p>
      <LastRun cueId={cue.id} />
    </div>
  )
}
