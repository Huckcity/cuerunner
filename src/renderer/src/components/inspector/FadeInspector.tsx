import { useStore } from '../../store'
import type { FadeCue, FadeCurve } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { targetLabel } from './targetLabel'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { FADE_DEFAULTS } from '../../utils/cueDefaults'
import { isVisualCue } from '../../../../shared/visual'

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

  // A fade moves a sound, and only an audio cue has one: a wait, a group or a MIDI cue in
  // this list was a target that could be chosen and would do nothing. A cue of another
  // kind that an older show already aims at stays in the list, so the panel shows what
  // the cue says rather than quietly showing something else.
  //
  // A Light cue has a level too: its intensity, which a fade moves to a share of what the
  // cue set, so it is offered beside the sounds.
  //
  // A picture — a video, an image, text — has its opacity, offered beside a sound's volume and
  // pan: a video has all of them, and an image or text only the one.
  const targets = cues.filter(c => c.id !== cue.id && (c.type === 'audio' || c.type === 'light' || isVisualCue(c) || c.id === cue.targetCueId))
  const targetGone = cue.targetCueId !== '' && !targets.some(c => c.id === cue.targetCueId)
  const lightTarget = cues.some(c => c.id === cue.targetCueId && c.type === 'light')
  const target = cues.find(c => c.id === cue.targetCueId)
  const pictureOnly = target?.type === 'image' || target?.type === 'text'
  const hasPicture = target !== undefined && isVisualCue(target)
  const aim = (targetCueId: string): void => {
    const next = cues.find(c => c.id === targetCueId)
    const silent = next?.type === 'image' || next?.type === 'text'
    set(silent && cue.fadeProperty !== 'opacity'
      ? { targetCueId, fadeProperty: 'opacity', targetValue: 0, panTargetValue: null }
      : { targetCueId })
  }

  return (
    <div>
      <div className="field-row">
        <label>Target cue</label>
        <select value={cue.targetCueId} onChange={e => aim(e.target.value)}>
          <option value="">— select —</option>
          {/* A target that was deleted is said, not papered over: a select whose value
              matches no option draws its first one, which reads as a choice nobody made. */}
          {targetGone && <option value={cue.targetCueId}>— not in this show —</option>}
          {targets.map(c => <option key={c.id} value={c.id}>{targetLabel(c)}</option>)}
        </select>
      </div>
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
              else set({ fadeProperty: next, panTargetValue: null, ...clampedFor(next) })
            }}
          >
            {!pictureOnly && <option value="volume">Volume</option>}
            {!pictureOnly && <option value="pan">Pan</option>}
            {!pictureOnly && <option value="both">Volume and pan</option>}
            {(hasPicture || cue.fadeProperty === 'opacity') && <option value="opacity">Opacity</option>}
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
