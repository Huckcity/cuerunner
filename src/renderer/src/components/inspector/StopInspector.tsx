import { useStore } from '../../store'
import type { StopCue } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { STOP_DEFAULTS } from '../../utils/cueDefaults'

interface Props { cue: StopCue }

export function StopInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const cues = useStore(s => s.cues)
  const set = (patch: Partial<StopCue>) => update(cue.id, patch)

  const otherCues = cues.filter(c => c.id !== cue.id)

  return (
    <div>
      <div className="field-row">
        <label>Target</label>
        <select value={cue.targetCueId} onChange={e => set({ targetCueId: e.target.value })}>
          <option value="all">All cues</option>
          {otherCues.map(c => {
            const displayName = c.name.length > 20 ? c.name.slice(0, 17) + '...' : c.name
            return <option key={c.id} value={c.id}>{c.number} {displayName}</option>
          })}
        </select>
        <ResetButton label="Target" value={cue.targetCueId} defaultValue={STOP_DEFAULTS.targetCueId}
          onReset={() => set({ targetCueId: STOP_DEFAULTS.targetCueId })} />
      </div>
      <div className="field-row">
        <label>Fade out</label>
        <input type="checkbox" checked={cue.fadeOut}
          onChange={e => set({ fadeOut: e.target.checked })} />
        <ResetButton label="Fade out" value={cue.fadeOut} defaultValue={STOP_DEFAULTS.fadeOut}
          onReset={() => set({ fadeOut: STOP_DEFAULTS.fadeOut })} />
      </div>
      <div className="field-row">
        <label>Fade duration (s)</label>
        <NumberField when="typed" min={0} step={0.1} value={cue.fadeOutDuration / 1000}
          disabled={!cue.fadeOut}
          onValue={seconds => { if (seconds !== null) set({ fadeOutDuration: Math.round(seconds * 1000) }) }} />
        <ResetButton label="Fade duration" value={cue.fadeOutDuration} defaultValue={STOP_DEFAULTS.fadeOutDuration}
          onReset={() => set({ fadeOutDuration: STOP_DEFAULTS.fadeOutDuration })} />
      </div>
      <div className="field-row">
        <label>Wait for fade</label>
        <input type="checkbox" checked={cue.waitForFade} disabled={!cue.fadeOut}
          onChange={e => set({ waitForFade: e.target.checked })} />
        <ResetButton label="Wait for fade" value={cue.waitForFade} defaultValue={STOP_DEFAULTS.waitForFade}
          onReset={() => set({ waitForFade: STOP_DEFAULTS.waitForFade })} />
      </div>
      <p className="inspector-hint">
        Stops the target at once, or fades it out first. Tick Wait for fade to hold the
        show until the fade has finished.
      </p>
      <LastRun cueId={cue.id} />
    </div>
  )
}
