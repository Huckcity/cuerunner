import { useStore } from '../../store'
import type { StopCue } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { TargetList } from './TargetList'
import { STOP_ALL, stopTargetIds, stopTargetsPatch } from '../../../../shared/cueTargets'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { STOP_DEFAULTS } from '../../utils/cueDefaults'

interface Props { cue: StopCue }

export function StopInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const cues = useStore(s => s.cues)
  const set = (patch: Partial<StopCue>) => update(cue.id, patch)

  const targets = stopTargetIds(cue)
  const all = targets === STOP_ALL

  return (
    <div>
      <div className="field-row">
        <label htmlFor="stop-target-mode">Target</label>
        <select
          id="stop-target-mode"
          value={all ? 'all' : 'cues'}
          onChange={e => set(stopTargetsPatch(e.target.value === 'all' ? STOP_ALL : []))}
        >
          <option value="all">All cues</option>
          <option value="cues">These cues</option>
        </select>
        <ResetButton label="Target" value={all ? STOP_ALL : targets} defaultValue={STOP_DEFAULTS.targetCueId}
          onReset={() => set(stopTargetsPatch(STOP_ALL))} />
      </div>
      {!all && (
        <TargetList
          id="stop-target-add"
          cueId={cue.id}
          ids={targets}
          cues={cues}
          // Anything that runs can be stopped; a note never runs.
          eligible={candidate => candidate.type !== 'memo'}
          onChange={ids => set(stopTargetsPatch(ids))}
          empty="No cue chosen: this stop stops nothing."
        />
      )}
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
        Stops its targets at once, or fades them out first. A group stops whole.
      </p>
      <LastRun cueId={cue.id} />
    </div>
  )
}
