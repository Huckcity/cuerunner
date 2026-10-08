import { useStore } from '../../store'
import type { FadeCue, FadeCurve } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { TargetList } from './TargetList'
import { fadeTargetIds, fadeTargetsPatch } from '../../../../shared/cueTargets'
import { fadeRoutes } from '../../engine/targets'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { FADE_DEFAULTS } from '../../utils/cueDefaults'
import { isVisualCue } from '../../../../shared/visual'
import { FadeGeometry } from './FadeGeometry'

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

  // A fade moves a level: a sound's, a light's intensity — which a fade moves to a share of
  // what the cue set — or a picture's opacity and place on its output; a video has both a sound
  // and a picture. A group is offered too, and a fade of a group fades everything inside it. A
  // deleted target stays in the list saying so, rather than quietly vanishing from it.
  const ids = fadeTargetIds(cue)
  const routes = fadeRoutes(cues, ids)
  // A light's one level is its intensity: a fade whose targets are all lights reads that way.
  const lightTarget = routes.light.length > 0 && routes.audio.length === 0 && routes.pictures.length === 0
  // Images, text and cameras have no sound: a fade of only those moves their picture alone.
  const pictureOnly = routes.pictures.length > 0 && routes.audio.length === 0
  const hasPicture = routes.pictures.length > 0
  // The picture a geometry fade's fields start from: the first one it names.
  const target = cues.find(c => c.id === routes.pictures[0])
  const aim = (next: string[]): void => {
    const nextRoutes = fadeRoutes(cues, next)
    const silent = nextRoutes.pictures.length > 0 && nextRoutes.audio.length === 0
    set(silent && cue.fadeProperty !== 'opacity' && cue.fadeProperty !== 'geometry'
      ? { ...fadeTargetsPatch(next), fadeProperty: 'opacity', targetValue: 0, panTargetValue: null }
      : fadeTargetsPatch(next))
  }

  return (
    <div>
      <div className="field-section-title">Targets</div>
      <TargetList
        id="fade-target-add"
        cueId={cue.id}
        ids={ids}
        cues={cues}
        eligible={candidate => candidate.type === 'audio' || candidate.type === 'light' || candidate.type === 'group' || isVisualCue(candidate)}
        onChange={aim}
        empty="No cue chosen: this fade moves nothing."
      />
      {ids.length > routes.missing.length && routes.audio.length === 0 && routes.light.length === 0 && routes.pictures.length === 0 && (
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
              else if (next === 'opacity') set({ fadeProperty: 'opacity', panTargetValue: null, ...(cue.targetValue < 0 ? { targetValue: 0 } : {}) })
              else if (next === 'geometry') set({ fadeProperty: 'geometry', panTargetValue: null })
              else set({ fadeProperty: next, panTargetValue: null, ...clampedFor(next) })
            }}
          >
            {!pictureOnly && <option value="volume">Volume</option>}
            {!pictureOnly && <option value="pan">Pan</option>}
            {!pictureOnly && <option value="both">Volume and pan</option>}
            {(hasPicture || cue.fadeProperty === 'opacity') && <option value="opacity">Opacity</option>}
            {(hasPicture || cue.fadeProperty === 'geometry') && <option value="geometry">Geometry only</option>}
          </select>
        )}
        <ResetButton label="Property" value={property} defaultValue={FADE_DEFAULTS.fadeProperty}
          onReset={() => set({ fadeProperty: FADE_DEFAULTS.fadeProperty, panTargetValue: null })} />
      </div>
      {property !== 'geometry' && <div className="field-row">
        <label>{property === 'both' ? 'Target volume' : 'Target value'}</label>
        {/* Pan runs left to right, −1 to 1; a volume from silence to full, 0 to 1. */}
        <NumberField when="typed" min={cue.fadeProperty === 'pan' ? -1 : 0} max={1} step={0.01} value={cue.targetValue}
          onValue={targetValue => { if (targetValue !== null) set({ targetValue }) }} />
        <ResetButton label="Target value" value={cue.targetValue} defaultValue={FADE_DEFAULTS.targetValue}
          onReset={() => set({ targetValue: FADE_DEFAULTS.targetValue })} />
      </div>}
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
      {/* A picture's place moves with its level: what it moves to, property by property. */}
      {hasPicture && (property === 'opacity' || property === 'geometry') && target !== undefined && isVisualCue(target) && (
        <FadeGeometry cue={cue} target={target} />
      )}
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
