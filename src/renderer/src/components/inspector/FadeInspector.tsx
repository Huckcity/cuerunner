import { useStore } from '../../store'
import type { FadeCue, FadeCurve } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { TargetList } from './TargetList'
import { fadeTargetIds, fadeTargetsPatch } from '../../../../shared/cueTargets'
import { fadeRoutes } from '../../engine/targets'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { FADE_DEFAULTS } from '../../utils/cueDefaults'

interface Props { cue: FadeCue }

export function FadeInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const cues = useStore(s => s.cues)
  const set = (patch: Partial<FadeCue>) => update(cue.id, patch)
  // The three things a fade can move, as the panel offers them: a volume fade that carries a
  // pan target is a fade of both.
  const property = cue.fadeProperty === 'volume' && typeof cue.panTargetValue === 'number' ? 'both' : cue.fadeProperty
  // A value that is out of the new property's range is brought into it, rather than left as
  // a volume of −0.5 the field would refuse to show.
  const clampedFor = (next: 'volume' | 'pan'): Partial<FadeCue> =>
    next === 'volume' && cue.targetValue < 0 ? { targetValue: 0 } : {}

  // A fade moves a level: a sound's, or a light's intensity, which a fade moves to a share of
  // what the cue set. A group is offered too, and a fade of a group fades everything inside it.
  // A deleted target stays in the list saying so, rather than quietly vanishing from it.
  const ids = fadeTargetIds(cue)
  const routes = fadeRoutes(cues, ids)
  // A light's one level is its intensity: a fade whose targets are all lights reads that way.
  const lightTarget = routes.light.length > 0 && routes.audio.length === 0

  return (
    <div>
      <div className="field-section-title">Targets</div>
      <TargetList
        id="fade-target-add"
        cueId={cue.id}
        ids={ids}
        cues={cues}
        eligible={candidate => candidate.type === 'audio' || candidate.type === 'light' || candidate.type === 'group'}
        onChange={next => set(fadeTargetsPatch(next))}
        empty="No cue chosen: this fade moves nothing."
      />
      {ids.length > routes.missing.length && routes.audio.length === 0 && routes.light.length === 0 && (
        <p className="inspector-hint">Nothing it names has a level to fade.</p>
      )}
      <div className="field-row">
        <label>Property</label>
        {lightTarget ? (
          // A light's one level is its intensity; the target value is a share of what it set.
          <span className="field-value">Intensity</span>
        ) : (
          <select
            value={property}
            onChange={e => {
              const next = e.target.value as typeof property
              if (next === 'both') set({ fadeProperty: 'volume', panTargetValue: cue.panTargetValue ?? 0 })
              else set({ fadeProperty: next, panTargetValue: null, ...clampedFor(next) })
            }}
          >
            <option value="volume">Volume</option>
            <option value="pan">Pan</option>
            <option value="both">Volume and pan</option>
          </select>
        )}
        <ResetButton label="Property" value={property} defaultValue={FADE_DEFAULTS.fadeProperty}
          onReset={() => set({ fadeProperty: FADE_DEFAULTS.fadeProperty, panTargetValue: null })} />
      </div>
      <div className="field-row">
        <label>{property === 'both' ? 'Target volume' : 'Target value'}</label>
        {/* Pan runs left to right, −1 to 1; a volume from silence to full, 0 to 1. */}
        <NumberField when="typed" min={cue.fadeProperty === 'pan' ? -1 : 0} max={1} step={0.01} value={cue.targetValue}
          onValue={targetValue => { if (targetValue !== null) set({ targetValue }) }} />
        <ResetButton label="Target value" value={cue.targetValue} defaultValue={FADE_DEFAULTS.targetValue}
          onReset={() => set({ targetValue: FADE_DEFAULTS.targetValue })} />
      </div>
      {property === 'both' && !lightTarget && (
        <div className="field-row">
          <label>Target pan</label>
          <NumberField when="typed" min={-1} max={1} step={0.01} value={cue.panTargetValue ?? 0}
            onValue={panTargetValue => { if (panTargetValue !== null) set({ panTargetValue }) }} />
        </div>
      )}
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
