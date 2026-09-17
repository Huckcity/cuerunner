import { useStore } from '../../store'
import type { FadeCue, FadeCurve } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { FADE_DEFAULTS } from '../../utils/cueDefaults'

interface Props { cue: FadeCue }

export function FadeInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const cues = useStore(s => s.cues)
  const set = (patch: Partial<FadeCue>) => update(cue.id, patch)

  const otherCues = cues.filter(c => c.id !== cue.id)

  return (
    <div>
      <div className="field-row">
        <label>Target cue</label>
        <select value={cue.targetCueId} onChange={e => set({ targetCueId: e.target.value })}>
          <option value="">— select —</option>
          {otherCues.map(c => {
            const displayName = c.name.length > 20 ? c.name.slice(0, 17) + '...' : c.name
            return <option key={c.id} value={c.id}>{c.number} {displayName}</option>
          })}
        </select>
      </div>
      <div className="field-row">
        <label>Property</label>
        <select value={cue.fadeProperty} onChange={e => set({ fadeProperty: e.target.value as FadeCue['fadeProperty'] })}>
          <option value="volume">Volume</option>
          <option value="pan">Pan</option>
        </select>
        <ResetButton label="Property" value={cue.fadeProperty} defaultValue={FADE_DEFAULTS.fadeProperty}
          onReset={() => set({ fadeProperty: FADE_DEFAULTS.fadeProperty })} />
      </div>
      <div className="field-row">
        <label>Target value</label>
        <NumberField when="typed" min={0} max={1} step={0.01} value={cue.targetValue}
          onValue={targetValue => { if (targetValue !== null) set({ targetValue }) }} />
        <ResetButton label="Target value" value={cue.targetValue} defaultValue={FADE_DEFAULTS.targetValue}
          onReset={() => set({ targetValue: FADE_DEFAULTS.targetValue })} />
      </div>
      <div className="field-row">
        <label>Duration (s)</label>
        <NumberField when="typed" min={0} step={0.1} value={cue.duration / 1000}
          onValue={seconds => { if (seconds !== null) set({ duration: Math.round(seconds * 1000) }) }} />
        <ResetButton label="Duration" value={cue.duration} defaultValue={FADE_DEFAULTS.duration}
          onReset={() => set({ duration: FADE_DEFAULTS.duration })} />
      </div>
      <div className="field-row">
        <label>Curve</label>
        <select value={cue.curve} onChange={e => set({ curve: e.target.value as FadeCurve })}>
          <option value="linear">Linear</option>
          <option value="sCurve">S-Curve</option>
          <option value="logarithmic">Logarithmic</option>
        </select>
        <ResetButton label="Curve" value={cue.curve} defaultValue={FADE_DEFAULTS.curve}
          onReset={() => set({ curve: FADE_DEFAULTS.curve })} />
      </div>
      <div className="field-row">
        <label>Stop target when done</label>
        <input type="checkbox" checked={cue.stopTargetWhenDone}
          onChange={e => set({ stopTargetWhenDone: e.target.checked })} />
        <ResetButton label="Stop target when done" value={cue.stopTargetWhenDone} defaultValue={FADE_DEFAULTS.stopTargetWhenDone}
          onReset={() => set({ stopTargetWhenDone: FADE_DEFAULTS.stopTargetWhenDone })} />
      </div>
      <LastRun cueId={cue.id} />
    </div>
  )
}
